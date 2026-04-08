# TS-2068 Disk Browser

Cross-platform desktop app for browsing and extracting files from vintage Timex Sinclair 2068 and ZX Spectrum disk images and TAP tape files.

Built with Electron, React, and TypeScript.

## Features

- **Drag-and-drop** disk images or TAP files to browse their file catalogs
- **Auto-detect** disk format from file contents (no manual selection needed)
- **Sortable file table** with type badges, sizes, and block maps
- **Content viewers** — tabbed panel auto-selects the best view for each file type:
  - **BASIC listing** with syntax highlighting (statements, functions, operators, UDG, block graphics)
  - **Variable viewer** — displays all BASIC variables with types, values, and expandable arrays
  - **SCREEN$ viewer** — canvas rendering of 6912-byte screens with invert toggle and PNG export
  - **Data array decoder** — numeric and character array values with dimensions
  - **Text viewer** — auto-detected for word processor and plain text files
  - **Hex viewer** for raw byte inspection
- **Inline BASIC editor** — double-click lines to edit, with smart re-tokenization preserving original binary for unedited lines. Edits tracked per-file across the disk with dirty indicators
- **TS2068 token support** — auto-disambiguates extended tokens (`ON ERR`, `STICK`, `SOUND`, `FREE`, `RESET`) from ZX Spectrum characters, with manual Auto/TS2068/Spectrum toggle
- **Disk command highlighting** — detects and highlights DOS-specific I/O commands:
  - Oliger: `OUT 244,1` ROM paging + `LOAD /"name"` syntax
  - Larken: `USR 100` activation (after any keyword) + `PRINT #4:` channel shorthand + `OPEN #4,"dd"` setup
- **TAP file support** — open `.tap` files directly; each header+data pair shown as a catalog entry with full viewer support
- **TAP package bundling** — auto-detects BASIC programs that LOAD other files and bundles them into a single multi-file TAP for emulator compatibility
- **Manual TAP package assembly** — drag files onto each other to create custom packages, reorder with drag-and-drop, Auto/Manual PKG toggle per disk
- **State capture support** — Oliger type-4 state captures with extracted BASIC listing, variable viewer, and **Extract BASIC** button to save as standalone TAP
- **TAP export** for ZX Spectrum-compatible files (BASIC, CODE, arrays) — edited files export with changes
- **Memory dump export** with auto-generated BASIC loader
- **Extraction manifest** — `manifest.md` generated alongside extracted files with disk metadata and file mapping
- **Resizable viewer panel** — drag the edge to resize the content viewer
- **Copy buttons** on text and listing views
- **Extract All** bundles detected packages automatically; standalone files export individually
- **Multi-select** with Cmd/Ctrl+click for batch extraction

## Supported Formats

| Format | Extensions | Notes |
|--------|-----------|-------|
| TAP tape file | `.tap` | Direct viewing with all content viewers |
| Larken LKDOS | `.img` | TAP export with memory dumps |
| Oliger JLO SAFE V1 | `.img` | TAP export with heuristic type detection |
| Oliger JLO SAFE V2 | `.img` | TAP export with ABS state saves + state captures |
| Aerco DOS-64 | `.img` | TAP for BASIC/CODE, raw for MODULE |
| Aerco RP/M | `.img` | Raw binary (CP/M-compatible files) |
| Zebra DIRSCP | `.dsk` | CPC DSK with hierarchical directories |
| Zebra CP/M | `.dsk` | CPC DSK flat catalog |
| Sinclair QL | `.img` | QL5A/QL5B raw binary |

## Content Viewers

The side panel auto-selects the richest view based on file type:

- **BASIC programs** → Listing + Variables + Hex tabs
- **State captures** → Listing + Variables + Hex tabs (BASIC extracted from memory) + Extract BASIC button
- **CODE files (6912 bytes)** → Screen + Hex tabs
- **Numeric/string arrays** → Array + Hex tabs
- **Text files** (90%+ printable) → Text + Hex tabs
- **Everything else** → Hex tab

The TS2068 token toggle (Auto / TS2068 / Spectrum) appears on the listing tab for programs that may use extended keywords.

## Inline BASIC Editing

Double-click any line in the listing viewer to edit it. Edited lines are highlighted and tracked per-file across the entire disk image. On extraction:

- Only edited lines are re-tokenized; unedited lines preserve original binary
- All extraction paths (Extract Selected, Extract as Package, Extract All) use edited content
- Per-line revert and Revert All to undo changes
- EDITED badge shown on modified files in the file table

## TAP Package Bundling

On disk systems each file is standalone, but on tape (TAP format) a BASIC program and the files it LOADs must appear sequentially in the same file.

**Auto-detected packages:**
- Scans BASIC programs for LOAD commands and matches to catalog entries
- Supports tape-style `LOAD ""CODE`, Oliger disk-style `LOAD /"name"CODE`, and Larken `USR 100: LOAD "name"`
- SCREEN$ loads validated against 6912-byte size
- Toggle on/off with the Auto PKG / Manual PKG button

**Manual package assembly:**
- Drag a file onto another to create a custom package
- Drag within an expanded package to reorder files
- Remove files with the x button on dependency rows
- Manual packages show a teal PKG badge with pencil icon

## Installation

Download the latest release for your platform from the [Releases](https://github.com/factus10/TS2068-Disk-Explorer/releases) page:

- **macOS** — Universal binary (Intel + Apple Silicon) `.dmg`
- **Windows** — `.exe` installer (NSIS)
- **Linux** — `.AppImage` or `.deb`

## Building from Source

```bash
git clone https://github.com/factus10/TS2068-Disk-Explorer.git
cd TS2068-Disk-Explorer
npm install
npm run build
npx electron .
```

### Development

```bash
npm run dev          # Start Vite dev server (renderer)
npx electron .       # Launch Electron (after build)
```

### Production Build

```bash
npm run electron:build   # Full build with electron-builder
```

Outputs to `release/` — DMG/ZIP (macOS), NSIS installer (Windows), AppImage/deb (Linux).

### Type Checking

```bash
npx tsc --noEmit                              # Renderer (src/)
npx tsc -p tsconfig.electron.json --noEmit    # Main process (electron/)
```

## Architecture

All file I/O and parsing runs in the **main process**. The renderer communicates via IPC and only receives serialized data (no Buffer objects cross the boundary).

Format detection is automatic based on magic bytes, boot sector patterns, directory structure markers, and file extension (`.tap`). See `electron/parsers/detect.ts` for the detection order.

## License

[GPL v3](LICENSE)
