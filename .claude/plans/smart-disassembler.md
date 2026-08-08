# Smart Disassembler — Z80 disassembly with ROM/DOS symbol recognition

## Context

The app shows BASIC, screens, fonts and arrays, but machine code is only visible as
hex. Most of what is interesting on these disks *is* machine code: on the ZX81 side
almost every program is a line-0 `REM` full of Z80 with a thin BASIC wrapper, and on
the TS2068 side the `.C1`/`CODE` files are the substance of the program.

The goal is a disassembler that goes past raw mnemonics — one that names the ROM and
DOS routines a program calls, so a reader can see *what the code does* rather than
just what the bytes decode to.

Two layers, kept strictly apart so the archival artifact stays reproducible:

- **Layer 1 (this plan)** — deterministic, in-app, no network. Bytes in, `.dis` out,
  byte-for-byte reproducible from the input.
- **Layer 2 (deliberately minimal, see the end)** — an optional AI-written narrative,
  stored as a *separate* file, never merged into the `.dis`.

## The hard part is code vs. data, not the decoder

A Z80 decoder is a large but boring table. The part that decides whether the output is
useful is knowing which bytes are instructions. A linear sweep from the first byte
desynchronises the moment it meets a jump table or a text block, and then emits
confident nonsense for the rest of the file — which is worse than nothing in an
artifact meant for archiving.

The fix is recursive descent from known entry points. **This app can harvest real entry
points, because it already detokenizes the BASIC that calls the code.**

### ZX81: the REM trick gives an exact origin

The program area starts at `0x407D`. A line-0 `REM` puts its first code byte at
`0x407D + 5` (2 bytes line number, 2 bytes length, 1 byte `REM` token) — `0x4082`,
decimal 16514. BBDOS's own line 1 is literally:

```
1 RAND USR 16514
```

Harvesting `USR` operands off the BBDOS disk gives, per file:

```
BBDOS 4.0        16514 (0x4082), 16600 (0x40d8)
PINBALL          16550 (0x40a6), 11000 (0x2af8)
GULP             17116 (0x42dc), 16514 (0x4082), 17030 (0x4286), 11000 (0x2af8)
MAZOGS           17 distinct targets, 0x40ec … 0x517c
PRO/FILE 40K/MT  12 distinct targets
```

### The out-of-range targets are the DOS, and they are the valuable half

Targets that fall outside the file's own memory image are calls into ROM. On the ZX81
Larken disks `11000` (`0x2AF8`), `12000` (`0x2EE0`), `2591` (`0x0A1F`) and `13303`
(`0x33F7`) recur across unrelated programs — all below `0x4009`, i.e. the LKDOS
interface ROM. `13303` is the number handwritten on the BBDOS disk sleeve as the
program's start address. On the TS2068 Larken disks the equivalent is `PRINT USR 100`.

So harvested targets split two ways, and both are useful:

- **inside the file** → seeds for recursive descent
- **outside the file** → ROM/DOS call sites, resolved against a symbol pack

### TS2068: the BASIC records the CODE file's load address

A `CODE` file on disk carries no reliable origin, so disassembling it at the right
`ORG` normally means guessing. The sibling BASIC says so outright:

```
9980 PRINT USR 100: LOAD "cale27.C1"CODE
9991 PRINT USR 100: SAVE "cale27.C1"CODE 63064,2464
```

`electron/parsers/basic-analyzer.ts` already parses these `LOAD`/`SAVE … CODE`
references for TAP packaging, so the origin is a short step from data we extract today.

## Implementation Plan

### 1. New module: `electron/parsers/z80-disasm.ts`

Pure decoder. No I/O, no knowledge of disks.

```typescript
interface Instruction {
  addr: number;          // absolute address (origin + offset)
  bytes: number[];
  text: string;          // "LD HL,$4082"
  length: number;
  target?: number;       // absolute target of JP/JR/CALL/RST, if any
  flow: 'seq' | 'jump' | 'call' | 'cond' | 'ret' | 'halt';
}

function decodeOne(data: Buffer, offset: number, origin: number): Instruction;
```

Full opcode coverage including the `CB`/`DD`/`ED`/`FD` prefixes and the `DD CB`/`FD CB`
displacement forms. Undocumented opcodes decoded and flagged rather than skipped —
period code uses `SLL` and the `IXH`/`IXL` halves.

### 2. New module: `electron/parsers/z80-trace.ts`

Recursive descent over the byte range, producing a code/data map.

```typescript
interface TraceResult {
  code: Set<number>;              // offsets that begin an instruction
  labels: Map<number, string>;    // internal branch targets → L_xxxx
  calls: Map<number, number[]>;   // external target → call sites
  data: { start: number; end: number; kind: 'text' | 'bytes' }[];
}

function trace(data: Buffer, origin: number, seeds: number[]): TraceResult;
```

Rules: follow `JP`/`JR`/`CALL`/conditional branches; stop a run at unconditional
`JP`/`JR`/`RET`/`HALT`; never re-walk a visited offset; anything unreached after all
seeds are exhausted is data. Runs of ZX81/Spectrum printable characters get tagged
`text` so string tables come out readable rather than as byte soup.

### 3. New module: `electron/parsers/disasm-entry-points.ts`

Harvests seeds and origins from the detokenized BASIC, per the evidence above.

```typescript
interface EntryPoints {
  origin: number;          // ZX81 REM → 0x4082; TS2068 → from SAVE/LOAD … CODE addr
  seeds: number[];         // USR targets inside [origin, origin+len)
  external: number[];      // USR/CALL targets outside — resolved via symbol pack
}
```

Reuses the existing detokenizers, so it works for both dialects. Guard against false
positives: only accept `USR` operands that parse as a plausible address, and ignore
targets landing mid-instruction once tracing starts.

### 4. Symbol packs: `electron/data/symbols/*.json`

Generated once from reference material, committed, loaded at runtime. **Addresses and
short names only** — see Provenance below.

```jsonc
{
  "id": "ts2068-home",
  "name": "TS2068 HOME ROM",
  "provenance": "Derived from <source>. Address/label pairs only.",
  "range": [0, 16383],
  "symbols": {
    "0x0010": { "name": "PRINT-A-1", "note": "Print char in A" },
    "0x0028": { "name": "CALCULATE", "note": "FP calculator" }
  }
}
```

Packs to build:

| Pack | Source | Status |
|---|---|---|
| `ts2068-home` | `docs/ts2068_rom_entry_points.md` (markdown tables), `disassemblies/ts2068 home rom.txt` (~411 labels), `2068_DEFS.ASM` | material in hand |
| `ts2068-exrom` | `docs/Timex Sinclair 2068 EXROM.txt`, `exrom_revision_analysis.md` | material in hand |
| `spectrum48` | `docs/spectrum48_rom_entry_points.md` | material in hand |
| `ts2068-sysvars` | `docs/ts2068_system_variables.md` | material in hand |
| `dos-larken-2068` | LKDOS entry points (`USR 100` and neighbours) | to be harvested |
| `dos-zebra` | `Zebra_OS-64_annotated.asm` | material in hand |
| `dos-fdd3000` | `fdd3000_annotated.asm` | material in hand |
| **`zx81`** | **user to supply** | **blocked — see below** |
| **`dos-lkdos-zx81`** | **user to supply** | **blocked — see below** |

A small script under `scripts/build-symbols.ts` parses the markdown tables and the
`label:` lines out of the annotated disassemblies into the JSON above, so regenerating
is repeatable and the derivation is auditable.

#### The two ZX81 packs (user supplying material)

The pack format above is the whole interface. To fill `zx81.json` I need any of:
a ZX81/TS1000 ROM label list (address → name), an annotated ZX81 ROM disassembly, or
the Logan & O'Hara address/label index. Anything with addresses and short names works;
prose is not needed and will not be shipped.

`dos-lkdos-zx81.json` covers the Larken interface ROM below `0x4009` — the `11000`,
`12000`, `2591`, `13303` family observed above. If no published list exists, these can
be *partly* recovered from the disks themselves by aggregating harvested call targets
across many images and labelling the recurring ones by hand.

Until both land, ZX81 disassembly works and simply names no ROM routines.

### 5. New module: `electron/parsers/disasm-emit.ts`

Renders `TraceResult` + symbol packs into the `.dis` text: address, raw bytes,
mnemonic, resolved symbol as a trailing comment, labels on their own lines, data blocks
as `DEFB`/`DEFM`. Deterministic — same input bytes and same pack version produce an
identical file.

### 6. UI: `Disassembly` tab

`getStaticTabs()` in `src/components/ContentViewer.tsx` gains `disasm` for `code`-type
files and for any `basic` file whose listing yields in-file `USR` seeds (the ZX81 REM
case). New `src/components/DisasmViewer.tsx`, alongside the existing Hex tab, with an
origin override box, a re-trace button, and click-through on branch targets.

### 7. Export

`.dis` written next to the other extracted files, and into the TOSEC package. Alongside
it a small `.dis.json` recording: source disk image, file name, origin, seeds used,
symbol pack ids and versions, and a **SHA-256 of the exact bytes disassembled**.

That checksum is the one piece worth keeping from the original queue design: it is what
lets a narrative written later be bound to the exact bytes it describes.

### 8. Files to modify

- `electron/parsers/types.ts` — add `'disasm'` to nothing; `.dis` is an export artifact
- `electron/main.ts` — `get-disassembly` IPC, `.dis` in `writeExtractedFile` and the
  archive builder, symbol packs loaded once at startup
- `electron/preload.ts`, `src/api.ts` — expose `getDisassembly`
- `src/components/ContentViewer.tsx` — new tab
- `scripts/build-symbols.ts` — symbol pack generator

## Layer 2 — narrative, kept out of the app

Not built as part of this plan, and deliberately not as a queue.

The original design called for `pending/`/`done/` folders, stable ids, atomic writes and
a standalone MCP server exposing `list_pending`/`get_disassembly`/`submit_narrative`.
That machinery exists to serve an unattended background consumer, and there isn't one: a
cloud-scheduled agent cannot reach an MCP server on this machine at all, and the Claude
Desktop scheduling path shouldn't be designed around until it is confirmed.

With a human prompting a session, **the output folder of `.dis` files already is the
queue**. Point Claude at it, ask for narratives, write them as `<name>.narrative.md`
next to the `.dis`, tagged with model and date, referencing the `.dis.json` checksum.
Nothing about the Layer 1 file format has to change if an MCP server is added later.

## Provenance

The symbol data derives from published, copyrighted disassemblies. Ship **address →
short label** pairs (facts) with a provenance string naming the source; do not ship the
descriptive commentary. The generator script keeps the derivation auditable, and the
`.dis` header records which pack versions produced the output.

## Verification

- Decoder: round-trip every opcode against `z80asm`/`z80dasm` (already installed in the
  reference library) — assemble, disassemble, compare.
- Trace: disassemble `2068Home.BIN` from `0x0000` and check the known entry points from
  `ts2068_rom_entry_points.md` land on instruction boundaries and get their labels.
- Real disks: BBDOS's line-0 REM at `0x4082`, MAZOGS' 17 seeds, `cale27.C1` at origin
  63064 — check the traced code region is contiguous and the data blocks fall where the
  annotated references say they should.
- Determinism: disassemble twice, byte-compare; confirm no timestamp or path leaks into
  the `.dis`.

## Open questions

- Origin for TS2068 `CODE` files with no sibling BASIC — offer the UI override and
  default to the `SAVE … CODE` address when one is found, else leave the user to set it.
- Whether to auto-seed from the interrupt vector / `RST` targets for full ROM images, or
  keep seeding to harvested entry points only.
- How far to take jump-table detection (`JP (HL)` after a table load is common in these
  DOS ROMs) — probably a v2 concern once real output is in front of us.
