# TS-2068 Disk Browser

Cross-platform desktop app for browsing and extracting files from vintage Timex Sinclair 2068 and ZX Spectrum disk images and TAP tape files.

Built with Electron, React, and TypeScript.

## Features

- **Drag-and-drop** disk images or TAP files to browse their file catalogs
- **Auto-detect** disk format from file contents (no manual selection needed)
- **Sortable file table** with type badges, sizes, and block maps
- **Content viewers** — tabbed panel auto-selects the best view for each file type:
  - **BASIC listing** with syntax highlighting (statements, functions, operators, UDG, block graphics)
  - **SCREEN$ viewer** — canvas rendering of 6912-byte screens with invert toggle and PNG export
  - **Data array decoder** — numeric and character array values with dimensions
  - **Hex viewer** for raw byte inspection
- **TS2068 token support** — auto-disambiguates extended tokens (`ON ERR`, `STICK`, `SOUND`, `FREE`, `RESET`) from ZX Spectrum characters, with manual Auto/TS2068/Spectrum toggle
- **Disk command highlighting** — detects and highlights DOS-specific I/O commands:
  - Oliger: `OUT 244,1` ROM paging + `LOAD /"name"` syntax
  - Larken: `RANDOMIZE USR 100:` / `PRINT #4:` activation + `OPEN #4,"dd"` setup
- **TAP file support** — open `.tap` files directly; each header+data pair shown as a catalog entry with full viewer support
- **TAP package bundling** — auto-detects BASIC programs that LOAD other files and bundles them into a single multi-file TAP for emulator compatibility
- **State capture support** — Oliger type-4 state captures and ABS memory dumps with extracted BASIC listing
- **TAP export** for ZX Spectrum-compatible files (BASIC, CODE, arrays)
- **Memory dump export** with auto-generated BASIC loader
- **Extraction manifest** — `manifest.md` generated alongside extracted files with disk metadata and file mapping
- **Resizable viewer panel** — drag the edge to resize the content viewer
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

- **BASIC programs** → Listing tab (syntax-highlighted, with line numbers and autostart indicator) + Hex tab
- **CODE files (6912 bytes)** → Screen tab (ZX Spectrum display with color attributes) + Hex tab
- **Numeric/string arrays** → Array tab (decoded values with dimensions) + Hex tab
- **State captures** → Listing tab (BASIC extracted from memory via system variable pointers) + Hex tab
- **Everything else** → Hex tab

The TS2068 token toggle (Auto / TS2068 / Spectrum) appears on the listing tab for programs that may use extended keywords.

## TAP Package Bundling

On disk systems each file is standalone, but on tape (TAP format) a BASIC program and the files it LOADs must appear sequentially in the same file. The app scans BASIC programs for LOAD commands, matches them to catalog entries, and groups them into packages:

- Supports tape-style `LOAD ""CODE`, Oliger disk-style `LOAD /"name"CODE`, and Larken `RANDOMIZE USR 100: LOAD "name"`
- SCREEN$ loads validated against 6912-byte size
- Package loaders show a **PKG** badge in the file table
- Expand a package row to see its dependencies
- **Extract as Package** exports a single multi-file TAP
- **Extract All** bundles packages by default

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
