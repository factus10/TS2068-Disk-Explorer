import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { detectFormat } from './parsers/detect';
import { readCatalog as readLarken, readFileData as readLarkenFile } from './parsers/larken';
import { readCatalog as readOliger, readFileData as readOligerFile } from './parsers/oliger';
import { readCatalog as readAerco, readFileData as readAercoFile } from './parsers/aerco';
import { readCatalog as readZebra, readFileData as readZebraFile } from './parsers/zebra';
import { readCatalog as readQL, readFileData as readQLFile } from './parsers/ql';
import { readCatalog as readTap, readFileData as readTapFile } from './parsers/tap-reader';
import { buildTapFile, buildDumpTap, buildMultiFileTap } from './parsers/tap';
import { buildTapPackages } from './parsers/basic-analyzer';
import { detokenize } from './parsers/basic-detokenizer';
import { decodeScreen, SCREEN_SIZE } from './parsers/screen-decoder';
import { decodeNumericArray, decodeCharArray } from './parsers/array-decoder';
import { extractBasicFromState } from './parsers/state-extract';
import { parseVariables } from './parsers/basic-variables';
import type { BasicVariable } from './parsers/basic-variables';
import { rebuildBasicProgram } from './parsers/basic-editor';
import { makeSafeFilename, uniquePath } from './parsers/utils';
import type { DiskImage, DiskFormat, FileEntry, ExtractionResult, TapPackage, DiskHeader } from './parsers/types';
import type { BasicListing, Ts2068Mode } from './parsers/basic-detokenizer';
import type { ScreenData } from './parsers/screen-decoder';
import type { ArrayData } from './parsers/array-decoder';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    ...(fs.existsSync(path.join(__dirname, '../build/icon.png'))
      ? { icon: path.join(__dirname, '../build/icon.png') }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'TS-2068 Disk Browser',
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  buildMenu();
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Disk Image...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-open-file'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function getParser(format: DiskFormat) {
  switch (format) {
    case 'larken': return { readCatalog: readLarken, readFileData: readLarkenFile };
    case 'oliger-v1':
    case 'oliger-v2': return { readCatalog: readOliger, readFileData: readOligerFile };
    case 'aerco-dos64':
    case 'aerco-rpm': return { readCatalog: readAerco, readFileData: readAercoFile };
    case 'zebra-dirscp':
    case 'zebra-cpm': return { readCatalog: readZebra, readFileData: readZebraFile };
    case 'ql': return { readCatalog: readQL, readFileData: readQLFile };
    case 'tap': return { readCatalog: readTap, readFileData: readTapFile };
    default: throw new Error(`Unknown format: ${format}`);
  }
}

function parseDiskImage(filePath: string): DiskImage {
  const buffer = fs.readFileSync(filePath);
  const format = detectFormat(buffer, filePath);
  if (!format) {
    throw new Error('Unrecognized disk image format');
  }

  const parser = getParser(format);
  const { header, entries } = parser.readCatalog(buffer);

  return {
    path: filePath,
    format,
    header,
    catalog: entries,
  };
}

// IPC Handlers

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Disk & Tape Images', extensions: ['img', 'dsk', 'tap', 'IMG', 'DSK', 'TAP'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return parseDiskImage(result.filePaths[0]);
});

ipcMain.handle('open-path', async (_event, filePath: string) => {
  return parseDiskImage(filePath);
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('extract-file', async (
  _event, imagePath: string, entryIndex: number, destDir: string,
  editedLines?: Record<number, string>,
): Promise<ExtractionResult | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);
  const entry = allEntries.find((e) => e.index === entryIndex);
  if (!entry) return null;

  const fileData = parser.readFileData(buffer, entry);
  if (!fileData) return null;

  fs.mkdirSync(destDir, { recursive: true });

  return writeExtractedFile(destDir, entry, fileData, format, editedLines);
});

ipcMain.handle('extract-all', async (
  _event, imagePath: string, destDir: string,
  allEdits?: Record<number, Record<number, string>>,
): Promise<ExtractionResult[]> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return [];

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);

  fs.mkdirSync(destDir, { recursive: true });
  const results: ExtractionResult[] = [];

  // Read all file data up front for package detection
  const fileDataMap = new Map<number, Buffer>();
  for (const entry of allEntries) {
    if (entry.isDirectory) continue;
    const data = parser.readFileData(buffer, entry);
    if (data) fileDataMap.set(entry.index, data);
  }

  // Detect packages for TAP-capable formats
  const usesTap = ['larken', 'oliger-v1', 'oliger-v2', 'aerco-dos64'].includes(format);
  const packages = usesTap ? buildTapPackages(entries, fileDataMap) : [];
  const bundledIndices = new Set<number>();

  // Extract packages as multi-file TAPs
  for (const pkg of packages) {
    const tapData = buildMultiFileTap(pkg, fileDataMap, allEdits);
    if (!tapData) continue;

    const safeName = makeSafeFilename(pkg.loader.filename.trim());
    const tapPath = uniquePath(path.join(destDir, (safeName || 'package') + '.tap'));
    fs.writeFileSync(tapPath, tapData);

    results.push({
      filename: pkg.loader.filename,
      outputPaths: [tapPath],
      format: 'tap',
      size: tapData.length,
    });

    bundledIndices.add(pkg.loader.index);
    for (const dep of pkg.dependencies) {
      bundledIndices.add(dep.index);
    }
  }

  // Extract remaining files individually
  for (const entry of allEntries) {
    if (entry.isDirectory || bundledIndices.has(entry.index)) continue;
    const fileData = fileDataMap.get(entry.index);
    if (!fileData) continue;
    const edits = allEdits?.[entry.index];
    const result = writeExtractedFile(destDir, entry, fileData, format, edits);
    if (result) results.push(result);
  }

  // Write extraction manifest
  const { header } = parser.readCatalog(buffer);
  writeManifest(destDir, header, imagePath, results);

  return results;
});

ipcMain.handle('get-file-data', async (_event, imagePath: string, entryIndex: number): Promise<number[] | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const entry = entries[entryIndex];
  if (!entry) return null;

  const fileData = parser.readFileData(buffer, entry);
  if (!fileData) return null;

  // Return as number array for serialization across IPC
  return Array.from(fileData.slice(0, 65536));
});

ipcMain.handle('analyze-packages', async (_event, imagePath: string): Promise<TapPackage[]> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return [];

  // Only TAP-capable formats have packages
  if (!['larken', 'oliger-v1', 'oliger-v2', 'aerco-dos64'].includes(format)) return [];

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);

  // Read all BASIC files' content
  const fileDataMap = new Map<number, Buffer>();
  for (const entry of allEntries) {
    if (entry.isDirectory) continue;
    const data = parser.readFileData(buffer, entry);
    if (data) fileDataMap.set(entry.index, data);
  }

  return buildTapPackages(entries, fileDataMap);
});

ipcMain.handle('extract-package', async (
  _event, imagePath: string, loaderIndex: number, depIndices: number[], destDir: string,
  allEdits?: Record<number, Record<number, string>>,
): Promise<ExtractionResult | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);

  const loader = allEntries.find((e) => e.index === loaderIndex);
  if (!loader) return null;

  const deps = depIndices.map((i) => allEntries.find((e) => e.index === i)).filter(Boolean) as FileEntry[];

  // Read all file data
  const fileDataMap = new Map<number, Buffer>();
  for (const entry of [loader, ...deps]) {
    const data = parser.readFileData(buffer, entry);
    if (data) fileDataMap.set(entry.index, data);
  }

  const pkg: TapPackage = { loader, dependencies: deps, unresolved: [] };
  const tapData = buildMultiFileTap(pkg, fileDataMap, allEdits);
  if (!tapData) return null;

  fs.mkdirSync(destDir, { recursive: true });
  const safeName = makeSafeFilename(loader.filename.trim());
  const tapPath = uniquePath(path.join(destDir, (safeName || 'package') + '.tap'));
  fs.writeFileSync(tapPath, tapData);

  return {
    filename: loader.filename,
    outputPaths: [tapPath],
    format: 'tap',
    size: tapData.length,
  };
});

ipcMain.handle('get-basic-listing', async (_event, imagePath: string, entryIndex: number, ts2068Mode: Ts2068Mode = 'auto'): Promise<BasicListing | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);
  const entry = allEntries.find((e) => e.index === entryIndex);
  if (!entry) return null;

  const fileData = parser.readFileData(buffer, entry);
  if (!fileData) return null;

  // State capture: extract BASIC from memory dump using system variable pointers
  if (entry.type === 'state' || entry.isMemoryDump) {
    const origin = format.startsWith('oliger') ? 0x3E00 : 0x4000;
    const stateInfo = extractBasicFromState(fileData, origin);
    if (!stateInfo) return null;
    const listing = detokenize(stateInfo.basicData, undefined, ts2068Mode);
    listing.autostartLine = undefined; // state captures don't have a meaningful autostart
    return listing;
  }

  if (entry.type !== 'basic') return null;

  const varsOffset = entry.params.varsOffset ?? entry.params.param2;
  const listing = detokenize(fileData, varsOffset, ts2068Mode);
  const autostart = entry.params.autostartLine ?? entry.params.param1;
  if (autostart && autostart > 0 && autostart < 10000) {
    listing.autostartLine = autostart;
  }
  return listing;
});

ipcMain.handle('extract-basic-from-state', async (
  _event, imagePath: string, entryIndex: number, destDir: string,
): Promise<ExtractionResult | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);
  const entry = allEntries.find((e) => e.index === entryIndex);
  if (!entry) return null;

  const fileData = parser.readFileData(buffer, entry);
  if (!fileData) return null;

  const origin = format.startsWith('oliger') ? 0x3E00 : 0x4000;
  const stateInfo = extractBasicFromState(fileData, origin);
  if (!stateInfo) return null;

  // Build a FileEntry for the extracted BASIC program
  const basicEntry: FileEntry = {
    index: entry.index,
    filename: entry.filename,
    type: 'basic',
    typeName: 'BASIC',
    size: stateInfo.basicData.length + stateInfo.varsData.length,
    params: {
      autostartLine: 0,
      varsOffset: stateInfo.basicData.length,
      param1: 0,
      param2: stateInfo.basicData.length,
    },
    blocks: [],
    isMemoryDump: false,
    isDirectory: false,
    metadata: {},
  };

  const fullData = Buffer.concat([stateInfo.basicData, stateInfo.varsData]);
  const tapData = buildTapFile(basicEntry, fullData);

  fs.mkdirSync(destDir, { recursive: true });
  const safeName = makeSafeFilename(entry.filename.trim());
  const tapPath = uniquePath(path.join(destDir, (safeName || 'extracted') + '.tap'));
  fs.writeFileSync(tapPath, tapData);

  return {
    filename: entry.filename,
    outputPaths: [tapPath],
    format: 'tap',
    size: fullData.length,
  };
});

ipcMain.handle('get-basic-variables', async (_event, imagePath: string, entryIndex: number): Promise<BasicVariable[] | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);
  const entry = allEntries.find((e) => e.index === entryIndex);
  if (!entry) return null;

  const fileData = parser.readFileData(buffer, entry);
  if (!fileData) return null;

  // State capture: extract variables from memory
  if (entry.type === 'state' || entry.isMemoryDump) {
    const origin = format.startsWith('oliger') ? 0x3E00 : 0x4000;
    const stateInfo = extractBasicFromState(fileData, origin);
    if (!stateInfo || stateInfo.varsData.length === 0) return [];
    return parseVariables(stateInfo.varsData);
  }

  // Regular BASIC file: variables area starts at varsOffset
  if (entry.type !== 'basic') return null;
  const varsOffset = entry.params.varsOffset ?? entry.params.param2;
  if (!varsOffset || varsOffset >= fileData.length) return [];
  return parseVariables(Buffer.from(fileData.subarray(varsOffset)));
});

ipcMain.handle('get-screen-data', async (_event, imagePath: string, entryIndex: number, invert: boolean): Promise<number[] | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);
  const entry = allEntries.find((e) => e.index === entryIndex);
  if (!entry) return null;

  const fileData = parser.readFileData(buffer, entry);
  if (!fileData || fileData.length < SCREEN_SIZE) return null;

  const screen = decodeScreen(fileData, invert);
  return screen.rgba;
});

ipcMain.handle('get-array-data', async (_event, imagePath: string, entryIndex: number): Promise<ArrayData | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);
  const entry = allEntries.find((e) => e.index === entryIndex);
  if (!entry) return null;

  const fileData = parser.readFileData(buffer, entry);
  if (!fileData) return null;

  if (entry.type === 'num-array') return decodeNumericArray(fileData);
  if (entry.type === 'str-array') return decodeCharArray(fileData);
  return null;
});

function flattenEntries(entries: FileEntry[]): FileEntry[] {
  const flat: FileEntry[] = [];
  for (const e of entries) {
    flat.push(e);
    if (e.children) flat.push(...e.children);
  }
  return flat;
}

function writeManifest(
  destDir: string,
  header: DiskHeader,
  imagePath: string,
  results: ExtractionResult[],
): void {
  const lines: string[] = [];
  lines.push(`# Extraction Manifest`);
  lines.push('');
  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Source | ${path.basename(imagePath)} |`);
  lines.push(`| Format | ${header.formatName} |`);
  lines.push(`| Disk Name | ${header.diskName || '(none)'} |`);
  lines.push(`| Sides | ${header.sides} |`);
  lines.push(`| Tracks | ${header.tracks} |`);
  for (const [k, v] of Object.entries(header.extra)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');
  lines.push(`## Files (${results.length})`);
  lines.push('');
  lines.push(`| Original Name | Output File(s) | Format | Size |`);
  lines.push(`|--------------|----------------|--------|------|`);
  for (const r of results) {
    const outputs = r.outputPaths.map((p) => path.basename(p)).join(', ');
    lines.push(`| ${r.filename.trim()} | ${outputs} | ${r.format} | ${r.size.toLocaleString()} |`);
  }
  lines.push('');

  const manifestPath = path.join(destDir, 'manifest.md');
  fs.writeFileSync(manifestPath, lines.join('\n'));
}

function writeExtractedFile(
  destDir: string, entry: FileEntry, fileData: Buffer, format: DiskFormat,
  editedLines?: Record<number, string>,
): ExtractionResult | null {
  const safeName = makeSafeFilename(entry.filename.trim());
  if (!safeName) return null;

  // Determine output format based on disk format and file type
  const usesTap = ['larken', 'oliger-v1', 'oliger-v2', 'aerco-dos64', 'tap'].includes(format);

  if (entry.isMemoryDump) {
    const dumpPath = uniquePath(path.join(destDir, safeName + '.dump'));
    fs.writeFileSync(dumpPath, fileData);

    const origin = format.startsWith('oliger') ? 0x3E00 : 0x4000;
    const tapData = buildDumpTap(entry.filename.trim(), fileData, origin);
    const tapPath = uniquePath(path.join(destDir, safeName + '.tap'));
    fs.writeFileSync(tapPath, tapData);

    return {
      filename: entry.filename,
      outputPaths: [dumpPath, tapPath],
      format: 'dump+tap',
      size: fileData.length,
    };
  }

  if (usesTap && entry.type !== 'module') {
    // If this BASIC file has edits, rebuild with edited lines
    let tapData: Buffer;
    if (editedLines && entry.type === 'basic' && Object.keys(editedLines).length > 0) {
      const rebuilt = rebuildBasicProgram(fileData, editedLines, entry);
      if (!rebuilt) return null;
      tapData = rebuilt;
    } else {
      tapData = buildTapFile(entry, fileData);
    }
    const tapPath = uniquePath(path.join(destDir, safeName + '.tap'));
    fs.writeFileSync(tapPath, tapData);

    return {
      filename: entry.filename,
      outputPaths: [tapPath],
      format: 'tap',
      size: fileData.length,
    };
  }

  // Raw binary output
  const ext = entry.type === 'module' ? '.bin' : '';
  const outPath = uniquePath(path.join(destDir, safeName + ext));
  fs.writeFileSync(outPath, fileData);

  return {
    filename: entry.filename,
    outputPaths: [outPath],
    format: 'raw',
    size: fileData.length,
  };
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
