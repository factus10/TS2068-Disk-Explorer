import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { getRecent, addRecent, clearRecent } from './recent-files';
import { getSettings, updateSettings } from './settings';
import {
  getFolderState, markFolder, unmarkFolder, recordImageExported, declineFolderOffer,
} from './archive-marker';
import { SUPPORTED_EXTENSIONS, isSupportedFile } from './parsers/supported-formats';
import {
  archiveCount, setArchived, catalogSummary, statusForIds, markIds, loadKnown, buildKnownProgramsCsv,
} from './catalog-status';
import type { FolderArchiveState } from './archive-marker';
import { detectFormat } from './parsers/detect';
import { readCatalog as readLarken, readFileData as readLarkenFile } from './parsers/larken';
import { readCatalog as readOliger, readFileData as readOligerFile } from './parsers/oliger';
import { readCatalog as readAerco, readFileData as readAercoFile } from './parsers/aerco';
import { readCatalog as readZebra, readFileData as readZebraFile } from './parsers/zebra';
import { readCatalog as readQL, readFileData as readQLFile } from './parsers/ql';
import { readCatalog as readTap, readFileData as readTapFile } from './parsers/tap-reader';
import { readCatalog as readTzx, readFileData as readTzxFile } from './parsers/tzx-reader';
import { readCatalog as readSNA, readFileData as readSNAFile } from './parsers/sna-reader';
import { readCatalog as readZ80, readFileData as readZ80File } from './parsers/z80-reader';
import { readCatalog as readSCR, readFileData as readSCRFile } from './parsers/scr-reader';
import { readCatalog as readMGT, readFileData as readMGTFile } from './parsers/mgt-reader';
import { readCatalog as readZIP, readFileData as readZIPFile } from './parsers/zip-reader';
import {
  readCatalog as readZX81Aerco, readFileData as readZX81AercoFile, readBasicListing as readZX81Listing,
} from './parsers/zx81-aerco';
import { parseZX81Variables } from './parsers/zx81';
import type { RemStyle } from './parsers/zx81';
import { disassemble, canDisassemble, disassembleForExport } from './parsers/disasm';
import { buildTapFile, buildDumpTap, buildMultiFileTap } from './parsers/tap';
import { buildTapPackages } from './parsers/basic-analyzer';
import { planArchiveExport } from './parsers/archive-selection';
import { buildZipArchive } from './parsers/zip-writer';
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
import { makeSafeFilename, uniquePath, uniqueNames } from './parsers/utils';
import { isZX81Format } from './parsers/types';
import type { DiskImage, DiskFormat, FileEntry, ExtractionResult, TapPackage, DiskHeader, DisasmSettings, DisasmSettingsMap } from './parsers/types';
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
          label: 'Update Shared Program List...',
          click: () => mainWindow?.webContents.send('menu-export-known'),
        },
        {
          label: 'Recent Files',
          submenu: recentSubmenu.length > 0 ? recentSubmenu : [{ label: 'No Recent Files', enabled: false }],
        },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu-preferences'),
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
        { type: 'separator' },
        ...(process.platform === 'darwin'
          ? [{ role: 'about' as const }]
          : [{
              label: 'About TS-2068 Disk Browser',
              click: () => {
                const aboutIcon = nativeImage.createFromPath(
                  path.join(__dirname, '..', 'build', 'icon.png'),
                );
                dialog.showMessageBox({
                  type: 'info',
                  icon: aboutIcon.isEmpty() ? undefined : aboutIcon,
                  title: 'About TS-2068 Disk Browser',
                  message: 'TS-2068 Disk Browser',
                  detail: `Version ${app.getVersion()}\n\nBrowse and extract files from vintage\nTimex/Sinclair disk images.\n\n© 2025 David Anderson`,
                });
              },
            }]),
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
    case 'zx81-aerco': return { readCatalog: readZX81Aerco, readFileData: readZX81AercoFile };
    case 'tap': return { readCatalog: readTap, readFileData: readTapFile };
    case 'tzx':
    case 'zx81-tzx': return { readCatalog: readTzx, readFileData: readTzxFile };
    case 'sna': return { readCatalog: readSNA, readFileData: readSNAFile };
    case 'z80': return { readCatalog: readZ80, readFileData: readZ80File };
    case 'scr': return { readCatalog: readSCR, readFileData: readSCRFile };
    case 'mgt': return { readCatalog: readMGT, readFileData: readMGTFile };
    case 'zip': return { readCatalog: readZIP, readFileData: readZIPFile };
    default: throw new Error(`Unknown format: ${format}`);
  }
}

/**
 * Detokenize a BASIC file, picking the dialect from the disk format. ZX81
 * disks hold Sinclair BASIC for the ZX81, which has its own character set,
 * token table and line layout; everything else is Spectrum/TS2068 BASIC.
 */
function detokenizeEntry(
  format: DiskFormat, fileData: Buffer, entry: FileEntry, ts2068Mode?: Ts2068Mode,
  remStyle?: RemStyle,
): BasicListing {
  if (isZX81Format(format)) return readZX81Listing(fileData, entry, remStyle);
  const varsOffset = entry.params.varsOffset ?? entry.params.param2;
  return detokenize(fileData, varsOffset, ts2068Mode);
}


/**
 * Detokenize every BASIC file on a disk once, so the disassembler can find a
 * CODE file's load address and entry points in whichever program loads it.
 */
function collectLoaders(
  format: DiskFormat, allEntries: FileEntry[], fileDataMap: Map<number, Buffer>,
): { entry: FileEntry; listing: BasicListing }[] {
  const loaders: { entry: FileEntry; listing: BasicListing }[] = [];
  for (const e of allEntries) {
    if (e.type !== 'basic' || e.isDirectory) continue;
    const d = fileDataMap.get(e.index);
    if (!d) continue;
    try {
      const l = detokenizeEntry(format, d, e);
      if (l.lines.length) loaders.push({ entry: e, listing: l });
    } catch { /* a file that will not detokenize simply offers no seeds */ }
  }
  return loaders;
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
      { name: 'Disk & Tape Images', extensions: SUPPORTED_EXTENSIONS },
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

ipcMain.handle('get-home-directory', async () => {
  return os.homedir();
});

ipcMain.handle('list-directory', async (_event, dirPath: string) => {
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const results: {
      name: string; isDirectory: boolean; size: number; path: string;
      archived?: FolderArchiveState | null;
      catalog?: { archived: number; total: number; marked: number; matched: number } | null;
    }[] = [];
    const { catalogDir } = getSettings();

    for (const item of items) {
      if (item.name.startsWith('.')) continue; // skip hidden files
      const fullPath = path.join(dirPath, item.name);
      let size = 0;
      const isDir = item.isDirectory();
      if (!isDir) {
        try { size = fs.statSync(fullPath).size; } catch { /* skip */ }
      }
      // Folders carry their archived state with the listing so the browser can
      // badge them without a round trip each.
      const archived = isDir ? getFolderState(fullPath) : null;
      // How much of this disk is already in the archive, when a catalogue is
      // configured. Folders and images alike, so a folder reads as a whole.
      const catalog = catalogDir && (isDir || isSupportedFile(item.name))
        ? archiveCount(catalogDir, fullPath, isDir)
        : null;
      results.push({ name: item.name, isDirectory: isDir, size, path: fullPath, archived, catalog });
    }

    // Sort: folders first, then files, alphabetical within each
    results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return results;
  } catch {
    return [];
  }
});

ipcMain.handle('set-folder-archived', async (
  _event, dirPath: string, archived: boolean,
): Promise<FolderArchiveState | null> => {
  if (!archived) {
    unmarkFolder(dirPath);
    return null;
  }
  return markFolder(dirPath, new Date().toISOString());
});


/**
 * The catalogue id of a program is the head of the SHA-256 of its bytes — the
 * same rule build-catalog.mts uses, so the two agree without either knowing
 * about the other.
 */
function programId(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 8);
}

/**
 * Mark what an export just wrote. Only exports that put a program into the
 * archive do this — a plain extraction to a working folder is not archiving,
 * and saying it was would make the catalogue lie.
 */
function markExported(entries: FileEntry[], fileDataMap: Map<number, Buffer>): number {
  const { catalogDir, markArchivedOnExport } = getSettings();
  if (!catalogDir || markArchivedOnExport === false) return 0;
  const ids: string[] = [];
  for (const entry of entries) {
    const data = fileDataMap.get(entry.index);
    if (data) ids.push(programId(data));
  }
  return markIds(catalogDir, ids, true).changed;
}

ipcMain.handle('get-disk-archive-status', async (
  _event, imagePath: string,
): Promise<{
  entries: Record<number, { known: boolean; archived?: 'marked' | 'matched' }>;
  total: number; known: number; fresh: number; source: string;
} | null> => {
  const { catalogDir } = getSettings();
  // Answering "is this new?" only needs the shipped list, so this works for
  // someone imaging disks who has no catalogue of their own.
  const known = loadKnown(catalogDir);
  if (!known) return null;

  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;
  const parser = getParser(format);
  const allEntries = flattenEntries(parser.readCatalog(buffer).entries);

  // Hashed rather than looked up by catalogue position: the position would
  // drift the moment an image changed, and a wrong answer here is worse than
  // none at all.
  const idByIndex = new Map<number, string>();
  for (const entry of allEntries) {
    if (entry.isDirectory) continue;
    let data: Buffer | null = null;
    try { data = parser.readFileData(buffer, entry); } catch { /* skip */ }
    if (data && data.length > 0) idByIndex.set(entry.index, programId(data));
  }

  const status = catalogDir ? statusForIds(catalogDir, [...idByIndex.values()]) : {};
  const entries: Record<number, { known: boolean; archived?: 'marked' | 'matched' }> = {};
  let knownCount = 0;
  for (const [index, id] of idByIndex) {
    const isKnown = known.ids.has(id);
    if (isKnown) knownCount++;
    // The shipped list records an archived flag too, so a reader without a
    // live catalogue still sees what has been published.
    const shipped = known.ids.get(id)?.archived;
    const archived = status[id]
      ?? (shipped === 'yes' ? 'marked' : shipped === 'matched' ? 'matched' : undefined);
    entries[index] = { known: isKnown, ...(archived ? { archived } : {}) };
  }
  return {
    entries,
    total: idByIndex.size,
    known: knownCount,
    fresh: idByIndex.size - knownCount,
    source: known.source,
  };
});

ipcMain.handle('set-catalog-archived', async (
  _event, targetPath: string, isDirectory: boolean, archived: boolean,
): Promise<{ changed: number; total: number; titles: string[] } | null> => {
  const { catalogDir } = getSettings();
  if (!catalogDir) return null;
  return setArchived(catalogDir, targetPath, isDirectory, archived);
});

/**
 * Where a refreshed known-programs.csv should go. Running from source that is
 * the copy the app ships, so it can be committed; a packaged app cannot write
 * inside its own bundle, so it falls back to the catalogue folder.
 */
function knownProgramsTarget(catalogDir: string): string {
  const inRepo = path.join(app.getAppPath(), 'electron', 'data', 'known-programs.csv');
  try {
    fs.accessSync(path.dirname(inRepo), fs.constants.W_OK);
    return inRepo;
  } catch {
    return path.join(catalogDir, 'known-programs.csv');
  }
}

ipcMain.handle('export-known-programs', async (): Promise<
  { path: string; rows: number; archived: number; matched: number } | null
> => {
  const { catalogDir } = getSettings();
  if (!catalogDir) {
    await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'No catalogue',
      message: 'Set a catalogue folder first.',
      detail: 'Preferences → Catalogue folder. The shared list is built from the catalogue there.',
    });
    return null;
  }

  const built = buildKnownProgramsCsv(catalogDir);
  if (!built) {
    await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: 'Nothing to export',
      message: 'That catalogue has no catalog.csv in it.',
      detail: 'Render the catalogue first, then try again.',
    });
    return null;
  }

  const suggested = knownProgramsTarget(catalogDir);
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Write the shared list of known programs',
    defaultPath: suggested,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return null;

  fs.writeFileSync(result.filePath, built.text);
  return { path: result.filePath, rows: built.rows, archived: built.archived, matched: built.matched };
});

ipcMain.handle('get-catalog-summary', async (): Promise<
  { dir: string; images: number; folders: number; programs: number; archived: number } | null
> => {
  const { catalogDir } = getSettings();
  if (!catalogDir) return null;
  const summary = catalogSummary(catalogDir);
  return summary ? { dir: catalogDir, ...summary } : null;
});

ipcMain.handle('pick-catalog-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Choose the catalogue folder (the one holding occurrences.csv)',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];
  if (!catalogSummary(dir)) {
    await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: 'Not a catalogue',
      message: 'That folder has no occurrences.csv in it.',
      detail: 'Choose the folder a catalogue was built into — it holds occurrences.csv, catalog.csv and marks.json.',
    });
    return null;
  }
  updateSettings({ catalogDir: dir });
  return dir;
});

ipcMain.handle('clear-catalog-dir', async () => { updateSettings({ catalogDir: undefined }); return true; });

ipcMain.handle('select-directory', async () => {
  // Open where the reader last chose to extract. The dialog is still shown --
  // writing a pile of files somewhere without confirming would be a poor
  // trade for one saved click -- but they should not have to navigate there
  // again every time.
  const { extractionDir } = getSettings();
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    ...(extractionDir ? { defaultPath: extractionDir } : {}),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-settings', async () => getSettings());

ipcMain.handle('update-settings', async (_event, patch: Record<string, unknown>) =>
  updateSettings(patch));

/**
 * Ask whether a just-used folder should become the default.
 *
 * Asked once, after the first extraction, when there is something concrete to
 * point at. Asking at launch would make people configure a path before they
 * have opened a disk, and most sessions never export anything.
 */
ipcMain.handle('offer-default-extraction-dir', async (_event, dir: string) => {
  if (getSettings().extractionDir) return false;
  const { response } = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    buttons: ['Use This Folder', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    title: 'Default extraction folder',
    message: 'Always extract here?',
    detail: `${dir}\n\nThe file browser will start here next time. You can change it later in `
      + `Preferences.`,
  });
  if (response !== 0) return false;
  updateSettings({ extractionDir: dir });
  return true;
});

/**
 * Called after a whole-disk export. Records that this image is done and, if
 * that was the last one in its folder, offers to mark the folder — asked here
 * rather than left to the reader to remember, since marking by hand is the
 * step that gets forgotten.
 */
ipcMain.handle('offer-folder-archive', async (
  _event, imagePath: string,
): Promise<{ marked: boolean; dir: string; exported: number; total: number }> => {
  const progress = recordImageExported(imagePath);
  const answer = { marked: false, dir: progress.dir, exported: progress.exported, total: progress.total };
  if (!progress.offer) return answer;

  const { response } = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    buttons: ['Mark as Archived', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    title: 'Folder finished',
    message: `All ${progress.total} image(s) in this folder have been exported.`,
    detail: `${progress.dir}\n\nMarking it puts a ✓ beside it in the file browser, and a hidden `
      + `marker file in the folder so the mark travels with it. You can unmark it at any time by `
      + `right-clicking the folder.`,
  });

  if (response !== 0) {
    declineFolderOffer(progress.dir);
    return answer;
  }
  markFolder(progress.dir, new Date().toISOString());
  return { ...answer, marked: true };
});

ipcMain.handle('pick-extraction-dir', async () => {
  const { extractionDir } = getSettings();
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose the default extraction folder',
    ...(extractionDir ? { defaultPath: extractionDir } : {}),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  updateSettings({ extractionDir: result.filePaths[0] });
  return result.filePaths[0];
});

ipcMain.handle('extract-file', async (
  _event, imagePath: string, entryIndex: number, destDir: string,
  editedLines?: Record<number, string>,
  customBaseName?: string,
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

  // Optionally override the filename used by writeExtractedFile by
  // wrapping the entry with a renamed copy.
  const effectiveEntry: FileEntry = customBaseName
    ? { ...entry, filename: customBaseName }
    : entry;

  return writeExtractedFile(destDir, effectiveEntry, fileData, format, editedLines);
});

ipcMain.handle('extract-all', async (
  _event, imagePath: string, destDir: string,
  allEdits?: Record<number, Record<number, string>>,
  allDisasm?: DisasmSettingsMap,
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

  // Disassembly: .dis plus a .dis.json recording exactly what produced it.
  const loaders = collectLoaders(format, allEntries, fileDataMap);
  for (const entry of allEntries) {
    if (entry.isDirectory) continue;
    const fileData = fileDataMap.get(entry.index);
    if (!fileData) continue;
    const safeName = makeSafeFilename(entry.filename.trim());
    if (!safeName) continue;
    const dis = disassembleForExport({
      format, entry, data: fileData, loaders, source: path.basename(imagePath),
      settings: allDisasm?.[entry.index],
    });
    if (!dis) continue;
    const disPath = uniquePath(path.join(destDir, safeName + '.dis'));
    fs.writeFileSync(disPath, dis.text);
    fs.writeFileSync(disPath + '.json', JSON.stringify(dis.sidecar, null, 2) + '\n');
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
      const listing = detokenizeEntry(format, fileData, entry);
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

// Archive.org TOSEC-style export
interface ArchiveMetadata {
  year: string;
  publisher: string;
  system: string;
  country: string;
}

function buildArchiveName(title: string, meta: ArchiveMetadata, typeSuffix: string): string {
  // Clean up the title: strip Larken-style extensions (.B1, .C$, .C1, .CG, .CS, .CL, etc.)
  let clean = title.trim();
  clean = clean.replace(/\.[BCAbca][\w$]*$/, '');
  // Replace characters unsafe for filenames
  clean = clean.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();
  if (!clean) clean = 'Unknown';

  const parts = [
    clean,
    ` (${meta.year})`,
    `(${meta.publisher})`,
    `(${meta.system})`,
    `(${meta.country})`,
    `(${typeSuffix})`,
  ];
  return parts.join('');
}

/**
 * Extension for files written out verbatim. ZX81 files are memory images
 * starting at 0x4009, which is exactly the `.p` tape format emulators expect.
 */
function rawFileExtension(format: DiskFormat, entry: FileEntry): string {
  if (isZX81Format(format)) return '.p';
  return entry.type === 'module' ? '.bin' : '';
}

function fileTypeToArchiveSuffix(entry: FileEntry): string {
  switch (entry.type) {
    case 'basic': return 'Program';
    case 'code':
      if (entry.size === 6912) return 'Screen';
      if (entry.size === 256) return 'Icon';
      if (entry.size === 768) return 'Font';
      return 'Code';
    case 'num-array': return 'Data';
    case 'str-array': return 'Data';
    case 'state': return 'Snapshot';
    default: return 'Program';
  }
}

// Collect all archive-named file buffers from a disk image. When `selection`
// is given only those catalog entries are exported.
function buildArchiveFiles(
  imagePath: string, metadata: ArchiveMetadata,
  allEdits?: Record<number, Record<number, string>>,
  allDisasm?: DisasmSettingsMap,
  selection?: number[],
): { files: { name: string; data: Buffer; entry: FileEntry }[]; programIds: string[] } {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return { files: [], programIds: [] };

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);

  const fileDataMap = new Map<number, Buffer>();
  for (const entry of allEntries) {
    if (entry.isDirectory) continue;
    const data = parser.readFileData(buffer, entry);
    if (data) fileDataMap.set(entry.index, data);
  }

  const usesTap = ['larken', 'oliger-v1', 'oliger-v2', 'aerco-dos64'].includes(format);
  const packages = usesTap ? buildTapPackages(entries, fileDataMap) : [];
  const plan = planArchiveExport(allEntries, packages, selection);
  const files: { name: string; data: Buffer; entry: FileEntry }[] = [];

  // Packages. A bundle that fails to build leaves its members unclaimed, so
  // they still go out individually below rather than vanishing.
  const bundledIndices = new Set<number>();
  for (const pkg of plan.bundled) {
    const tapData = buildMultiFileTap(pkg, fileDataMap, allEdits);
    if (!tapData) continue;

    const archiveName = buildArchiveName(pkg.loader.filename, metadata, 'Program');
    files.push({ name: archiveName + '.tap', data: tapData, entry: pkg.loader });

    bundledIndices.add(pkg.loader.index);
    for (const dep of pkg.dependencies) bundledIndices.add(dep.index);
  }

  // Individual files
  for (const entry of plan.covered) {
    if (bundledIndices.has(entry.index)) continue;
    const fileData = fileDataMap.get(entry.index);
    if (!fileData) continue;

    const typeSuffix = fileTypeToArchiveSuffix(entry);
    const archiveName = buildArchiveName(entry.filename, metadata, typeSuffix);

    if (usesTap && entry.type !== 'module') {
      const edits = allEdits?.[entry.index];
      let tapData: Buffer;
      if (edits && entry.type === 'basic' && Object.keys(edits).length > 0) {
        const rebuilt = rebuildBasicProgram(fileData, edits, entry);
        if (!rebuilt) continue;
        tapData = rebuilt;
      } else {
        tapData = buildTapFile(entry, fileData);
      }
      files.push({ name: archiveName + '.tap', data: tapData, entry });
    } else {
      files.push({ name: archiveName + rawFileExtension(format, entry), data: fileData, entry });
    }
  }

  // Disassembly goes into the package as its own pair, never merged into the
  // file it describes: the .dis is reproducible from the bytes, and the
  // .dis.json records the checksum those bytes hashed to.
  const loaders = collectLoaders(format, allEntries, fileDataMap);
  for (const entry of plan.covered) {
    const fileData = fileDataMap.get(entry.index);
    if (!fileData) continue;
    const dis = disassembleForExport({
      format, entry, data: fileData, loaders, source: path.basename(imagePath),
      settings: allDisasm?.[entry.index],
    });
    if (!dis) continue;
    const archiveName = buildArchiveName(entry.filename, metadata, fileTypeToArchiveSuffix(entry));
    files.push({ name: archiveName + '.dis', data: Buffer.from(dis.text, 'utf8'), entry });
    files.push({
      name: archiveName + '.dis.json',
      data: Buffer.from(JSON.stringify(dis.sidecar, null, 2) + '\n', 'utf8'),
      entry,
    });
  }

  // Identity comes from the program's own bytes, not from what was written:
  // a TAP wrapper would hash to something the catalogue has never seen.
  const programIds = [...new Set(
    plan.covered.map((e) => fileDataMap.get(e.index)).filter(Boolean).map((d) => programId(d as Buffer)),
  )];

  return { files, programIds };
}

ipcMain.handle('export-archive', async (
  _event, imagePath: string, destOrZipPath: string,
  metadata: ArchiveMetadata & { format?: string },
  allEdits?: Record<number, Record<number, string>>,
  allDisasm?: DisasmSettingsMap,
  entryIndices?: number[],
): Promise<ExtractionResult[]> => {
  // A selection can only be expressed as extracted files, so it forces the
  // file shapes even if an older caller asks for the raw-image ZIP.
  const selection = entryIndices && entryIndices.length > 0 ? entryIndices : undefined;
  const wantsImageZip = !selection
    && (metadata.format === 'image-zip'
      || ((metadata.format === 'zip' || !metadata.format) && destOrZipPath.endsWith('.zip')));

  if (wantsImageZip) {
    // Whole-disk ZIP: archive the original disk image file as-is
    const rawImage = fs.readFileSync(imagePath);
    const innerName = path.basename(imagePath);
    const zipData = buildZipArchive([{ name: innerName, data: rawImage }]);
    fs.writeFileSync(destOrZipPath, zipData);

    return [{
      filename: innerName,
      outputPaths: [destOrZipPath],
      format: 'zip',
      size: rawImage.length,
    }];
  }

  const { files: archiveFiles, programIds } = buildArchiveFiles(imagePath, metadata, allEdits, allDisasm, selection);
  if (archiveFiles.length === 0) return [];

  // An archive.org export is the act of archiving, so what it covers is
  // recorded as archived.
  let markedCount = 0;
  {
    const { catalogDir, markArchivedOnExport } = getSettings();
    if (catalogDir && markArchivedOnExport !== false) {
      markedCount = markIds(catalogDir, programIds, true).changed;
    }
  }

  // ZIP mode: the archive-named files, packed instead of written loose.
  if (metadata.format === 'zip') {
    // A ZIP has no uniquePath to fall back on, so names are made distinct
    // before they go in.
    const names = uniqueNames(archiveFiles.map((f) => f.name));
    const zipData = buildZipArchive(archiveFiles.map((f, i) => ({ name: names[i], data: f.data })));
    fs.writeFileSync(destOrZipPath, zipData);

    return archiveFiles.map((f, i) => ({
      filename: f.entry.filename,
      outputPaths: [destOrZipPath],
      format: 'zip',
      size: f.data.length,
      ...(i === 0 ? { marked: markedCount } : {}),
    }));
  }

  // Folder mode: export individual files with archive.org naming
  fs.mkdirSync(destOrZipPath, { recursive: true });
  const results: ExtractionResult[] = [];
  for (const f of archiveFiles) {
    const outPath = uniquePath(path.join(destOrZipPath, f.name));
    fs.writeFileSync(outPath, f.data);
    results.push({
      filename: f.entry.filename,
      outputPaths: [outPath],
      format: 'tap',
      size: f.data.length,
      ...(results.length === 0 ? { marked: markedCount } : {}),
    });
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
  customBaseName?: string,
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
  const baseName = customBaseName?.trim() || loader.filename.trim();
  const safeName = makeSafeFilename(baseName);
  const tapPath = uniquePath(path.join(destDir, (safeName || 'package') + '.tap'));
  fs.writeFileSync(tapPath, tapData);

  const marked = markExported([loader, ...deps], fileDataMap);

  return {
    filename: loader.filename,
    outputPaths: [tapPath],
    format: 'tap',
    size: tapData.length,
    marked,
  };
});

ipcMain.handle('get-basic-listing', async (_event, imagePath: string, entryIndex: number, ts2068Mode: Ts2068Mode = 'auto', remStyle: RemStyle = 'characters'): Promise<BasicListing | null> => {
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

  const listing = detokenizeEntry(format, fileData, entry, ts2068Mode, remStyle);
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
  const varsData = Buffer.from(fileData.subarray(varsOffset));
  // ZX81 names its variables in its own character set and sizes FOR blocks
  // differently, so it needs its own decoder.
  return isZX81Format(format) ? parseZX81Variables(varsData) : parseVariables(varsData);
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
    listing = detokenizeEntry(format, fileData, entry, ts2068Mode);
  }

  if (!listing) return null;
  return buildXRef(listing);
});

ipcMain.handle('get-disassembly', async (
  _event, imagePath: string, entryIndex: number, originOverride?: number, exrom?: boolean,
): Promise<{ text: string; origin: number; instructions: number; conflicts: number } | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;
  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);
  const entry = allEntries.find((e) => e.index === entryIndex);
  if (!entry) return null;
  const data = parser.readFileData(buffer, entry);
  // Read first, then decide: the bytes are what tell a program from a document.
  if (!data || !canDisassemble(format, entry, data)) return null;

  // Every BASIC file on the disk is a candidate loader: one of them may name
  // this file's load address, and their USR calls are the entry points.
  const listings = new Map<number, Buffer>();
  for (const e of allEntries) {
    if (e.type !== 'basic' || e.isDirectory) continue;
    const d = parser.readFileData(buffer, e);
    if (d) listings.set(e.index, d);
  }
  const loaders = collectLoaders(format, allEntries, listings);
  const r = disassemble({
    format, entry, data, siblings: loaders, originOverride, exrom,
    listing: loaders.find((l) => l.entry.index === entry.index)?.listing ?? null,
    source: path.basename(imagePath),
  });
  if (!r) return null;
  return { text: r.text, origin: r.origin, instructions: r.instructions, conflicts: r.conflicts };
});

ipcMain.handle('get-disk-map', async (_event, imagePath: string): Promise<{ totalBlocks: number } | null> => {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  // Estimate total blocks from file size and block size
  const blockSizes: Record<string, number> = {
    'larken': 5120, 'oliger-v1': 5120, 'oliger-v2': 5120,
    'aerco-dos64': 5120, 'aerco-rpm': 2048, 'zebra-dirscp': 4096,
    'zebra-cpm': 4096, 'ql': 1536, 'zx81-aerco': 5120, 'zx81-tzx': 0, 'tap': 0,
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
  remStyle: RemStyle = 'characters',
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
    listing = detokenizeEntry(format, fileData, entry, ts2068Mode, remStyle);
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
ipcMain.handle('save-tap-dialog', async (_event, defaultName: string): Promise<string | null> => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName,
    filters: [{ name: 'TAP Files', extensions: ['tap'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('save-zip-dialog', async (_event, defaultName: string): Promise<string | null> => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName,
    filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

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
  const outPath = uniquePath(path.join(destDir, safeName + rawFileExtension(format, entry)));
  fs.writeFileSync(outPath, fileData);

  return {
    filename: entry.filename,
    outputPaths: [outPath],
    format: 'raw',
    size: fileData.length,
  };
}

app.whenReady().then(() => {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  app.setAboutPanelOptions({
    applicationName: 'TS-2068 Disk Browser',
    applicationVersion: app.getVersion(),
    version: '',
    credits: 'Browse and extract files from vintage\nTimex/Sinclair disk images.',
    copyright: '© 2025 David Anderson',
    iconPath,
  });
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
