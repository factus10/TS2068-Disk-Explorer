#!/usr/bin/env python3
"""
Pull the narrative-bearing parts out of a .dis file.

A .dis runs to thousands of lines and almost all of it is instructions that say
nothing on their own. What a narrative is actually built from is the header (who
calls this file, and from where), the external calls, and the text the program
carries — a title screen or a menu prompt identifies a program outright where
ten thousand instructions do not.

Reading the whole listing to find those is slow and crowds out the reading you
actually need to do, so this collects them in one pass.

    python3 digest.py path/to/NAME.dis

It reads NAME.dis.json alongside if present. Nothing here interprets: it
extracts and counts, and every line it prints is quoted from the artifact.
"""
import json
import os
import re
import sys
from collections import Counter

# Every listing line carries its address and, for instructions, the raw bytes.
LINE_RE = re.compile(r'^\$([0-9A-F]{4})  ([0-9A-F ]{11})\t(.*)$')
# DEFB/DEFM lines put the bytes in the operand instead.
DEFB_RE = re.compile(r'^\s*DEFB (.+)$')
DEFM_RE = re.compile(r'^\s*DEFM "(.*)"\s*$')
# The "calls out of this file" table: address, count, resolved name.
CALL_RE = re.compile(r'^;\s+\$([0-9A-F]{4})\s+(\d+)×\s+(.*)$')
# Bytes that merely fall in the printable range are not text. A run with no
# vowel and no space is almost always graphics data that decoded as letters.
VOWELS = set('aeiouAEIOU')


def looks_like_prose(body: str) -> bool:
    body = body.strip('"')
    if len(body) < 4:
        return False
    return any(c in VOWELS for c in body) and (' ' in body or len(body) > 8)


def rebuild_image(lines):
    """
    Reconstruct the bytes from the listing, whatever the tracer called them.

    Reading only DEFM runs is not enough and fails in exactly the wrong case:
    when a trace over-reaches and classifies the whole file as code, no DEFM is
    emitted at all and every string in the program becomes invisible. That is
    also when the disassembly is least trustworthy and the strings matter most.
    So take the bytes from the raw column of every line and scan those.
    """
    image = {}
    for line in lines:
        m = LINE_RE.match(line)
        if not m:
            continue
        addr, raw, text = int(m.group(1), 16), m.group(2).strip(), m.group(3)
        if raw:
            for i, b in enumerate(raw.split()):
                image[addr + i] = int(b, 16)
            continue
        d = DEFB_RE.match(text)
        if d:
            for i, tok in enumerate(d.group(1).split(',')):
                tok = tok.strip().lstrip('$')
                if re.fullmatch(r'[0-9A-Fa-f]{1,2}', tok):
                    image[addr + i] = int(tok, 16)
            continue
        s = DEFM_RE.match(text)
        if s:
            for i, ch in enumerate(s.group(1)):
                image[addr + i] = ord(ch) & 0xFF
    return image


def printable_runs(image, minimum=4):
    """Runs of printable bytes anywhere in the image, with their address."""
    runs, start, cur = [], None, []
    for addr in sorted(image):
        b = image[addr]
        contiguous = start is not None and addr == start + len(cur)
        if 0x20 <= b <= 0x7E and (contiguous or not cur):
            if not cur:
                start = addr
            cur.append(chr(b))
        else:
            if len(cur) >= minimum:
                runs.append((start, ''.join(cur)))
            start, cur = None, []
    if len(cur) >= minimum:
        runs.append((start, ''.join(cur)))
    return runs


def main(path: str) -> int:
    if not os.path.exists(path):
        print(f'no such file: {path}', file=sys.stderr)
        return 1
    with open(path, encoding='utf-8', errors='replace') as fh:
        lines = fh.read().split('\n')

    header, calls, texts = [], [], []
    in_calls = False
    for line in lines:
        if line.startswith('\tORG '):
            break
        if line.startswith(';'):
            header.append(line)
            if 'calls out of this file' in line:
                in_calls = True
                continue
            if in_calls:
                m = CALL_RE.match(line)
                if m:
                    calls.append((m.group(1), int(m.group(2)), m.group(3)))
    texts = [(f'{a:04X}', f'"{t}"') for a, t in printable_runs(rebuild_image(lines))]

    print('=' * 72)
    print(f'HEADER — {os.path.basename(path)}')
    print('=' * 72)
    for line in header:
        print(line)

    side = path + '.json'
    if os.path.exists(side):
        with open(side, encoding='utf-8') as fh:
            s = json.load(fh)
        print()
        print('=' * 72)
        print('SIDECAR')
        print('=' * 72)
        st = s.get('stats', {})
        print(f"  origin      ${s.get('origin', 0):04X}   length {s.get('length')} bytes")
        print(f"  sha256      {s.get('sha256')}")
        print(f"  speculative {s.get('speculative')}")
        print(f"  code/data   {st.get('codeBytes')} / {st.get('dataBytes')} bytes"
              f"   conflicts {st.get('conflicts')}")
        print(f"  packs       {', '.join(p['id'] for p in s.get('symbolPacks', []))}")
        sites = s.get('callSites', [])
        callers = sorted({c['from'] for c in sites})
        print(f"  callers     {len(callers)}: {', '.join(callers) if callers else '(none)'}")
        for t in s.get('tables', []):
            print(f"  table       {t['base']} {t['kind']}, {t['entries']} entries")

    if calls:
        named = [c for c in calls if '(unknown)' not in c[2]]
        print()
        print('=' * 72)
        print(f'EXTERNAL CALLS — {len(named)} of {len(calls)} resolve to a name')
        print('=' * 72)
        for addr, n, name in calls:
            print(f'  ${addr}  {n:4}x  {name}')
        if len(named) < len(calls):
            print()
            print(f'  NOTE: {len(calls) - len(named)} addresses have no name in any pack.')
            print('  Those are where the behaviour is. A narrative describing only the')
            print('  resolved ones sounds informed while covering almost nothing.')
        # A filler byte that happens to be a one-byte call shows up as a hot
        # external address. $FF is RST $38 and $00 is NOP falling into RST $00
        # runs; both mean the tracer walked padding.
        for addr, byte, why in (('0038', '$FF', 'RST $38'), ('0000', '$00/$C7', 'RST $00')):
            hot = [c for c in calls if c[0] == addr and c[1] > 5]
            if hot:
                print(f'  NOTE: ${addr} appears {hot[0][1]}x. {byte} decodes as {why}, so a')
                print('  high count is usually padding being traced, not real calls.')

    # A seed that is not the start of any emitted line was never decoded as an
    # instruction: either the tracer disagrees with it, or the caller is aimed
    # at resident code that merely shares this file's address range. Either way
    # it is a finding, and nothing else in the artifact points at it.
    if os.path.exists(side):
        starts = {int(m.group(1), 16) for m in
                  (LINE_RE.match(x) for x in lines) if m}
        with open(side, encoding='utf-8') as fh:
            sc = json.load(fh)
        stray = [a for a in sc.get('seeds', [])
                 if int(a.lstrip('$'), 16) not in starts]
        if stray:
            print()
            print('=' * 72)
            print(f'ENTRY POINTS NOT ON AN INSTRUCTION BOUNDARY — {len(stray)} of'
                  f" {len(sc.get('seeds', []))}")
            print('=' * 72)
            for a in stray:
                print(f'  {a}  no line starts here')
            print('  Each was named by a BASIC caller but never decoded. Say which:')
            print('  the trace is wrong about where instructions start, or the call')
            print('  is aimed at other code resident at these addresses.')

    # What is actually at the load address, and at each declared entry point.
    #
    # The rest of this digest is organised around the header, which assumes the
    # trace got the file roughly right. When it did not — picture data decoded
    # as instructions while the real routine was emitted as DEFB — everything
    # above points away from the truth, and these bytes are the only thing that
    # does not. Filler at a declared entry point settles it outright.
    if os.path.exists(side):
        with open(side, encoding='utf-8') as fh:
            sc = json.load(fh)
        image = rebuild_image(lines)

        def window(at, n):
            got = [image.get(at + i) for i in range(n)]
            hexs = ' '.join('..' if b is None else f'{b:02X}' for b in got)
            txt = ''.join('.' if b is None or not (0x20 <= b <= 0x7E) else chr(b) for b in got)
            return hexs, txt, [b for b in got if b is not None]

        org = sc.get('origin', 0)
        print()
        print('=' * 72)
        print(f'BYTES AT THE LOAD ADDRESS ${org:04X}')
        print('=' * 72)
        for row in range(4):
            hexs, txt, _ = window(org + row * 16, 16)
            print(f'  ${org + row * 16:04X}  {hexs}  |{txt}|')
        print('  If the listing above disagrees with what these bytes look like, trust')
        print('  the bytes: the trace can be inverted, emitting data as code and the')
        print('  real routine as DEFB.')

        seeds = sc.get('seeds', [])
        if seeds:
            print()
            print('=' * 72)
            print(f'BYTES AT EACH ENTRY POINT — {len(seeds)}')
            print('=' * 72)
            junk = 0
            for a in seeds:
                at = int(a.lstrip('$'), 16)
                hexs, txt, got = window(at, 8)
                filler = bool(got) and all(b in (0x00, 0xFF) for b in got)
                if filler:
                    junk += 1
                print(f'  {a}  {hexs}  |{txt}|{"   <- filler, not a routine" if filler else ""}')
            if junk:
                print()
                print(f'  {junk} of {len(seeds)} entry points hold nothing but $00/$FF.')
                print('  A caller named an address that contains no code. Usually the file')
                print('  spans a wide range and the harvest picked up USR targets meant for')
                print('  whatever else lives at those addresses.')

    if texts:
        prose = [(a, t) for a, t in texts if looks_like_prose(t)]
        print()
        print('=' * 72)
        print(f'TEXT RUNS — {len(texts)} found, {len(prose)} read as prose')
        print('=' * 72)
        print('  Prose (titles, prompts, credits — the strongest identification there is):')
        for a, t in prose[:40]:
            print(f'    ${a}  {t}')
        if not prose:
            print('    (none)')
        rest = len(texts) - len(prose)
        if rest:
            print(f'  {rest} further run(s) are printable bytes without the shape of words —')
            print('  graphics or table data that happened to land in the ASCII range.')
            for a, t in [(a, t) for a, t in texts if not looks_like_prose(t)][:8]:
                print(f'    ${a}  {t}')

    print()
    print('=' * 72)
    print('WHAT TO DO NEXT')
    print('=' * 72)
    print('  The header, the callers and the prose above carry most of what can be')
    print('  said. Read the listing itself only to answer a specific question they')
    print('  raise — what an entry point does first, say — and quote the address.')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
