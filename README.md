# TS-2068 Disk Browser

Cross-platform desktop app for browsing and extracting files from vintage Timex Sinclair 2068 and ZX Spectrum disk images.

Built with Electron, React, and TypeScript.

## Features

- **Drag-and-drop** disk images to browse their file catalogs
- **Auto-detect** disk format from file contents (no manual selection needed)
- **Sortable file table** with type badges, sizes, and block maps
- **Hex viewer** for inspecting raw file contents
- **TAP export** for ZX Spectrum-compatible files (BASIC, CODE, arrays)
- **TAP package bundling** — auto-detects BASIC programs that LOAD other files and bundles them into a single multi-file TAP for emulator compatibility
- **Memory dump export** with auto-generated BASIC loader
- **Extract All** bundles detected packages automatically; standalone files export individually
- **Multi-select** with Cmd/Ctrl+click for batch extraction

## Supported Disk Formats

| Format | Extensions | Notes |
|--------|-----------|-------|
| Larken LKDOS | `.img` | TAP export with memory dumps |
| Oliger JLO SAFE V1 | `.img` | TAP export with heuristic type detection |
| Oliger JLO SAFE V2 | `.img` | TAP export with ABS state saves |
| Aerco DOS-64 | `.img` | TAP for BASIC/CODE, raw for MODULE |
| Aerco RP/M | `.img` | Raw binary (CP/M-compatible files) |
| Zebra DIRSCP | `.dsk` | CPC DSK with hierarchical directories |
| Zebra CP/M | `.dsk` | CPC DSK flat catalog |
| Sinclair QL | `.img` | QL5A/QL5B raw binary |

## TAP Package Bundling

On disk systems each file is standalone, but on tape (TAP format) a BASIC program and the files it LOADs must appear sequentially in the same file. The app scans BASIC programs for LOAD commands, matches them to catalog entries, and groups them into packages:

- Supports both tape-style `LOAD ""CODE` and Oliger disk-style `LOAD /"name"CODE`
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

Format detection is automatic based on magic bytes, boot sector patterns, and directory structure markers. See `electron/parsers/detect.ts` for the detection order.

## License

[GPL v3](LICENSE)
