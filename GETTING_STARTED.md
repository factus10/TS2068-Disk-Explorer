# Getting Started with TS-2068 Disk Browser

This guide walks you through the main features of the app using example disk images.

## Opening a File

There are three ways to open a file:

1. **Drag and drop** — drag a `.img`, `.dsk`, `.tap`, `.tzx`, `.sna`, `.z80`, `.scr`, or `.mgt` file onto the app window
2. **File menu** — click **Open** or press **Cmd/Ctrl+O** and select a file
3. **Recent files** — click **File → Recent Files** to reopen a previously viewed file

The app auto-detects the format — you don't need to tell it what kind of file you're opening.

## Browsing Files

Once a file is open, you'll see:

- **Disk info bar** at the top showing the format, disk name, and geometry
- **Disk map** showing color-coded block allocation (for disk images)
- **File table** listing all files with type badges, sizes, and block numbers

### Navigating the File Table

- **Click** a file to select it
- **Cmd/Ctrl+Click** to multi-select
- **Arrow keys** to move up/down
- **Cmd/Ctrl+F** to search/filter by filename
- Click column headers to sort

### Package Badges

Files that auto-detected as TAP packages show a red **PKG** badge. Click the expand arrow (or press **Space**) to see the files that would be bundled together.

## Viewing File Contents

**Double-click** a file or press **Enter** to open the content viewer panel on the right. The viewer automatically picks the best tab:

### BASIC Programs
- **Listing** tab — syntax-highlighted code with line numbers
  - Statements in cyan, functions in yellow, operators in orange
  - Disk commands (LOAD /, RANDOMIZE USR 100, etc.) highlighted in red
  - TS2068 keywords (ON ERR, SOUND, etc.) in purple
  - Use the **Tokens** toggle to switch between Auto/TS2068/Spectrum interpretation
- **Variables** tab — all runtime variables with types and values
- **XRef** tab — cross-reference showing which variables are used on which lines

### Screens (6912-byte CODE files)
- Rendered as a ZX Spectrum display with color attributes
- **Invert** button to swap ink/paper
- **Prev/Next** and **Play** buttons for slideshow when multiple screens exist
- **Save PNG** at 1x, 2x, or 4x scale

### Fonts (768-byte CODE files)
- Character grid showing all 96 printable characters
- Live **sample text** preview — type to see your text in the font
- **Save PNG** of the character grid
- **Save TTF** — converts the bitmap font to a TrueType font you can install on your computer

### Other File Types
- **Arrays** — decoded numeric/character values with dimensions
- **Text** — clean monospace display for word processor files
- **Hex** — raw byte dump (always available as the last tab)

### Tips
- The viewer panel is **resizable** — drag the left edge
- When the viewer is open, **clicking a different file** in the table auto-switches to it
- **Copy** button on text and listing views copies content to clipboard

## Editing BASIC Programs

1. View a BASIC program in the Listing tab
2. **Double-click** any line to edit it
3. Make your changes and press **Enter** (or **Escape** to cancel)
4. Edited lines show in teal with a revert arrow (↶)
5. The file gets an **EDITED** badge in the file table
6. Click **Revert all** to undo all edits for a file

Edits persist across viewer open/close and work across multiple files. When you extract, edited files are exported with your changes — only edited lines are re-tokenized, preserving the original binary for everything else.

## Extracting Files

### Single File
Select a file and click **Extract Selected**, then choose an output directory.

### TAP Package
Select a package loader (a file with a PKG badge) and click **Extract as Package**. This creates a single multi-file `.tap` with the loader and all its dependencies in the correct order for emulator loading.

### All Files
Click **Extract All** to extract everything. The app will:
- Bundle auto-detected packages into multi-file TAPs
- Export remaining files individually
- Auto-generate alongside each file:
  - `.txt` for BASIC listings and text files
  - `.ttf` for font files
  - `.png` for screen files
- Create a `manifest.md` with disk metadata and file mapping

## Manual TAP Package Assembly

If the auto-detection doesn't group files the way you want:

1. Click **Manual PKG** in the toolbar to switch to flat file list mode
2. **Drag** one file onto another to create a package
3. **Expand** the package and drag within it to reorder
4. **Drag** more files from the main list into the package
5. Click the **x** button on any file to remove it from the package
6. Use **Extract as Package** to export

Manual packages show a teal badge with a pencil icon.

## Creating TAP Files from Scratch

1. Click **Create TAP** in the toolbar (or **Cmd/Ctrl+Shift+A**, or File → Create TAP)
2. Click **Add Files** to select files from your computer
3. For each file, configure:
   - **Name** — the 10-character TAP filename
   - **Type** — BASIC, CODE, Numeric Array, or String Array
   - **Address/Autostart** — load address (CODE) or autostart line (BASIC)
4. Use the arrow buttons to reorder files
5. Click **Save TAP** and choose where to save

## State Captures and Snapshots

The app can extract BASIC programs from:
- **Oliger type-4 state captures** on disk images
- **SNA snapshots** (`.sna` — 48K emulator saves)
- **Z80 snapshots** (`.z80` — v1/v2/v3 with decompression)

When viewing a state capture:
- The **Listing** tab shows the extracted BASIC program
- The **Variables** tab shows all runtime variables
- The **Extract BASIC** button saves the program as a standalone `.tap` file

SNA and Z80 snapshots also show the SCREEN$ at the time of capture.

## Batch Export

When a disk contains fonts or screens, extra buttons appear in the toolbar:
- **All Fonts** — exports all 768-byte font files as `.ttf`
- **All Screens** — exports all 6912-byte screen files as `.png`

## Printing

On the Listing tab, click **Save PDF** to export a syntax-highlighted BASIC listing as a PDF document.

## Disk Map

Below the disk info, a color-coded grid shows how blocks are allocated across the disk. Hover over any block to see which file it belongs to. The legend at the bottom maps colors to filenames.

## Theme

Click the sun/moon button (☀/☽) in the toolbar to toggle between dark and light themes. Your preference is saved across sessions.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl+O | Open file |
| Cmd/Ctrl+F | Search/filter files |
| Cmd/Ctrl+Shift+A | Create TAP from files |
| Arrow Up/Down | Navigate file list |
| Enter | Open viewer |
| Space | Expand/collapse |
| Escape | Close viewer / exit search |
| F1 | Open help |
