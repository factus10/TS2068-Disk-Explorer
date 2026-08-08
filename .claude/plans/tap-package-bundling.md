# TAP Package Bundling — Auto-detect LOAD dependencies

> **Delivered.** Every step below is implemented, and the app went further than
> the plan: manual packages alongside the auto-detected ones, an Auto PKG toggle,
> custom base names, and integration with the line editor. Kept for the record of
> how the format works and why it was built this way.
>
> Verified on the example disks: `larken.img` auto-detects `cale27.B1 → cale27.C1`
> and `time.B1 → time.C1`, both building valid multi-file TAPs, shown in the file
> table as `▶cale27.B1 PKG 1`.
>
> One known gap, narrow enough to have been left alone: `matchesLoadType` in
> `basic-analyzer.ts` accepts only `num-array`/`str-array` for a `LOAD "x" DATA`,
> so `tut-2` on `aerco-smart-text-demo.img` does not bind to the `ml` file it
> loads, which is typed `module`. Aerco MODULE is its own thing and it is arguable
> whether it should bind; those entries also currently report size 0, which is a
> separate bug.

## Context

On disk systems, each file is standalone. On tape (TAP format), a BASIC program and the files it LOADs must be sequential in the same TAP file. Currently, each file extracts to its own `.tap`. Users need a way to bundle a BASIC program with its CODE/DATA dependencies into a single multi-file TAP that works in emulators.

The approach: scan BASIC program content for LOAD commands, match referenced filenames to other files in the catalog, and auto-detect "TAP packages" that should be exported together.

## How ZX Spectrum BASIC LOAD works

In BASIC program bytes (after the 4-byte header: progLen + varsOffset):
- Lines: `[2B line# BE] [2B lineLen LE] [tokens...] [0x0D]`
- `LOAD "filename"` = `0xEF 0x22 [ascii chars] 0x22`
- `LOAD ""` (empty name = next file on tape) = `0xEF 0x22 0x22`
- Followed by optional type keyword: `CODE` (0xAF), `SCREEN$` (0xAA), `DATA` (0xE4)
- Numbers after tokens have inline 5-byte floats: `0x0E [5 bytes]`

## Implementation Plan

### 1. New module: `electron/parsers/basic-analyzer.ts`

Scans BASIC file content and extracts LOAD references:

```typescript
interface LoadReference {
  lineNumber: number;
  filename: string;       // "" means "next file on tape" (unnamed)
  loadType: 'any' | 'code' | 'screen' | 'data';
}

interface TapPackage {
  loader: FileEntry;              // The BASIC program
  dependencies: FileEntry[];      // Files it LOADs, in order
  unresolved: LoadReference[];    // LOADs that couldn't be matched
}

function scanBasicForLoads(content: Buffer): LoadReference[];
function buildTapPackages(catalog: FileEntry[], fileDataMap: Map<number, Buffer>): TapPackage[];
```

**`scanBasicForLoads`** — Parse BASIC line by line:
- Walk lines using `[2B lineNum BE] [2B lineLen LE] [body] [0x0D]`
- Scan body for `0xEF` (LOAD) token
- After LOAD, expect `0x22` (opening quote)
- Read filename chars until closing `0x22`
- Check next non-space byte for type: `0xAF`=CODE, `0xAA`=SCREEN$, `0xE4`=DATA

**`buildTapPackages`** — Match LOAD references to catalog entries:
- For each BASIC file in catalog, scan its content for LOADs
- Match by filename (case-insensitive, trimmed)
- For `LOAD ""` (empty name), match by type and adjacency — look for CODE/SCREEN$ files with same base name
- A file that appears as a dependency is removed from being a standalone package
- Return array of TapPackages + remaining unpackaged files

### 2. Add to catalog results: `FileEntry.dependencies`

In `electron/parsers/types.ts`, add to FileEntry:
```typescript
  /** Indices of files this BASIC program LOADs (auto-detected) */
  loadDependencies?: number[];
```

### 3. New IPC handler: `extract-package`

In `electron/main.ts`:
```typescript
ipcMain.handle('extract-package', async (_event, imagePath, entryIndices: number[], destDir):
  Promise<ExtractionResult>
```
- Reads all referenced entries
- Calls `buildTapFile()` for each in order
- Concatenates all TAP blocks into a single Buffer
- Writes one `.tap` file named after the BASIC loader

### 4. UI: Show packages in FileTable

**Approach:** After catalog loads, run the analyzer. Add visual grouping:

- BASIC files with detected dependencies show a package icon/badge
- Expanding a BASIC row shows its dependencies indented underneath (similar to Zebra directories)
- "Extract as Package" button (or right-click context menu) bundles them into one TAP
- "Extract All" uses packages by default when available — bundled files aren't also extracted standalone
- FileDetails panel shows "Loads: bold (CODE), screen$ (SCREEN$)" when a BASIC file is selected

**New state in App.tsx:**
```typescript
const [packages, setPackages] = useState<TapPackage[]>([]);
```
Computed when disk image loads via new IPC call `analyze-packages`.

### 5. New IPC: `analyze-packages`

In `electron/main.ts`:
```typescript
ipcMain.handle('analyze-packages', async (_event, imagePath): Promise<TapPackage[]>
```
- Reads all BASIC files' content
- Runs `scanBasicForLoads` on each
- Matches to catalog entries
- Returns package definitions

### 6. Files to modify

| File | Changes |
|------|---------|
| `electron/parsers/basic-analyzer.ts` | **NEW** — LOAD scanner + package builder |
| `electron/parsers/types.ts` | Add `loadDependencies?: number[]` to FileEntry, add `TapPackage` type |
| `electron/parsers/tap.ts` | Add `buildMultiFileTap(entries: {entry, data}[])` helper |
| `electron/main.ts` | Add `analyze-packages` and `extract-package` IPC handlers |
| `electron/preload.ts` | Expose `analyzePackages` and `extractPackage` |
| `src/api.ts` | Add `TapPackage` type, `analyzePackages`, `extractPackage` to API |
| `src/App.tsx` | Load packages on disk open, pass to FileTable, update Extract All |
| `src/components/FileTable.tsx` | Show package grouping, package badge, expand/collapse deps |
| `src/components/FileDetails.tsx` | Show LOAD dependencies when BASIC file selected |
| `src/components/Toolbar.tsx` | Add "Extract as Package" button |

## Verification

1. Open `larken.img` (copy from ../TS-2068-Disk-Imaging-Tools/examples/) — "bold" BASIC should auto-detect dependency on "bold" CODE
2. Open `oliger.img` — check that multi-LOAD programs package correctly
3. Extract a package → verify the .tap loads correctly in sequence (BASIC first, then CODE)
4. Extract All → verify bundled files appear once (in the package), not also standalone
5. Files with no LOAD commands remain standalone .tap files as before
