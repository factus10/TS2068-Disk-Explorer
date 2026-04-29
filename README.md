# TS-2068 Disk Browser

Cross-platform desktop app for browsing, viewing, editing, and extracting files from vintage Timex Sinclair 2068 and ZX Spectrum disk images, tape files, and emulator snapshots.

Built with Electron, React, and TypeScript.

**[Getting Started Guide](GETTING_STARTED.md)** | **[Help (F1 in app)](help/help.html)**

## Supported Formats

| Format | Extensions | Description |
|--------|-----------|-------------|
| **Disk Images** | | |
| Larken LKDOS | `.img` | TAP export with content-based type detection, NMI snapshots, issue flags |
| Oliger JLO SAFE V1 | `.img` | TAP export with heuristic type detection |
| Oliger JLO SAFE V2 | `.img` | TAP export, state captures |
| Aerco DOS-64 | `.img` | TAP for BASIC/CODE, raw for MODULE |
| Aerco RP/M | `.img` | Raw binary (CP/M files) |
| Zebra DIRSCP | `.dsk` | CPC DSK with hierarchical directories |
| Zebra CP/M | `.dsk` | CPC DSK flat catalog |
| Sinclair QL | `.img` | QL5A/QL5B raw binary |
| MGT +D/DISCiPLE | `.mgt` | Standard Spectrum disk interface |
| **Tape Files** | | |
| TAP | `.tap` | Standard tape format |
| TZX | `.tzx` | Extended tape format with timing data |
| **Snapshots** | | |
| SNA | `.sna` | 48K emulator snapshot |
| Z80 | `.z80` | v1/v2/v3 emulator snapshot (with decompression) |
| **Screen Files** | | |
| SCR | `.scr` | Raw 6912-byte ZX Spectrum screen |
| **Containers** | | |
| ZIP archive | `.zip` | Browse all inner disk/tape images as a unified catalog |

## Features

### Browsing
- **Drag-and-drop** or **Cmd/Ctrl+O** to open any supported file
- **Auto-detect** format from file contents (no manual selection needed)
- **File browser sidebar** — toggle with Cmd/Ctrl+B, navigate folders, currently-loaded disk highlighted
- **Sortable file table** with type badges, sizes, and block maps. New `#` column preserves disk-order (important for tape `LOAD ""` chains)
- **Multi-select** — Click, Cmd/Ctrl+click for individual toggles, Shift+click for ranges
- **Search/filter** files by name (Cmd/Ctrl+F)
- **Keyboard navigation** — Arrow keys, Enter to view, Space to expand, Escape to close
- **Recent files** menu (File → Recent Files)
- **Dark/light theme** toggle

### Content Viewers
- **BASIC listing** — syntax highlighting with color-coded statements, functions, operators, UDG characters, block graphics
- **Variables** — all BASIC variables with types, values, expandable arrays, FOR loop details
- **Cross-reference (XRef)** — variable usage analysis showing SET/USE line numbers, unused variable detection
- **SCREEN$ viewer** — canvas rendering with invert toggle, PNG export (1x/2x/4x), slideshow with auto-play for multiple screens
- **Font viewer** — renders 768-byte ZX Spectrum fonts as character grids with sample text, PNG export (named after the source file), and **TTF conversion**
- **Icon viewer** — renders 256-byte 32×64 monochrome icons (Larken `.CG` files) with invert toggle and PNG export at up to 8x scale
- **Data arrays** — numeric and character array values with dimensions
- **Text viewer** — auto-detected for word processor and plain text files (90%+ printable)
- **Hex viewer** — raw byte inspection

### TS2068 Token Support
- Auto-disambiguates `ON ERR`, `STICK`, `SOUND`, `FREE`, `RESET` from ZX Spectrum characters using context heuristics
- Manual toggle: Auto / TS2068 / Spectrum modes
- Handles all five `ON ERR` variants (GO TO, GO SUB, RESET, CONTINUE, STOP)

### Disk Command Highlighting
- **Oliger**: `OUT 244,1` ROM paging + `LOAD /"name"` syntax
- **Larken**: `USR 100` activation + `PRINT #4:` channel shorthand + `OPEN #4,"dd"` setup

### BASIC Editing
- Double-click any line to edit inline
- Smart re-tokenization: only edited lines re-tokenized, unedited lines preserve original binary
- Edits tracked per-file across the entire disk with EDITED badges
- Per-line revert and Revert All
- All extraction paths export edited versions

### TAP Package Bundling
- **Auto-detected**: scans BASIC LOAD commands and matches to catalog entries
- **Manual assembly**: drag files onto each other, reorder within packages, remove with x button
- **Auto/Manual PKG toggle** per disk
- Extract as Package creates single multi-file TAP

### State Capture & Snapshot Support
- Oliger type-4 state captures, SNA and Z80 emulator snapshots
- BASIC programs extracted from memory via system variable pointers
- Variable viewer shows runtime state
- **Extract BASIC** button saves extracted program as standalone TAP
- SCREEN$ extracted and viewable from snapshots

### Extraction & Export
- **Extract Selected** / **Extract as Package** / **Extract All** — single-file and single-package extracts now prompt for a filename so you can fix mismatched directory/block names or disambiguate same-named programs
- **Archive.org export** — toolbar button bundles either the original disk image as a ZIP or the extracted files into a folder, both using TOSEC-style naming `Title (Year)(Publisher)(System)(Country)(Type).tap`. Publisher field remembers history with autocomplete.
- Auto-exports alongside TAP/raw files:
  - BASIC listings → `.txt`
  - Text/word processor files → `.txt`
  - Fonts (768-byte CODE) → `.ttf`
  - Screens (6912-byte CODE) → `.png`
- **Batch export**: "All Fonts" and "All Screens" toolbar buttons
- **Save PDF** — formatted BASIC listing with syntax highlighting
- **Create TAP** — import external files, configure headers, save as `.tap`
- **Extraction manifest** — `manifest.md` with disk metadata and file mapping
- **Disk map** — color-coded block allocation visualization

### Analysis
- **BASIC cross-reference** — variable usage with SET/USE line numbers and unused detection
- **Disk map** — block allocation grid with file colors, hover info, and legend
- **Smart issue flags** — files with corrupted directory entries, truncated blocks, or mismatched block headers get a red ⚠ ISSUE badge; click it for the full detail. Especially useful for hand-edited Larken disks.

### Smart File Detection
- **Larken** — content-based type detection looks past the filename extension and verifies actual file content. Catches `.B1` files that are really CODE and `.C1` files that are really BASIC (common on user-edited disks). AUTOSTART, NMI-S[1-5].CM, and SCREEN.CM files are recognized as memory snapshots with explanatory notes.
- **Oliger V1** — handles raw Spectrum BASIC streams with optional orphan first-line bodies (Disk21 layout) and BASIC embedded deep inside memory-dump slots (Disk20 layout). Shared loader templates are reclassified as CODE so the unique payload is preserved.

## Installation

Download the latest release from [Releases](https://github.com/factus10/TS2068-Disk-Explorer/releases):

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

### Type Checking

```bash
npx tsc --noEmit                              # Renderer (src/)
npx tsc -p tsconfig.electron.json --noEmit    # Main process (electron/)
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl+O | Open file |
| Cmd/Ctrl+B | Toggle file browser sidebar |
| Cmd/Ctrl+F | Focus search / filter files |
| Cmd/Ctrl+Shift+A | Create TAP from files |
| Click | Select single file |
| Cmd/Ctrl+Click | Toggle individual file in selection |
| Shift+Click | Select range from last click to current |
| Arrow Up/Down | Navigate file list |
| Enter | Open viewer for selected file |
| Space | Expand/collapse package or directory |
| Escape | Close viewer / exit search |
| F1 | Open help |

## Architecture

All file I/O and parsing runs in the **main process**. The renderer communicates via IPC and only receives serialized data (no Buffer objects cross the boundary).

Format detection order: extension-based (.tap/.tzx/.sna/.z80/.scr/.mgt) → magic bytes (Zebra, QL) → boot sector heuristics (Aerco, Larken, Oliger) → size fallback (MGT, SNA, SCR). See `electron/parsers/detect.ts`.

## License

[GPL v3](LICENSE)
