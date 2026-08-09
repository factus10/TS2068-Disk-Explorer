/**
 * Works out where a file's machine code starts and which addresses to trace
 * from, by reading the BASIC that calls it.
 *
 * This is what lets the disassembler do better than a general-purpose tool on
 * these disks. A bare `.C1` or a ZX81 `.p` carries no entry point and, on the
 * Spectrum side, no load address either — but the BASIC alongside it says both
 * out loud, and the app has already detokenized that BASIC for the listing view.
 *
 *   ZX81      a line-0 `REM` puts its first code byte at $407D+5 = $4082, and
 *             the program says so: BBDOS's line 1 is `RAND USR 16514`
 *   TS2068    `SAVE "cale27.C1"CODE 63064,2464` gives the ORG a disassembler
 *             would otherwise have to guess
 *
 * Targets that fall outside the file are not seeds — they are calls into ROM or
 * into the disk interface, and get resolved against a symbol pack instead.
 */

import { ZX81, SPECTRUM } from './z80-trace';
import type { Machine } from './z80-trace';
import type { BasicListing } from './basic-detokenizer';
import type { DiskFormat, FileEntry } from './types';

/** ZX81 files begin at VERSN; the BASIC program area starts at $407D. */
const ZX81_SYSVARS = 0x4009;
const ZX81_PROG = 0x407d;
/** Token for REM in ZX81 BASIC, and in Spectrum BASIC. */
const ZX81_REM = 0xea;

/**
 * A `USR` call, with the BASIC line it sits in.
 *
 * The address alone is nearly useless to a reader: a header saying `traced
 * from 19 entry point(s): $C899 $C8D4 …` does not say what any of them is
 * for. The line does, and it is the only place that information exists —
 * Print Factory's CREATOR is called from five separate BASIC programs, which
 * is how you can tell it is a shared routine library rather than a program,
 * and nothing in its bytes says so.
 */
export interface UsrReference {
  addr: number;
  /** The BASIC file the call was found in. */
  from: string;
  lineNumber: number;
  /** The line as the detokenizer rendered it, trimmed. */
  text: string;
}

export interface DisasmPlan {
  /** Address the first byte of `range` lives at. */
  origin: number;
  /** Slice of the file worth disassembling, as [start, end) offsets. */
  range: [number, number];
  machine: Machine;
  /** Addresses inside the range to trace from. */
  seeds: number[];
  /** Where each seed was called from, when a BASIC line named it. */
  callSites: UsrReference[];
  /** USR/CALL targets outside the range — ROM and DOS entry points. */
  external: number[];
  /** How each of the above was arrived at, for the .dis header. */
  notes: string[];
  /**
   * True when nothing was known about this file: no load address, and nothing
   * anywhere pointing into it. Both are then invented — the origin defaults to
   * zero and the trace starts at the first byte — so every address in the
   * listing is fiction and the structure is only what a linear walk produced.
   *
   * The reader can still be shown it, because the origin control is how they
   * would correct it. Writing it out as a `.dis` is another matter: that file
   * is an archival record, and this one records a reading of the bytes that
   * nothing supports.
   */
  speculative: boolean;
}

/**
 * Pull `USR` operands out of a detokenized listing.
 *
 * Two spellings, because Spectrum BASIC stores a number as five bytes of
 * floating point after its digits and `VAL "54016"` does not, so writing the
 * address as a string is a standard way to save eight bytes a line. It is not
 * a rarity either: across the sample disks 194 USR operands are written as
 * numbers and 44 as `VAL "…"`, and ignoring the second form cost five of the
 * thirty real code files their entry point.
 *
 * Everything else is left alone deliberately. `USR h` is the most common form
 * of all, and resolving it means tracking assignments through a BASIC program
 * — a guess dressed as a fact, and a wrong seed makes the tracer walk data
 * while reporting instructions. `USR FN a()` and `USR CODE "n"` are the same
 * problem, the latter yielding a character code rather than an address.
 */
/**
 * How much of a calling line to keep.
 *
 * Most are short — the median is 47 characters — so nearly all survive whole.
 * The tail is long: one line runs to 4854 characters, and a header full of
 * those is unreadable. But a flat cut from the start is worse than unreadable,
 * because the call can be anywhere: a `USR` sits as far in as character 640,
 * and cutting at 120 left 231 of 2950 call sites recording a line that did not
 * contain the call it was there to document.
 *
 * So keep the whole line when it fits, and otherwise take a window around the
 * call itself, marked with an ellipsis wherever text was dropped. The call is
 * always inside the window, and the reader can see that something was cut
 * rather than having to wonder whether a line really ended mid-token.
 */
const LINE_KEPT_WHOLE = 160;
const CONTEXT_BEFORE = 60;
const CONTEXT_AFTER = 90;

function excerpt(text: string, at: number): string {
  if (text.length <= LINE_KEPT_WHOLE) return text;
  const start = Math.max(0, at - CONTEXT_BEFORE);
  const end = Math.min(text.length, at + CONTEXT_AFTER);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/**
 * Sinclair BASIC accepts an exponent, and `USR 6e4` is a real way to write
 * 60000. Matching only the digits reads that as address 6 — a seed in the ROM,
 * or worse, a plausible-looking one inside a file whose origin was assumed to
 * be zero. The trailing guard matters as much as the exponent: without it
 * `USR 1e-2` and `USR 1.5` match their first digit and yield address 1.
 *
 * Anchored, because these are applied at a known `USR` token rather than
 * searched for across the line.
 */
const USR_PLAIN = /^\s*USR\s*(\d+(?:[eE]\d+)?)(?![eE\d.])/;
const USR_VAL = /^\s*USR\s*VAL\s*"(\d+(?:[eE]\d+)?)"/;

export function harvestUsrReferences(listing: BasicListing, from = ''): UsrReference[] {
  const out: UsrReference[] = [];
  for (const line of listing.lines) {
    // Find the USR tokens first, by type, and only then read their operands.
    //
    // Searching the rendered line for the word instead finds every `USR` the
    // detokenizer wrote, including the ones it wrote for bytes inside a REM.
    // A REM holding machine code is a normal thing — it is how a program on
    // these machines carries a routine, and setting its line number to 0 with
    // a POKE to protect it is a normal thing too — so those bytes render as a
    // stream of BASIC keywords, and a $C0 among them comes out as `USR`.
    // GRANDPRIX has four such phantoms, one at character 2922 of a 4854
    // character line, each yielding address 0.
    //
    // The detokenizer already knows the difference: it tracks whether it is
    // inside a REM and emits everything there as plain text, so only a real
    // call is typed `function`. Trusting that rather than the spelling is the
    // same lesson the BASIC cross-reference learned.
    const raw = line.tokens.map((t) => t.text).join('');
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    const calls: number[] = [];
    let pos = 0;
    for (const t of line.tokens) {
      if (t.type === 'function' && t.text.trim() === 'USR') calls.push(pos - lead);
      pos += t.text.length;
    }

    const seen = new Set<number>();
    for (const at of calls) {
      if (at < 0 || at >= text.length) continue;
      const rest = text.slice(at);
      const m = USR_PLAIN.exec(rest) ?? USR_VAL.exec(rest);
      if (!m) continue;
      const n = Number(m[1]);
      // A USR operand is a 16-bit address, and a whole one. Anything else is a
      // mis-read.
      if (!Number.isInteger(n) || n < 0 || n > 0xffff || seen.has(n)) continue;
      seen.add(n);
      out.push({ addr: n, from, lineNumber: line.lineNumber, text: excerpt(text, at) });
    }
  }
  return out;
}

export function harvestUsrTargets(listing: BasicListing): number[] {
  const found = new Set(harvestUsrReferences(listing).map((r) => r.addr));
  return [...found].sort((a, b) => a - b);
}

/**
 * Find `LOAD "name" CODE addr` / `SAVE "name" CODE addr,len` in a listing.
 * The address is the ORG the file was assembled for.
 */
export function harvestCodeAddresses(
  listing: BasicListing,
): { filename: string; addr: number; length?: number }[] {
  const out: { filename: string; addr: number; length?: number }[] = [];
  for (const line of listing.lines) {
    const text = line.tokens.map((t) => t.text).join('');
    // `CODE VAL "32768"` for the same reason USR is written that way.
    const re = /(?:LOAD|SAVE)\s*"([^"]*)"\s*CODE\s*(?:VAL\s*")?(\d+)"?(?:\s*,\s*(?:VAL\s*")?(\d+)"?)?/g;
    for (const m of text.matchAll(re)) {
      const addr = Number(m[2]);
      if (addr >= 0 && addr <= 0xffff) {
        out.push({ filename: m[1], addr, ...(m[3] ? { length: Number(m[3]) } : {}) });
      }
    }
  }
  return out;
}

/**
 * Offsets of the machine code inside each ZX81 `REM` line. Walking the program
 * area is the only way to get byte offsets; the rendered listing has lost them.
 */
export interface RemCodeRegion {
  /** Offset of the first code byte, just past the REM token. */
  start: number;
  /** Bytes of code, from the line's own length field. */
  length: number;
  lineNumber: number;
}

/**
 * The machine code held in each REM, bounded exactly.
 *
 * A ZX81 line is `[number hi][number lo][length lo][length hi][body][$76]`, so
 * the length field gives the body's extent outright — there is no need to scan
 * for the terminator, and scanning would be wrong. `$76` is NEWLINE, but it is
 * also `HALT`, and any operand byte that happens to equal 118. Keeping one out
 * of a REM is long-standing advice precisely because the *editor* stops there,
 * and it is advice rather than a rule: programs carry them.
 *
 * Reading the bytes with the length as the bound is therefore both simpler and
 * more correct than anything derived from the detokenized text, which renders
 * these bytes as a stream of BASIC keywords that mean nothing.
 */
export function zx81RemCodeRegions(data: Buffer, progEnd: number): RemCodeRegion[] {
  const out: RemCodeRegion[] = [];
  let pos = ZX81_PROG - ZX81_SYSVARS;                 // $74
  while (pos + 4 <= progEnd && pos + 4 <= data.length) {
    const lineNumber = (data[pos] << 8) | data[pos + 1];
    const lineLength = data[pos + 2] | (data[pos + 3] << 8);
    if (lineNumber > 9999 || lineLength < 1) break;
    if (pos + 4 + lineLength > progEnd) break;
    // A REM as the first token means the rest of the line is not BASIC. The
    // body runs from just past the REM to just before the closing NEWLINE.
    if (data[pos + 4] === ZX81_REM && lineLength > 8) {
      out.push({ start: pos + 5, length: lineLength - 2, lineNumber });
    }
    pos += 4 + lineLength;
  }
  return out;
}

/** Just the entry addresses, for callers that do not need the extent. */
export function zx81RemCodeStarts(data: Buffer, progEnd: number): number[] {
  return zx81RemCodeRegions(data, progEnd).map((r) => r.start);
}

export interface PlanInput {
  format: DiskFormat;
  entry: FileEntry;
  data: Buffer;
  /** This file's own listing, when it is BASIC. */
  listing?: BasicListing | null;
  /** Other BASIC files on the disk, for finding a CODE file's load address. */
  siblings?: { entry: FileEntry; listing: BasicListing }[];
  /** Override discovered by the user in the UI. */
  originOverride?: number;
}

export function planDisassembly(input: PlanInput): DisasmPlan | null {
  const { format, entry, data } = input;
  if (!data.length) return null;
  return format === 'zx81-aerco' ? planZX81(input) : planSpectrum(input);
}

function planZX81(input: PlanInput): DisasmPlan | null {
  const { entry, data, listing } = input;
  const notes: string[] = [];
  // A ZX81 file is a memory image from VERSN, so the origin is never in doubt.
  const origin = input.originOverride ?? ZX81_SYSVARS;
  // Only the BASIC program area can hold code; the display file and variables
  // that follow it are not worth sweeping.
  const progEnd = entry.params.progEnd || data.length;
  const range: [number, number] = [0, Math.min(progEnd, data.length)];
  const limit = origin + range[1];

  const refs = listing ? harvestUsrReferences(listing, entry.filename.trim()) : [];
  const all = [...new Set(refs.map((r) => r.addr))].sort((a, b) => a - b);
  const seeds = all.filter((a) => a >= origin && a < limit);
  const external = all.filter((a) => a < origin || a >= limit);
  const callSites = refs.filter((r) => r.addr >= origin && r.addr < limit);
  if (all.length) {
    notes.push(`${all.length} USR target(s) harvested from the BASIC: ${seeds.length} inside the file, ${external.length} into ROM or the disk interface`);
  }

  // With nothing to go on, fall back to the code inside a REM. On the ZX81 that
  // is where machine code almost always lives, and its address is fixed.
  if (!seeds.length) {
    const regions = zx81RemCodeRegions(data, range[1]);
    for (const r of regions) seeds.push(origin + r.start);
    if (seeds.length) {
      notes.push(`no USR target inside the file; seeded from the machine code in ${seeds.length} REM line(s)`);
      // The line's length field bounds each routine exactly, which is worth
      // recording: it is the one thing that says where the code ends, and it
      // comes from the bytes rather than from any reading of them.
      for (const r of regions) {
        notes.push(`  line ${r.lineNumber} REM holds ${r.length} byte(s) of code at `
          + `$${(origin + r.start).toString(16).toUpperCase().padStart(4, '0')}`);
      }
    }
  }

  if (!seeds.length) return null;
  // A ZX81 file is a memory image from VERSN, so its origin is never in doubt.
  return { origin, range, machine: ZX81, seeds, external, notes, callSites, speculative: false };
}

function planSpectrum(input: PlanInput): DisasmPlan | null {
  const { entry, data, listing, siblings = [] } = input;
  const notes: string[] = [];
  const name = entry.filename.trim().toLowerCase();

  let origin = input.originOverride;
  let originKnown = origin !== undefined;
  if (origin === undefined) {
    // The loader BASIC records the load address of the CODE it pulls in.
    for (const s of siblings) {
      const hit = harvestCodeAddresses(s.listing).find(
        (h) => h.filename.trim().toLowerCase() === name,
      );
      if (hit) {
        origin = hit.addr;
        originKnown = true;
        notes.push(`origin ${hit.addr} taken from "${s.entry.filename.trim()}" line referencing this file as CODE`);
        break;
      }
    }
  } else {
    notes.push(`origin ${origin} supplied by the user`);
  }
  if (origin === undefined) {
    // Nothing said where it loads. A BASIC file's own params may, otherwise the
    // caller has to ask.
    origin = entry.params.startAddr || 0;
    originKnown = origin !== 0;
    notes.push(origin ? `origin ${origin} from the file header` : 'no load address found; assuming 0 — set one to get meaningful addresses');
  }

  const range: [number, number] = [0, data.length];
  const limit = origin + data.length;
  // Seeds come from this file's own BASIC if it has any, and from the loaders
  // that reference it.
  const refs: UsrReference[] = [];
  if (listing) refs.push(...harvestUsrReferences(listing, entry.filename.trim()));
  for (const s of siblings) refs.push(...harvestUsrReferences(s.listing, s.entry.filename.trim()));
  const all = new Set(refs.map((r) => r.addr));
  const seeds = [...all].filter((a) => a >= origin && a < limit).sort((a, b) => a - b);
  const external = [...all].filter((a) => a < origin || a >= limit).sort((a, b) => a - b);
  const callSites = refs
    .filter((r) => r.addr >= origin && r.addr < limit)
    .sort((a, b) => a.addr - b.addr);
  if (all.size) {
    notes.push(`${all.size} USR target(s) harvested: ${seeds.length} inside this file, ${external.length} into ROM or the disk interface`);
  }

  // A CODE file with no USR pointing into it is still worth tracing from its
  // first byte, which is where a loader would normally call.
  let speculative = false;
  if (!seeds.length) {
    seeds.push(origin);
    notes.push('no USR target inside the file; seeded from its first byte');
    // Neither fact was available, so both were made up.
    speculative = !originKnown;
    if (speculative) {
      notes.push('nothing is known about this file: the addresses below are a guess, not a reading');
    }
  }

  return { origin, range, machine: SPECTRUM, seeds, external, notes, callSites, speculative };
}
