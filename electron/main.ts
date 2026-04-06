import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { detectFormat } from './parsers/detect';
import { readCatalog as readLarken, readFileData as readLarkenFile } from './parsers/larken';
import { readCatalog as readOliger, readFileData as readOligerFile } from './parsers/oliger';
import { readCatalog as readAerco, readFileData as readAercoFile } from './parsers/aerco';
import { readCatalog as readZebra, readFileData as readZebraFile } from './parsers/zebra';
import { readCatalog as readQL, readFileData as readQLFile } from './parsers/ql';
import { buildTapFile, buildDumpTap } from './parsers/tap';
import { makeSafeFilename, uniquePath } from './parsers/utils';
import type { DiskImage, DiskFormat, FileEntry, ExtractionResult } from './parsers/types';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
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
      { name: 'Disk Images', extensions: ['img', 'dsk', 'IMG', 'DSK'] },
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

ipcMain.handle('extract-file', async (_event, imagePath: string, entryIndex: number, destDir: string): Promise<ExtractionResult | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const entry = entries[entryIndex];
  if (!entry) return null;

  const fileData = parser.readFileData(buffer, entry);
  if (!fileData) return null;

  fs.mkdirSync(destDir, { recursive: true });

  return writeExtractedFile(destDir, entry, fileData, format);
});

ipcMain.handle('extract-all', async (_event, imagePath: string, destDir: string): Promise<ExtractionResult[]> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return [];

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);

  fs.mkdirSync(destDir, { recursive: true });
  const results: ExtractionResult[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const fileData = parser.readFileData(buffer, entry);
    if (!fileData) continue;
    const result = writeExtractedFile(destDir, entry, fileData, format);
    if (result) results.push(result);
  }

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

function writeExtractedFile(destDir: string, entry: FileEntry, fileData: Buffer, format: DiskFormat): ExtractionResult | null {
  const safeName = makeSafeFilename(entry.filename.trim());
  if (!safeName) return null;

  // Determine output format based on disk format and file type
  const usesTap = ['larken', 'oliger-v1', 'oliger-v2', 'aerco-dos64'].includes(format);

  if (entry.isMemoryDump) {
    // Write .dump + launcher .tap
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
    const tapData = buildTapFile(entry, fileData);
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
