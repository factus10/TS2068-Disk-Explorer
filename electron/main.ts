import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getRecent, addRecent, clearRecent } from './recent-files';
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
import { buildXRef } from './parsers/basic-xref';
import type { XRefResult } from './parsers/basic-xref';
import { rebuildBasicProgram } from './parsers/basic-editor';
import { buildTtfFont, isFontFile } from './parsers/font-export';
import { encodePng } from './parsers/png-export';
import { makeSafeFilename, uniquePath } from './parsers/utils';
import type { DiskImage, DiskFormat, FileEntry, ExtractionResult, TapPackage, DiskHeader } from './parsers/types';
import type { BasicListing, Ts2068Mode } from './parsers/basic-detokenizer';
import type { ScreenData } from './parsers/screen-decoder';
import type { ArrayData } from './parsers/array-decoder';

let mainWindow: BrowserWindow | null = null;
let helpWindow: BrowserWindow | null = null;
let pendingFilePath: string | null = null;

// macOS file association: open-file can fire before app is ready
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('menu-open-recent', filePath);
  } else {
    pendingFilePath = filePath;
  }
});

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

  // Handle pending file from open-file event (macOS file association)
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingFilePath) {
      mainWindow?.webContents.send('menu-open-recent', pendingFilePath);
      pendingFilePath = null;
    }
  });

  buildMenu();
}

function openHelpWindow() {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return;
  }

  helpWindow = new BrowserWindow({
    width: 850,
    height: 650,
    title: 'TS-2068 Disk Browser Help',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const helpPath = process.env.VITE_DEV_SERVER_URL
    ? path.join(app.getAppPath(), 'help/help.html')
    : path.join(__dirname, '../help/help.html');

  helpWindow.loadFile(helpPath);
  helpWindow.setMenuBarVisibility(false);
  helpWindow.on('closed', () => { helpWindow = null; });
}

function buildMenu() {
  const recentFiles = getRecent();
  const recentSubmenu: Electron.MenuItemConstructorOptions[] = recentFiles.map((fp) => ({
    label: path.basename(fp),
    click: () => mainWindow?.webContents.send('menu-open-recent', fp),
  }));
  if (recentSubmenu.length > 0) {
    recentSubmenu.push({ type: 'separator' });
    recentSubmenu.push({ label: 'Clear Recent', click: () => { clearRecent(); buildMenu(); } });
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-open-file'),
        },
        {
          label: 'Create TAP...',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow?.webContents.send('menu-create-tap'),
        },
        {
          label: 'Recent Files',
          submenu: recentSubmenu.length > 0 ? recentSubmenu : [{ label: 'No Recent Files', enabled: false }],
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
    {
      label: 'Help',
      submenu: [
        {
          label: 'TS-2068 Disk Browser Help',
          accelerator: 'F1',
          click: () => openHelpWindow(),
        },
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

  const disk = parseDiskImage(result.filePaths[0]);
  addRecent(result.filePaths[0]);
  buildMenu();
  return disk;
});

ipcMain.handle('open-path', async (_event, filePath: string) => {
  const disk = parseDiskImage(filePath);
  addRecent(filePath);
  buildMenu();
  return disk;
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

  // Auto-export extras: fonts as TTF, screens as PNG, BASIC/text as TXT
  for (const entry of allEntries) {
    if (entry.isDirectory) continue;
    const fileData = fileDataMap.get(entry.index);
    if (!fileData) continue;
    const safeName = makeSafeFilename(entry.filename.trim());
    if (!safeName) continue;

    if (isFontFile(fileData.length, entry.type)) {
      const ttfData = buildTtfFont(fileData, safeName);
      const ttfPath = uniquePath(path.join(destDir, safeName + '.ttf'));
      fs.writeFileSync(ttfPath, ttfData);
    }

    if (entry.type === 'code' && fileData.length === SCREEN_SIZE) {
      const screen = decodeScreen(fileData);
      const pngData = encodePng(screen.rgba, 2);
      const pngPath = uniquePath(path.join(destDir, safeName + '.png'));
      fs.writeFileSync(pngPath, pngData);
    }

    // BASIC programs → .txt listing
    if (entry.type === 'basic') {
      const varsOffset = entry.params.varsOffset ?? entry.params.param2;
      const listing = detokenize(fileData, varsOffset);
      if (listing.lines.length > 0) {
        const txt = listingToText(listing);
        const txtPath = uniquePath(path.join(destDir, safeName + '.txt'));
        fs.writeFileSync(txtPath, txt);
      }
    }

    // State captures → .txt extracted BASIC listing
    if (entry.type === 'state' || entry.isMemoryDump) {
      const origin = format.startsWith('oliger') ? 0x3E00 : 0x4000;
      const stateInfo = extractBasicFromState(fileData, origin);
      if (stateInfo) {
        const listing = detokenize(stateInfo.basicData);
        if (listing.lines.length > 0) {
          const txt = listingToText(listing);
          const txtPath = uniquePath(path.join(destDir, safeName + '.txt'));
          fs.writeFileSync(txtPath, txt);
        }
      }
    }

    // Text/word processor files → .txt
    if (isTextContent(fileData)) {
      const txt = decodeTextContent(fileData);
      const txtPath = uniquePath(path.join(destDir, safeName + '.txt'));
      fs.writeFileSync(txtPath, txt);
    }
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

ipcMain.handle('get-basic-xref', async (_event, imagePath: string, entryIndex: number, ts2068Mode: Ts2068Mode = 'auto'): Promise<XRefResult | null> => {
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

  let listing: BasicListing | null = null;
  if (entry.type === 'state' || entry.isMemoryDump) {
    const origin = format.startsWith('oliger') ? 0x3E00 : 0x4000;
    const stateInfo = extractBasicFromState(fileData, origin);
    if (stateInfo) listing = detokenize(stateInfo.basicData, undefined, ts2068Mode);
  } else if (entry.type === 'basic') {
    const varsOffset = entry.params.varsOffset ?? entry.params.param2;
    listing = detokenize(fileData, varsOffset, ts2068Mode);
  }

  if (!listing) return null;
  return buildXRef(listing);
});

ipcMain.handle('get-disk-map', async (_event, imagePath: string): Promise<{ totalBlocks: number } | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  // Estimate total blocks from file size and block size
  const blockSizes: Record<string, number> = {
    'larken': 5120, 'oliger-v1': 5120, 'oliger-v2': 5120,
    'aerco-dos64': 5120, 'aerco-rpm': 2048, 'zebra-dirscp': 4096,
    'zebra-cpm': 4096, 'ql': 1536, 'tap': 0,
  };
  const blockSize = blockSizes[format] ?? 5120;
  if (blockSize === 0) return null;

  const totalBlocks = Math.floor(buffer.length / blockSize);
  return { totalBlocks };
});

// Batch export: all fonts as TTF
ipcMain.handle('export-all-fonts', async (_event, imagePath: string, destDir: string): Promise<number> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return 0;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);
  fs.mkdirSync(destDir, { recursive: true });
  let count = 0;

  for (const entry of allEntries) {
    if (entry.isDirectory) continue;
    const fileData = parser.readFileData(buffer, entry);
    if (!fileData || !isFontFile(fileData.length, entry.type)) continue;

    const safeName = makeSafeFilename(entry.filename.trim());
    if (!safeName) continue;
    const ttfData = buildTtfFont(fileData, safeName);
    const ttfPath = uniquePath(path.join(destDir, safeName + '.ttf'));
    fs.writeFileSync(ttfPath, ttfData);
    count++;
  }

  return count;
});

// Batch export: all screens as PNG
ipcMain.handle('export-all-screens', async (_event, imagePath: string, destDir: string): Promise<number> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return 0;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);
  fs.mkdirSync(destDir, { recursive: true });
  let count = 0;

  for (const entry of allEntries) {
    if (entry.isDirectory) continue;
    const fileData = parser.readFileData(buffer, entry);
    if (!fileData || entry.type !== 'code' || fileData.length !== SCREEN_SIZE) continue;

    const safeName = makeSafeFilename(entry.filename.trim());
    if (!safeName) continue;
    const screen = decodeScreen(fileData);
    const pngData = encodePng(screen.rgba, 2);
    const pngPath = uniquePath(path.join(destDir, safeName + '.png'));
    fs.writeFileSync(pngPath, pngData);
    count++;
  }

  return count;
});

// Print BASIC listing to PDF
ipcMain.handle('print-listing-pdf', async (
  _event, imagePath: string, entryIndex: number, ts2068Mode: Ts2068Mode = 'auto',
): Promise<string | null> => {
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

  let listing: BasicListing | null = null;
  if (entry.type === 'state' || entry.isMemoryDump) {
    const origin = format.startsWith('oliger') ? 0x3E00 : 0x4000;
    const stateInfo = extractBasicFromState(fileData, origin);
    if (stateInfo) listing = detokenize(stateInfo.basicData, undefined, ts2068Mode);
  } else if (entry.type === 'basic') {
    const varsOffset = entry.params.varsOffset ?? entry.params.param2;
    listing = detokenize(fileData, varsOffset, ts2068Mode);
  }

  if (!listing || listing.lines.length === 0) return null;

  // Build HTML for the listing
  const tokenColors: Record<string, string> = {
    statement: '#4ecdc4', function: '#fce38a', operator: '#f0a050',
    'disk-cmd': '#ff6b6b', 'ts2068-kw': '#c084fc', udg: '#ff6b6b',
    graphic: '#a0a0b0', text: '#e0e0e0',
  };

  const linesHtml = listing.lines.map((line) => {
    const tokensHtml = line.tokens.map((tok) => {
      const color = tokenColors[tok.type] ?? '#e0e0e0';
      const escaped = tok.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<span style="color:${color}">${escaped}</span>`;
    }).join('');
    return `<div><span class="ln">${String(line.lineNumber).padStart(5, ' ')}</span> ${tokensHtml}</div>`;
  }).join('\n');

  const html = `<!DOCTYPE html><html><head><style>
    body { background: #1a1a2e; color: #e0e0e0; font-family: monospace; font-size: 11px; line-height: 18px; padding: 20px; margin: 0; }
    .ln { color: #666680; }
    div { white-space: pre-wrap; }
    h1 { color: #e94560; font-size: 16px; margin-bottom: 12px; }
  </style></head><body>
  <h1>${entry.filename.trim()}</h1>
  ${linesHtml}
  </body></html>`;

  // Save dialog
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: makeSafeFilename(entry.filename.trim()) + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;

  // Create hidden window, load HTML, print to PDF
  const printWin = new BrowserWindow({ show: false, width: 800, height: 600 });
  await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  const pdfData = await printWin.webContents.printToPDF({
    printBackground: true,
    landscape: false,
    pageSize: 'A4',
  });

  fs.writeFileSync(result.filePath, pdfData);
  printWin.close();

  return result.filePath;
});

// Create TAP from external files
ipcMain.handle('select-files-for-tap', async (): Promise<string[] | null> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

interface TapFileSpec {
  filePath: string;
  tapName: string;
  tapType: number; // 0=BASIC, 3=CODE
  param1: number;  // autostart line or start address
  param2: number;  // vars offset or 32768
}

ipcMain.handle('create-tap-from-files', async (
  _event, specs: TapFileSpec[], destPath: string,
): Promise<string | null> => {
  const parts: Buffer[] = [];

  for (const spec of specs) {
    const fileData = fs.readFileSync(spec.filePath);

    const entry: FileEntry = {
      index: 0,
      filename: spec.tapName.padEnd(10, ' '),
      type: spec.tapType === 0 ? 'basic' : 'code',
      typeName: spec.tapType === 0 ? 'BASIC' : 'CODE',
      size: fileData.length,
      params: {
        autostartLine: spec.tapType === 0 ? spec.param1 : 0,
        startAddr: spec.tapType === 3 ? spec.param1 : 0,
        varsOffset: spec.tapType === 0 ? spec.param2 : 0,
        param1: spec.param1,
        param2: spec.param2,
      },
      blocks: [],
      isMemoryDump: false,
      isDirectory: false,
      metadata: {},
    };

    parts.push(buildTapFile(entry, fileData));
  }

  const tapData = Buffer.concat(parts);
  fs.writeFileSync(destPath, tapData);
  return destPath;
});

/** Check if file data is predominantly printable text. */
function isTextContent(data: Buffer): boolean {
  if (data.length === 0) return false;
  let printable = 0;
  const len = Math.min(data.length, 2048);
  for (let i = 0; i < len; i++) {
    const b = data[i];
    if ((b >= 0x20 && b <= 0x7e) || b === 0x0d || b === 0x0a || b === 0x09) printable++;
  }
  return printable / len >= 0.9;
}

/** Decode text content from a Buffer to a string. */
function decodeTextContent(data: Buffer): string {
  let text = '';
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === 0x0d) text += '\n';
    else if (b === 0x0a) continue;
    else if (b >= 0x20 && b <= 0x7e) text += String.fromCharCode(b);
    else if (b === 0x09) text += '\t';
  }
  return text;
}

/** Convert a BASIC listing to plain text with line numbers. */
function listingToText(listing: BasicListing): string {
  const maxLn = listing.lines.length > 0
    ? Math.max(...listing.lines.map((l) => l.lineNumber))
    : 0;
  const width = String(maxLn).length;
  return listing.lines.map((line) => {
    const text = line.tokens.map((t) => t.text).join('');
    return `${String(line.lineNumber).padStart(width, ' ')} ${text}`;
  }).join('\n') + '\n';
}

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
