# TS-2068 Disk Browser

Cross-platform Electron app for browsing and extracting files from vintage Timex/Sinclair disk images.

## Tech Stack

- **Electron** (main process) + **React 18** (renderer) + **TypeScript**
- **Vite** for dev/build, **vite-plugin-electron** for Electron integration
- **electron-builder** for packaging (macOS universal, Windows NSIS, Linux AppImage/deb)

## Project Structure

```
electron/              # Main process (Node.js / Electron)
  main.ts              # App lifecycle, IPC handlers, menu, extraction logic
  preload.ts           # Context bridge exposing diskTools API to renderer
  parsers/             # Disk format parsers (all run in main process)
    types.ts           # Shared types: DiskImage, FileEntry, DiskFormat, etc.
    detect.ts          # Auto-detect format from file bytes
    tap.ts             # ZX Spectrum TAP file builder (single + multi-file + dump)
    utils.ts           # makeSafeFilename, uniquePath, CRC, binary read helpers
    larken.ts          # Larken LKDOS format
    oliger.ts          # Oliger JLO SAFE V1 & V2
    aerco.ts           # Aerco FD DOS-64 & RP/M (CP/M clone)
    zebra.ts           # Zebra CPC DSK (DIRSCP hierarchical + CP/M flat)
    ql.ts              # Sinclair QL QDOS (QL5A/QL5B)
    zx81.ts            # ZX81 character set + BASIC detokenizer
    zx81-aerco.ts      # ZX81 Aerco disks (BBDOS 4.0 and directory-less)
src/                   # Renderer (React)
  main.tsx             # Entry point
  App.tsx              # Main layout, state management, IPC calls
  api.ts               # Typed wrapper for window.diskTools IPC API
  components/
    Toolbar.tsx        # Open, Extract Selected, Extract All buttons
    DiskInfo.tsx       # Disk header (format, label, geometry)
    FileTable.tsx      # Sortable file catalog with multi-select
    FileDetails.tsx    # Selected file metadata panel
    DropZone.tsx       # Drag-and-drop overlay for .img/.dsk files
    HexView.tsx        # Hex dump viewer panel
    StatusBar.tsx      # Format, file count status
```

## Supported Disk Formats

| Format | Extensions | Detection | Extraction |
|--------|-----------|-----------|------------|
| Larken LKDOS | .img | Directory markers at 0xBC | TAP + memory dumps |
| Oliger V1 | .img | BASIC boot with LOAD /n tokens | TAP + heuristic type detect |
| Oliger V2 | .img | Header at 0x600 | TAP + ABS state saves |
| Aerco DOS-64 | .img | JR + JP 0x3539 at boot | TAP (BASIC/CODE) + raw (MODULE) |
| Aerco RP/M | .img | RP/M in disk name | Raw binary (CP/M files) |
| Zebra DIRSCP | .dsk | CPC DSK + DIRSCP marker | Raw with sector de-interleave |
| Zebra CP/M | .dsk | CPC DSK without DIRSCP | Catalog only |
| Sinclair QL | .img | QL5A/QL5B magic | Raw binary |
| ZX81 Aerco | .img | "DIRECTORY" sector at 0x7800 (+ backup copy), else ZX81 sysvars at 2+ slot starts | Raw `.p` (ZX81 memory image) |
| ZX81 TZX | .tzx | Generalized Data blocks (0x19) whose stream is a bit-7-terminated name then an image whose E_LINE accounts for it | Raw `.p` (ZX81 memory image) |

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (renderer only, no Electron)
npx electron .       # Launch Electron app (after build or with dev server running)
npm run build        # Build renderer + electron TypeScript
npm run electron:build  # Full production build with electron-builder
```

## Type Checking

```bash
npm run typecheck                           # all three, as CI runs it
npx tsc --noEmit                            # renderer (src/)
npx tsc -p tsconfig.electron.json --noEmit  # electron (electron/)
npx tsc -p tsconfig.scripts.json --noEmit   # scripts/
```

`scripts/` needs its own config because those files are `.mts` run through
tsx — ES modules with top-level await, importing `.mts` by name — which is a
different world from the CommonJS the main process builds as.

## Testing Parsers

Example disk images live in the sibling repo at `../TS-2068-Disk-Imaging-Tools/examples/`.
To test all parsers against examples:

```bash
npx tsx -e "
import * as fs from 'fs';
import * as path from 'path';
import { detectFormat } from './electron/parsers/detect';
// ... load and parse each .img/.dsk file
"
```

## Architecture Notes

- **IPC boundary:** All file I/O and parsing runs in the main process. The renderer only receives serialized data (no Buffer objects cross IPC — use number arrays).
- **TZX serves two machines.** A Spectrum/TS2068 tape uses standard and turbo data
  blocks (0x10, 0x11) carrying TAP-style header+data pairs. A ZX81 tape has no headers
  at all: its recording lives in the Generalized Data Block (0x19, TZX v1.20), whose
  data stream — when the symbol alphabet is two wide, so one bit per symbol — is the raw
  tape bytes: a filename in the ZX81 character set with bit 7 set on its last character,
  then a memory image from `0x4009`. A tape is only read as ZX81 when it has no
  header blocks *and* a generalized stream whose E_LINE accounts for its own length,
  because a TS2068 custom loader may legitimately use a generalized block too.
- **Format detection order:** Zebra (magic bytes) → QL (magic) → ZX81 Aerco (directory sector or slot sysvars) → Aerco (boot sector) → Larken (directory markers) → Oliger V2 (header) → Oliger V1 (BASIC boot) → fallback by size.
- **ZX81 disks (Aerco):** these are Aerco-interface disks — BBDOS names itself `AERCO/DS/40` and maps the `3000-37FFH AERCO BOARD`; the "Larken" in some filenames is a mislabel. 40 cyl × 2 sides × 10 × 512, stored side-interleaved per cylinder, so a track is 5120 bytes and each side occupies alternate tracks. BBDOS splits each side into ten fixed 4-cylinder slots (20 total) — Aerco "pages", numbered 1-20. A 16K page holds 20K; a 64K page is three consecutive slots (default heads at pages 4, 7, 11, 14, 17), which is why a large file like PRO/FILE 40K appears to span slots. Page 1 holds the DOS and the directory. Page count follows the drive geometry (DD/SS/35T=8, DD/SS/40T=10, DD/DS/35T=16, DD/DS/40T=20); the parser handles the 20-page 409600-byte case only. The drive EPROM sits at 0x3000-0x37FF and BASIC drives it with `USR (12290+page)` to load and `USR (12720+page)` to save. A Larken ZX81 interface is a different machine entirely — its LDOS EPROM starts at 0x3800 and is entered with `RAND USR 14336`. Files are raw ZX81 memory images from 0x4009 (the `.p` format); their length comes from the E_LINE system variable, and an oversized file spills into the following slots, which are left marked free. BBDOS 4.0 stores names in a directory sector at 0x7800 (plus a backup copy in the next sector); SADOS+ writes no directory at all — it is a BASIC menu program holding its names in a `Q$` array among its own variables — so those disks are read by probing each slot start for a ZX81 sysvar block and are listed by page number.
- **TAP format:** Sequential header+data block pairs. Multi-file TAPs are just concatenated blocks. The `buildDumpTap` function already creates dual-file TAPs (BASIC loader + CODE block).
- **ZX Spectrum BASIC tokens:** LOAD=0xEF, CODE=0xAF, SCREEN$=0xAA, CLEAR=0xF9, RANDOMIZE=0xF5, USR=0xC0, quote=0x22. Numbers have inline 5-byte floats after `0x0E`.

## Smart Disassembler — Layer 1 delivered

A Z80 disassembler that names ROM/DOS routines, seeded from entry points harvested out
of the BASIC the app already detokenizes (`RAND USR` on the ZX81, `SAVE … CODE addr` on
the TS2068). Shipped: `z80-disasm.ts` (decoder), `z80-trace.ts` (recursive descent, RST
inline data), `disasm-entry-points.ts`, `disasm-emit.ts`, `disasm.ts`, the Disasm tab,
and `.dis`/`.dis.json` export. Six symbol packs live in `electron/data/symbols/`,
regenerated by `scripts/build-symbols.ts` — address and label only, never the commentary
they derive from.

Nine symbol packs live in `electron/data/symbols/`. The EXROM pack is an opt-in
overlay, not a default: it is a second 8K ROM at the *same addresses* as the HOME
ROM, so `$0038` is `MASK-INT` in one and `XRST38` in the other, and nothing in a
file records which was paged in when it ran.

Outstanding: Layer 2, and `dos-zebra`/`dos-fdd3000`, whose listings carry
symbolic labels with no addresses and so cannot be built soundly. See
`.claude/plans/smart-disassembler.md`.

## Running a Program (ZEsarUX)

Run (toolbar, File ▸ Run in ZEsarUX, Cmd/Ctrl+R) hands the selected program to
ZEsarUX. It is not a new kind of export: `programPayload` in `main.ts` makes the
bytes — a TAP for the Spectrum-family disks, a `.p` for the ZX81, hand-edited
BASIC lines folded in — and those same bytes are what an archive gets, so a
program checked in the emulator is the program that ships, not a second build
of it.

- **ZEsarUX rather than Fuse.** Fuse has no ZX81 and no QL, and on macOS it is a
  Cocoa app that ignores command-line options entirely — a TS2068 tape would
  load into whatever machine it was last left set to. ZEsarUX takes
  `--machine`, autoloads by default, and covers TS2068, TS1000/ZX81 and QL.
- **`--noconfigfile`** means the reader's own `~/.zesaruxrc` is neither read nor
  at risk, so a launch behaves the same way every time whatever they have since
  changed in the emulator.
- **`machineForFormat`** in `electron/emulator.ts` decides what can run. CP/M
  (Aerco RP/M, Zebra) and QL files return null: they are data for an operating
  system, not a tape a machine can be handed at boot. `RUNNABLE_FORMATS` in
  `App.tsx` mirrors it for the button's enablement.
- **ZX81 memory.** A `.p` over 16K came out of a 64K Aerco page, so the upper
  banks (`--zx8081ram16K8000`, `--zx8081ram16KC000`) go on only when the image
  proves it needs them; a stock 16K machine is the more faithful default.
- **Run follows the same reading of the selection the extract buttons do** — a
  detected package, several files as one tape, or a single file — so the thing
  you watch load is the thing the button beside it would write out.

## Exporting One Program

`ExportPrompt` replaced the old rename dialog: every extract button now asks
both what to call the thing and what shape it should take. A bare TAP in a
folder is the old behaviour; the other choice packs it as a ZIP named
`Title (Year)(Publisher)(System)(Country)(Type).zip` holding one file of the
same name, which is the shape a submission wants. The year, publisher and
machine are remembered between exports, because cataloguing a disk means
answering them once per program and they never change within a disk.

`buildArchiveName` in `main.ts` does the real naming for both this and the
whole-disk archive.org export; `previewArchiveName` in `ExportPrompt.tsx`
mirrors it so the reader sees the answer before committing, and the two have to
agree.

A program's source goes out beside it. Whichever shape was chosen — a loose
TAP, a combined TAP, a TOSEC ZIP — `writeListingSidecar` in `main.ts` writes
`{name}.txt` next to it, named for the file it accompanies, with any
hand-edited lines already folded in. The whole-disk extract has always written
those listings; the single-program exports now do too.

## BASIC Listings Are zmakebas Source

A listing is not a picture of a program, it is the program written down:
`electron/parsers/zmakebas.ts` holds the one table saying how each byte of a
Sinclair character set is spelled in plain text, and the detokenizers, the
line editor and the exported `.txt` all go through it. Paste a listing into a
file, run zmakebas over it, and the program comes back.

- **Graphics and UDGs are escapes, not glyphs.** A block graphic is `\` and two
  characters, one per column, where `'` is that column's top half, `.` the
  bottom, `:` both and a space neither; a UDG is `\a` to `\u`. © is `\*`, £ is
  a backtick, ↑ is `^`, and a literal backslash is `\\`.
- **Embedded control codes are written too.** `INK 2` inside a string is
  `\{16}\{2}`, `AT 10,5` is `\{22}\{10}\{5}` — the code and the parameter bytes
  it takes with it. Dropping them, as the listing used to, made a colourful
  PRINT unrebuildable. The one byte run still left unwritten is `$0E`, the
  binary form of a number whose digits are already in the line; put it back
  and the number appears twice. Inside a REM there are no numbers, so there
  `$0E` is data like any other byte and is written out.
- **The two machines number their mosaics from opposite corners** — the ZX81
  from the top-left, the Spectrum from the top-right — so the same escape means
  a different code on each. Every mapping in `zmakebas.ts` was read off
  zmakebas 1.8.6 rather than a reference sheet, for exactly that reason.
- **Two spellings are deliberately decimal.** The ZX81's inverse `.` and `:`
  are written `\{155}` and `\{142}`, because `\.` or `\:` followed by a space or
  a quote-mark would be swallowed as the first half of a mosaic. And a line
  that would end in `\\` ends in `\{92}` (or `\{12}` on the ZX81) instead,
  because zmakebas reads past the newline looking for the escape's second
  character and runs the next line onto this one.
- **Round-tripped, not assumed.** Every BASIC file on the example disks
  compiles under zmakebas, and detokenizing what comes back gives the same
  listing apart from whitespace zmakebas normalises — no character, graphic or
  control code differs. What does differ is a variable whose name is also a
  keyword: `LN`, `IN`, `OR`, `ON`, `cls`, `beep` come back as tokens. That is
  inherent to any text form of Spectrum BASIC, where the machine tells a
  variable from a keyword by the token byte and the text cannot.
- **The TS2068 keywords survive.** zmakebas knows `ON ERR`, `SOUND`, `STICK`,
  `FREE` and `RESET`, so a listing that renders `$7B`-`$7F` as keywords
  compiles back to those bytes rather than to `{|}~©`.
- **Line numbers are indented one space.** zmakebas ignores leading
  whitespace, and the space stops a bare line number being read as markup
  wherever the text is pasted next.

## Delivered: TAP Package Bundling

`.claude/plans/tap-package-bundling.md` is done — `basic-analyzer.ts` scans BASIC for
LOAD references and `buildTapPackages` matches them to catalog entries, so a program and
the CODE/SCREEN$/DATA it loads export as one multi-file TAP. The plan is kept for the
record of how the format works.

## Collection Catalogue (`scripts/`)

A toolchain for cataloguing a whole collection of disks and tapes, separate from
the app but built on its parsers. A program's identity is the head of the SHA-256
of its bytes, so the same program on twelve disks is one entry with twelve
occurrences — and a mark against it survives a rebuild.

```bash
npx tsx scripts/scan-collection.mts '<collection>'              # read-only survey
npx tsx scripts/build-catalog.mts '<collection>' ~/TS-Catalog   # first pass: extract + characterise
npx tsx scripts/update-catalog.mts '<collection>' ~/TS-Catalog  # fold in new disks (the app does this too)
npx tsx scripts/mark-archived.mts ~/TS-Catalog <id...>          # record a decision
npx tsx scripts/export-shared-catalog.mts ~/TS-Catalog          # refresh the shipped list
```

- **`lib/collection.mts`** holds the parser dispatch and `hashPrograms`, the one
  definition of program identity every script must come through.
- **Catalogue Insights** (File menu) answers the two questions browsing cannot:
  what is rarest and still unarchived, and which folders hold programs found
  nowhere else. Rarity is counted in folders rather than copies — three copies
  in one folder is one disk's worth, and disappears together.
- **`catalog.json` is the only generated artifact** besides the extracted programs.
  The app reads it directly, so there are no CSVs or HTML to keep in step with it.
  (An earlier `render-catalog.mts` produced a browsable index; the app replaced it.)
- **`update-catalog` folds in new disks without re-reading everything.** It finds
  images the catalogue has never seen, fingerprints their contents, and merges:
  a known program gains an occurrence, an unknown one becomes an entry. Verified
  to land on a catalogue identical to a full rebuild. It leaves WordPress and
  archive.org alone — those are downstream, and a disk that arrived this morning
  cannot already have been published.
- **Characterisation is shared** (`lib/characterize.mts`) so a program added later
  is described by the same rules as one added on the first pass.
- **Reads run 32 deep.** Parsing an image takes about a millisecond; fetching one
  off cloud storage takes the better part of a second, and that wait is idle.
- **`catalog.json` is the source of truth**, and nothing writes back into it.
- **`marks.json` sits beside it** — hand-made decisions, keyed by content hash,
  written by the app and by `mark-archived.mts` alike, and never overwritten by a
  rebuild. A mark is a decision about a program, not a fact about the collection.
- **Titles are guesses, and `title_from` says how good a guess.** Filenames in a
  real collection are conventions — 148 different programs called `AUTOSTART` —
  so a title mined from a REM or a `PRINT` often beats the name on the disk.
- **`electron/data/known-programs.csv`** is the shareable projection: which
  programs exist and which are published, with nothing about where they live. It
  ships inside the app so someone imaging disks is told what is new without
  needing a catalogue of their own. Refresh it from File → Update Shared Program
  List, or with `export-shared-catalog.mts`.

`match-wordpress.mts` and `export-wordpress.php` are not committed: they are
specific to one site's `computer_media` post type. The app now does both jobs
itself over the REST API — see below — and writes the same two files, so
either route leaves a catalogue the other can read.

## Asking WordPress What Is Already Published

`electron/wordpress.ts` reads the published archive straight off the site over
the REST API, replacing the old `wp eval-file` dump. Everything is a GET of
published posts: no credentials are involved, and nothing is ever written back.
The address is a setting (Preferences ▸ Published archive), unset until the
reader gives one, because it is a network request nothing should make on a
guess.

- **Three questions, not one.** "Is this program published?" is asked of a
  selected file and answered by its name — one request, and only ever a lead.
  "What holds this line?" is the search for when the name settles nothing, and
  is close to decisive. "What does the whole archive say?" re-matches the
  catalogue and is the live form of the old dump-and-match pair.
- **The listings are searched from a copy, because the site cannot answer.**
  WordPress searches `post_content`, and only some records render their listing
  into the body — the rest keep it in `source_code` alone, where a search never
  looks. Such a record is not ranked low, it is never offered, so no amount of
  reading further down the results reaches it: asking the site missed 12 of the
  68 records holding `GO SUB 9000` and 37 of the 523 holding `PRINT AT 10,`.
  So `fetchListings` reads all of them once — about 12 MB, seven seconds — into
  `wordpress-listings.json` beside `wordpress.json`, and `searchListings` reads
  that. A search is then exact, complete, and about 30 ms. The refresh takes
  the copy in the same pass, since a fresh match with stale listings would be
  answering two different days' questions.
- **Quotes around a phrase mean the phrase.** They are stripped before
  matching. Keeping them was a silent trap: the quotes were looked for in the
  listing, where they never appear, so quoting a search — the habit every
  search box teaches — guaranteed no results. Case is ignored on both sides.
- **The REST API says by number what the dump said by name.** `programmers`
  comes back as `indiv` *taxonomy term* ids and `producer-company` as whole
  post objects; both are resolved in one batched round after the records, not
  one request per record. `_fields` prunes server-side, which matters: asking
  for whole records instead of the dozen fields wanted would pull tens of
  megabytes of rendered pages.
- **`wordpress-match.ts` is `match-wordpress.mts`'s rules, moved in.** Same
  conservative name matching — a distinctive name only, a prefix reported as a
  guess — because a wrong match says a program is safely archived when it is
  not, the one error that loses material. Verified by rebuilding the committed
  `matches.json` from the same catalogue and dump: identical, all 911 matches.
  `catalog.json` is never touched; the script still writes the CSVs.

## GitHub

Repo: https://github.com/factus10/TS2068-Disk-Explorer
CI: GitHub Actions builds for macOS (universal), Windows (NSIS), Linux (AppImage + deb) on version tags.
