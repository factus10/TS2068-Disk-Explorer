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
npx tsc --noEmit                      # Check renderer (src/)
npx tsc -p tsconfig.electron.json --noEmit  # Check electron (electron/)
```

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
- **Format detection order:** Zebra (magic bytes) → QL (magic) → ZX81 Aerco (directory sector or slot sysvars) → Aerco (boot sector) → Larken (directory markers) → Oliger V2 (header) → Oliger V1 (BASIC boot) → fallback by size.
- **ZX81 disks (Aerco):** these are Aerco-interface disks — BBDOS names itself `AERCO/DS/40` and maps the `3000-37FFH AERCO BOARD`; the "Larken" in some filenames is a mislabel. 40 cyl × 2 sides × 10 × 512, stored side-interleaved per cylinder, so a track is 5120 bytes and each side occupies alternate tracks. BBDOS splits each side into ten fixed 4-cylinder slots (20 total) — Aerco "pages", numbered 1-20. A 16K page holds 20K; a 64K page is three consecutive slots (default heads at pages 4, 7, 11, 14, 17), which is why a large file like PRO/FILE 40K appears to span slots. Page 1 holds the DOS and the directory. Files are raw ZX81 memory images from 0x4009 (the `.p` format); their length comes from the E_LINE system variable, and an oversized file spills into the following slots, which are left marked free. BBDOS 4.0 stores names in a directory sector at 0x7800 (plus a backup copy in the next sector); SADOS+ writes no directory at all — it is a BASIC menu program holding its names in a `Q$` array among its own variables — so those disks are read by probing each slot start for a ZX81 sysvar block and are listed by page number.
- **TAP format:** Sequential header+data block pairs. Multi-file TAPs are just concatenated blocks. The `buildDumpTap` function already creates dual-file TAPs (BASIC loader + CODE block).
- **ZX Spectrum BASIC tokens:** LOAD=0xEF, CODE=0xAF, SCREEN$=0xAA, CLEAR=0xF9, RANDOMIZE=0xF5, USR=0xC0, quote=0x22. Numbers have inline 5-byte floats after `0x0E`.

## Pending Feature: TAP Package Bundling

See `.claude/plans/tap-package-bundling.md` for the implementation plan. BASIC programs that LOAD other files (CODE, SCREEN$, DATA) need to be bundled into a single TAP for emulator compatibility. The plan adds a BASIC content analyzer, package detection, and multi-file TAP export.

## GitHub

Repo: https://github.com/factus10/TS2068-Disk-Explorer
CI: GitHub Actions builds for macOS (universal), Windows (NSIS), Linux (AppImage + deb) on version tags.
