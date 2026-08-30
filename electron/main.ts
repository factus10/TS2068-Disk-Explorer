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
  compareShippedList,
} from './catalog-status';
import { checkForUpdate, saveUpdate, clearUpdate, countRows } from './catalog-update';
import { surveyCollection, ingestImages } from './catalog-ingest';
import { buildInsights } from './catalog-insights';
import { siteInfo, fetchArchive, fetchListings, lookupByName, WpError, DEFAULT_WP_URL } from './wordpress';
import { searchListings, searchTitles, saveListings, listingsStatus } from './wordpress-listings';
import { refreshMatches } from './wordpress-match';
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
import { machineForFormat, emulatorArgs, findEmulator, launchEmulator } from './emulator';
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

  // Only when asked for: an unsolicited request on launch is not something
  // to do by default.
  mainWindow.webContents.on('did-finish-load', () => {
    if (getSettings().autoCheckCatalogUpdate) {
      runCatalogUpdateCheck(true).catch(() => { /* a failed check must not disturb launch */ });
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
        { type: 'separator' },
        {
          label: 'Run in ZEsarUX',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('menu-run-emulator'),
        },
        { type: 'separator' },
        {
          label: 'Catalogue Insights...',
          click: () => mainWindow?.webContents.send('menu-catalog-insights'),
        },
        {
          label: 'Add New Disks to Catalogue...',
          click: () => mainWindow?.webContents.send('menu-ingest-catalog'),
        },
        {
          label: 'Check for Program List Update...',
          click: () => mainWindow?.webContents.send('menu-check-catalog-update'),
        },
        {
          label: 'Update Shared Program List...',
          click: () => mainWindow?.webContents.send('menu-export-known'),
        },
        {
          label: 'Search the Published Archive...',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow?.webContents.send('menu-wp-search'),
        },
        {
          label: 'Refresh Matches from WordPress...',
          click: () => mainWindow?.webContents.send('menu-wp-refresh'),
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
        // Cmd+R belongs to Run — reloading the renderer is a developer's
        // errand, and running the selected program is the daily one.
        { role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' },
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
 * Mark what was just written out. Every route that takes a program out of an
 * image counts: a package, an archive.org bundle, or a plain extraction.
 *
 * The distinction once drawn here — that extracting to a working folder is not
 * archiving — was not one the work makes. Getting a program out is the act,
 * and having some routes record it and others not was merely confusing.
 * Preferences turns the whole behaviour off for anyone who disagrees.
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

/**
 * Mark chosen entries of an open image. The catalogue cannot always tell that
 * two copies of a program are the same — a renamed file, a byte of padding —
 * so there has to be a way to say so by hand.
 */
ipcMain.handle('mark-entries-archived', async (
  _event, imagePath: string, entryIndices: number[], archived = true,
): Promise<{ changed: number; total: number } | null> => {
  const { catalogDir } = getSettings();
  if (!catalogDir) return null;

  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;
  const parser = getParser(format);
  const allEntries = flattenEntries(parser.readCatalog(buffer).entries);

  const wanted = new Set(entryIndices);
  const ids: string[] = [];
  for (const entry of allEntries) {
    if (entry.isDirectory || !wanted.has(entry.index)) continue;
    let data: Buffer | null = null;
    try { data = parser.readFileData(buffer, entry); } catch { /* skip */ }
    if (data && data.length > 0) ids.push(programId(data));
  }

  const { changed } = markIds(catalogDir, ids, archived);
  return { changed, total: ids.length };
});

ipcMain.handle('get-disk-archive-status', async (
  _event, imagePath: string,
): Promise<{
  entries: Record<number, { known: boolean; archived?: 'marked' | 'matched' }>;
  total: number; known: number; fresh: number; source: string;
} | null> => {
  const { catalogDir } = getSettings();
  // Answering "is this new?" only needs the shipped list, so this works for
  // someone imaging disks who has no catalogue of their own.
  const known = loadKnown(catalogDir, downloadedListPath());
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

/** The path of the copy that ships inside the app. */
function shippedListPath(): string {
  return path.join(app.getAppPath(), 'electron', 'data', 'known-programs.csv');
}

/**
 * Where a refreshed known-programs.csv should go. Running from source that is
 * the copy the app ships, so it can be committed; a packaged app cannot write
 * inside its own bundle, so it falls back to the catalogue folder.
 *
 * Which of the two it turned out to be matters to whoever asked for the
 * refresh: one is a file already in its place, the other is a file they have
 * to carry into the repository themselves before anyone else sees it.
 */
function knownProgramsTarget(catalogDir: string): { path: string; inRepo: boolean } {
  const shipped = shippedListPath();
  try {
    fs.accessSync(path.dirname(shipped), fs.constants.W_OK);
    return { path: shipped, inRepo: true };
  } catch {
    return { path: path.join(catalogDir, 'known-programs.csv'), inRepo: false };
  }
}

/** Where a list fetched from the repository is kept. */
function downloadedListPath(): string {
  return path.join(app.getPath('userData'), 'known-programs.csv');
}

/**
 * Compare the published list against the one in use and, if it differs, offer
 * to take it. Answering no is remembered only in the sense that nothing is
 * written; the next check will ask again.
 */
async function runCatalogUpdateCheck(quiet: boolean): Promise<{ updated: boolean; message: string }> {
  const settings = getSettings();
  const inUse = loadKnown(settings.catalogDir, downloadedListPath());
  const currentText = inUse ? (() => {
    try { return fs.readFileSync(inUse.source, 'utf-8'); } catch { return null; }
  })() : null;

  const result = await checkForUpdate(currentText, settings.catalogUpdate?.etag);
  updateSettings({
    catalogUpdate: {
      ...(result.etag ? { etag: result.etag } : {}),
      checkedAt: new Date().toISOString(),
      ...(result.rows ? { rows: result.rows } : {}),
    },
  });

  if (result.error) {
    const message = `Could not check for a newer program list: ${result.error}`;
    if (!quiet) {
      await dialog.showMessageBox(mainWindow!, {
        type: 'warning', title: 'Check failed', message: 'Could not check for a newer program list.',
        detail: result.error,
      });
    }
    return { updated: false, message };
  }

  if (!result.available) {
    const message = `The program list is up to date (${result.currentRows ?? 0} programs).`;
    if (!quiet) {
      await dialog.showMessageBox(mainWindow!, {
        type: 'info', title: 'Up to date', message,
      });
    }
    return { updated: false, message };
  }

  const delta = (result.rows ?? 0) - (result.currentRows ?? 0);
  const { response } = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    buttons: ['Download', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    title: 'A newer program list is available',
    message: `The published list has ${result.rows} programs; yours has ${result.currentRows}.`,
    detail: (delta > 0 ? `${delta} more than you have. ` : delta < 0 ? `${-delta} fewer than you have. ` : '')
      + 'Taking it changes only what the app calls new — nothing in your collection or your catalogue is touched.',
  });

  if (response !== 0) return { updated: false, message: 'Left the program list as it was.' };

  const target = saveUpdate(app.getPath('userData'), result.text!);
  return { updated: true, message: `Program list updated to ${countRows(result.text!)} programs (${path.basename(target)}).` };
}

ipcMain.handle('check-catalog-update', async (_event, quiet = false) => runCatalogUpdateCheck(quiet));

ipcMain.handle('get-catalog-insights', async () => {
  const { catalogDir } = getSettings();
  return catalogDir ? buildInsights(catalogDir) : null;
});

ipcMain.handle('mark-programs-archived', async (_event, ids: string[], archived = true) => {
  const { catalogDir } = getSettings();
  if (!catalogDir) return null;
  return markIds(catalogDir, ids, archived);
});

ipcMain.handle('survey-collection', async (_event, root?: string) => {
  const { catalogDir } = getSettings();
  if (!catalogDir) return null;
  return surveyCollection(catalogDir, root);
});

/**
 * Add newly imaged disks to the catalogue. Progress goes back to the window as
 * it runs: reading a few hundred images off cloud storage takes long enough
 * that a frozen window would look like a hang.
 */
ipcMain.handle('ingest-images', async (event, root: string, relPaths: string[]) => {
  const { catalogDir } = getSettings();
  if (!catalogDir) return null;
  return ingestImages(catalogDir, root, relPaths, (done, total, current) => {
    event.sender.send('ingest-progress', { done, total, current });
  });
});

ipcMain.handle('clear-catalog-update', async () => {
  clearUpdate(app.getPath('userData'));
  updateSettings({ catalogUpdate: undefined });
  return true;
});

ipcMain.handle('export-known-programs', async (): Promise<
  { path: string; rows: number; archived: number; matched: number; inRepo: boolean } | null
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
    defaultPath: suggested.path,
    // Only macOS shows this, so it is a courtesy rather than the answer; the
    // message after the write is what every platform gets.
    message: suggested.inRepo
      ? 'This is the copy that ships with the app, so saving here is enough.'
      : 'The app cannot write inside its own bundle, so this is a copy in the '
        + 'catalogue folder. It has to be moved into electron/data/ of the '
        + 'repository before anyone else sees it.',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return null;

  fs.writeFileSync(result.filePath, built.text);

  // Whether it landed in its place is a fact about where it was actually
  // saved, not about where the dialog offered to put it.
  const inRepo = path.resolve(result.filePath) === path.resolve(shippedListPath());
  if (!inRepo) {
    await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'List written',
      message: `Wrote ${built.rows} programs to ${path.basename(result.filePath)}.`,
      detail: `${result.filePath}\n\nThis is not the copy the app ships. Move it to `
        + 'electron/data/known-programs.csv in the repository and commit it, or the '
        + 'refresh reaches no one else.',
      buttons: ['OK', 'Show in Folder'],
      defaultId: 0,
    }).then((answer) => {
      if (answer.response === 1) shell.showItemInFolder(result.filePath!);
    });
  }

  return {
    path: result.filePath, rows: built.rows,
    archived: built.archived, matched: built.matched, inRepo,
  };
});

ipcMain.handle('compare-shipped-list', async () => {
  const { catalogDir } = getSettings();
  return catalogDir ? compareShippedList(catalogDir) : null;
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

// ---------------------------------------------------------- WordPress ------
//
// Read-only queries against the site holding the published archive. Every one
// of them needs an address the reader gave: without it there is nothing to
// ask, and guessing at localhost would mean the app made a request nobody
// asked for.

/** The configured site, or a message saying plainly that there isn't one. */
function wpSite(): { url: string } | { error: string } {
  const { wordpressUrl } = getSettings();
  if (!wordpressUrl) {
    return { error: 'No WordPress site is set. Preferences → Published archive.' };
  }
  return { url: wordpressUrl };
}

/** What went wrong, in the reader's terms rather than the network's. */
function wpMessage(err: any): string {
  return err instanceof WpError ? err.message : `Could not read the archive: ${err?.message ?? err}`;
}

ipcMain.handle('wp-test', async (_event, url?: string) => {
  const target = (url ?? getSettings().wordpressUrl ?? DEFAULT_WP_URL).trim();
  try {
    const info = await siteInfo(target);
    return { ok: true as const, ...info };
  } catch (err) {
    return { ok: false as const, error: wpMessage(err) };
  }
});

ipcMain.handle('wp-save-url', async (_event, url: string) => {
  const trimmed = url.trim().replace(/\/+$/, '');
  updateSettings({ wordpressUrl: trimmed || undefined });
  return trimmed || null;
});

/**
 * Open a published record in the reader's browser.
 *
 * The URL comes out of WordPress, which is data rather than instruction, so
 * only http and https are ever handed to the shell — a `file:` or a custom
 * scheme reaching `openExternal` would be running something on the strength
 * of what a web page said.
 */
ipcMain.handle('open-external', async (_event, url: string) => {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  await shell.openExternal(parsed.toString());
  return true;
});

ipcMain.handle('wp-status', async () => {
  const { wordpressUrl } = getSettings();
  return { url: wordpressUrl ?? null, defaultUrl: DEFAULT_WP_URL };
});

/**
 * Where the listing copy lives: beside `wordpress.json` when a catalogue is
 * set, and in the app's own data folder otherwise, so a reader with a site
 * but no catalogue can still search.
 */
function listingsDir(): string {
  return getSettings().catalogDir ?? app.getPath('userData');
}

ipcMain.handle('wp-listings-status', async () => listingsStatus(listingsDir()));

/**
 * Take a fresh copy of every listing. Slow enough to report progress, and
 * explicitly asked for, so it is never done behind the reader's back.
 */
ipcMain.handle('wp-fetch-listings', async (event) => {
  const site = wpSite();
  if ('error' in site) return { ok: false as const, error: site.error };
  try {
    const records = await fetchListings(site.url, (done, total) => {
      event.sender.send('wp-listings-progress', { done, total });
    });
    return { ok: true as const, ...saveListings(listingsDir(), site.url, records) };
  } catch (err) {
    return { ok: false as const, error: wpMessage(err) };
  }
});

ipcMain.handle('wp-lookup', async (_event, name: string) => {
  const local = searchTitles(listingsDir(), name);
  if (local) return { hits: local.hits };

  const site = wpSite();
  if ('error' in site) return { hits: [], error: site.error };
  try {
    return { hits: await lookupByName(site.url, name) };
  } catch (err) {
    return { hits: [], error: wpMessage(err) };
  }
});

ipcMain.handle('wp-search-source', async (_event, phrase: string) => {
  const found = searchListings(listingsDir(), phrase);
  // No copy yet: say so plainly so the window can offer to make one, rather
  // than reporting an empty archive.
  if (!found) return { hits: [], searched: 0, generated: '', phrase, needsFetch: true };
  return found;
});

ipcMain.handle('wp-search-name', async (_event, name: string) => {
  // The copy ranks this properly and has every record; the site does neither.
  const local = searchTitles(listingsDir(), name);
  if (local) return local;

  const site = wpSite();
  if ('error' in site) return { hits: [], searched: 0, generated: '', phrase: name, error: site.error };
  try {
    const hits = await lookupByName(site.url, name);
    return { hits, searched: hits.length, generated: '', phrase: name };
  } catch (err) {
    return { hits: [], searched: 0, generated: '', phrase: name, error: wpMessage(err) };
  }
});

/**
 * Read the whole archive and re-match the catalogue against it. This is the
 * live form of the old dump-and-match pair, and writes the same two files, so
 * the catalogue scripts still read what this leaves behind.
 */
ipcMain.handle('wp-refresh-matches', async (event) => {
  const site = wpSite();
  if ('error' in site) return { ok: false as const, error: site.error };
  const { catalogDir } = getSettings();
  if (!catalogDir) {
    return { ok: false as const, error: 'No catalogue is set. Preferences → Catalogue folder.' };
  }

  try {
    const records = await fetchArchive(site.url, (done, total) => {
      event.sender.send('wp-refresh-progress', { done, total, stage: 'records' });
    });
    const result = refreshMatches(catalogDir, records);

    // Take the listings in the same pass. They are what the source search
    // reads, and a refresh that left them behind would answer this morning's
    // question about matches with last week's listings.
    const listings = await fetchListings(site.url, (done, total) => {
      event.sender.send('wp-refresh-progress', { done, total, stage: 'listings' });
    });
    const saved = saveListings(listingsDir(), site.url, listings);

    return { ok: true as const, ...result, listings: saved.withSource };
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { ok: false as const, error: 'That catalogue folder has no catalog.json in it.' };
    }
    return { ok: false as const, error: wpMessage(err) };
  }
});


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

  const result = writeExtractedFile(destDir, effectiveEntry, fileData, format, editedLines);
  if (result) {
    const listingPath = writeListingSidecar(
      destDir, makeSafeFilename(effectiveEntry.filename.trim()),
      format, entry, fileData, editedLines,
    );
    if (listingPath) result.outputPaths.push(listingPath);
    const marked = markExported([entry], new Map([[entry.index, fileData]]));
    if (marked) result.marked = marked;
  }
  return result;
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

    // BASIC programs, and the BASIC inside a state capture → .txt listing
    writeListingSidecar(destDir, safeName, format, entry, fileData, allEdits?.[entry.index]);

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

  const marked = markExported(allEntries.filter((e) => !e.isDirectory), fileDataMap);
  if (marked && results.length > 0) results[0].marked = marked;

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

/**
 * Formats whose catalog entries are Spectrum-family blocks, so a program comes
 * out of them as a TAP rather than as raw bytes. Matches the rule
 * writeExtractedFile has always applied.
 */
const TAP_FORMATS: DiskFormat[] = ['larken', 'oliger-v1', 'oliger-v2', 'aerco-dos64', 'tap'];

/**
 * The bytes a program is handed to the world as, whether the world is an
 * emulator or an archive: a TAP for the tape-based formats, the raw memory
 * image otherwise, with any hand-edited BASIC lines already folded in.
 *
 * One definition, so that the file that runs is byte-for-byte the file that
 * gets archived. A program checked in the emulator and then exported is
 * therefore the same program, not a second build of it.
 */
function programPayload(
  format: DiskFormat, entry: FileEntry, fileData: Buffer,
  edits?: Record<number, string>,
): { data: Buffer; ext: string } | null {
  if (TAP_FORMATS.includes(format) && entry.type !== 'module') {
    if (edits && entry.type === 'basic' && Object.keys(edits).length > 0) {
      const rebuilt = rebuildBasicProgram(fileData, edits, entry);
      if (!rebuilt) return null;
      return { data: rebuilt, ext: '.tap' };
    }
    return { data: buildTapFile(entry, fileData), ext: '.tap' };
  }
  return { data: fileData, ext: rawFileExtension(format, entry) };
}

/**
 * What a Run or a single-program export is aimed at: one catalog entry, or a
 * loader together with the files it loads. The extract buttons already draw
 * exactly this distinction, so the newer paths take the same shape rather
 * than inventing a second one.
 */
interface ProgramTarget {
  kind: 'file' | 'package';
  /** kind: 'file' */
  entryIndex?: number;
  /** kind: 'package' */
  loaderIndex?: number;
  depIndices?: number[];
}

/**
 * Turn a target into the bytes it stands for, plus enough of its surroundings
 * to name it and to record it as archived. Returns null when the image will
 * not parse, the entry has gone, or a package refuses to build.
 */
function resolveProgram(
  imagePath: string, target: ProgramTarget,
  allEdits?: Record<number, Record<number, string>>,
): {
  format: DiskFormat; title: string; entry: FileEntry;
  data: Buffer; ext: string;
  members: FileEntry[]; fileDataMap: Map<number, Buffer>;
} | null {
  const buffer = fs.readFileSync(imagePath);
  const format = detectFormat(buffer, imagePath);
  if (!format) return null;

  const parser = getParser(format);
  const { entries } = parser.readCatalog(buffer);
  const allEntries = flattenEntries(entries);

  if (target.kind === 'package') {
    const loader = allEntries.find((e) => e.index === target.loaderIndex);
    if (!loader) return null;
    const deps = (target.depIndices ?? [])
      .map((i) => allEntries.find((e) => e.index === i))
      .filter(Boolean) as FileEntry[];

    const fileDataMap = new Map<number, Buffer>();
    for (const member of [loader, ...deps]) {
      const data = parser.readFileData(buffer, member);
      if (data) fileDataMap.set(member.index, data);
    }

    const pkg: TapPackage = { loader, dependencies: deps, unresolved: [] };
    const tapData = buildMultiFileTap(pkg, fileDataMap, allEdits);
    if (!tapData) return null;

    return {
      format, title: loader.filename, entry: loader,
      data: tapData, ext: '.tap',
      members: [loader, ...deps], fileDataMap,
    };
  }

  const entry = allEntries.find((e) => e.index === target.entryIndex);
  if (!entry || entry.isDirectory) return null;
  const fileData = parser.readFileData(buffer, entry);
  if (!fileData) return null;

  const payload = programPayload(format, entry, fileData, allEdits?.[entry.index]);
  if (!payload) return null;

  return {
    format, title: entry.filename, entry,
    data: payload.data, ext: payload.ext,
    members: [entry], fileDataMap: new Map([[entry.index, fileData]]),
  };
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

  // The loader is the program; its source goes out beside the tape.
  const loaderData = fileDataMap.get(loader.index);
  const listingPath = loaderData
    ? writeListingSidecar(
        destDir, safeName || 'package', format, loader, loaderData, allEdits?.[loader.index],
      )
    : null;

  const marked = markExported([loader, ...deps], fileDataMap);

  return {
    filename: loader.filename,
    outputPaths: listingPath ? [tapPath, listingPath] : [tapPath],
    format: 'tap',
    size: tapData.length,
    marked,
  };
});

/**
 * Where a program goes on its way to the emulator. Its own folder under the
 * system temp directory, so nothing here writes near the reader's files, and
 * a stable name per program so relaunching the same one reuses a file rather
 * than leaving a trail of them.
 */
function runScratchDir(): string {
  const dir = path.join(app.getPath('temp'), 'ts2068-disk-browser');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface EmulatorStatus {
  /** The binary that would be used, or null when none was found. */
  path: string | null;
  /** Whether that path came from the reader's own setting. */
  configured: boolean;
}

ipcMain.handle('get-emulator-status', async (): Promise<EmulatorStatus> => {
  const { emulatorPath } = getSettings();
  const found = findEmulator(emulatorPath);
  return { path: found, configured: Boolean(emulatorPath && found === emulatorPath) };
});

ipcMain.handle('pick-emulator', async (): Promise<EmulatorStatus> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choose the ZEsarUX program',
    // The macOS binary lives inside the bundle, so the dialog has to be able
    // to walk into one rather than treat it as a single file.
    properties: process.platform === 'darwin'
      ? ['openFile', 'treatPackageAsDirectory']
      : ['openFile'],
    ...(process.platform === 'darwin' ? { defaultPath: '/Applications' } : {}),
  });
  if (result.canceled || result.filePaths.length === 0) {
    const { emulatorPath } = getSettings();
    const found = findEmulator(emulatorPath);
    return { path: found, configured: Boolean(emulatorPath && found === emulatorPath) };
  }
  updateSettings({ emulatorPath: result.filePaths[0] });
  return { path: result.filePaths[0], configured: true };
});

ipcMain.handle('clear-emulator', async (): Promise<EmulatorStatus> => {
  updateSettings({ emulatorPath: undefined });
  const found = findEmulator();
  return { path: found, configured: false };
});

interface RunResult {
  ok: boolean;
  message: string;
  /** Which machine ZEsarUX was told to be, for the status line to report. */
  machine?: string;
}

/**
 * Hand one program to the emulator. Deliberately the same bytes an export
 * would produce, hand-edited BASIC lines included, so what the reader watches
 * load is what they are about to archive.
 */
ipcMain.handle('run-in-emulator', async (
  _event, imagePath: string, target: ProgramTarget,
  allEdits?: Record<number, Record<number, string>>,
  customTitle?: string,
): Promise<RunResult> => {
  const { emulatorPath } = getSettings();
  const exe = findEmulator(emulatorPath);
  if (!exe) {
    return {
      ok: false,
      message: 'ZEsarUX was not found — install it, or point at it in Preferences',
    };
  }

  const program = resolveProgram(imagePath, target, allEdits);
  if (!program) return { ok: false, message: 'Could not build that program' };

  const machine = machineForFormat(program.format);
  if (!machine) {
    return {
      ok: false,
      message: `Nothing to run: ${program.format} files are not a tape a machine can be handed`,
    };
  }

  const safeName = makeSafeFilename((customTitle ?? program.title).trim()) || 'program';
  const outPath = path.join(runScratchDir(), safeName + program.ext);
  try {
    fs.writeFileSync(outPath, program.data);
    launchEmulator(exe, emulatorArgs(machine, outPath, program.data.length));
  } catch (err: any) {
    return { ok: false, message: `Could not start ZEsarUX: ${err.message}` };
  }

  return { ok: true, message: `Running ${safeName} as ${machine}`, machine };
});

/**
 * One program, named the archive's way and packed on its own.
 *
 * The whole-disk archive.org export writes a whole disk at once; this is the
 * same naming applied to a single program, which is the shape a submission
 * wants — one archive, one program, named so the file says what it is without
 * the folder it sits in having to.
 */
ipcMain.handle('export-tosec', async (
  _event, imagePath: string, target: ProgramTarget, destDir: string,
  metadata: ArchiveMetadata,
  allEdits?: Record<number, Record<number, string>>,
  customTitle?: string,
): Promise<ExtractionResult | null> => {
  const program = resolveProgram(imagePath, target, allEdits);
  if (!program) return null;

  // A package is named for its loader and is a Program whatever its parts
  // are; a lone file is named for whatever it turned out to be.
  const typeSuffix = target.kind === 'package'
    ? 'Program'
    : fileTypeToArchiveSuffix(program.entry);
  const archiveName = buildArchiveName(customTitle ?? program.title, metadata, typeSuffix);

  fs.mkdirSync(destDir, { recursive: true });
  const zipPath = uniquePath(path.join(destDir, archiveName + '.zip'));
  const zipData = buildZipArchive([{ name: archiveName + program.ext, data: program.data }]);
  fs.writeFileSync(zipPath, zipData);

  // The source sits beside the archive rather than inside it: a submission is
  // the program, and the listing is for whoever wants to read it.
  const entryData = program.fileDataMap.get(program.entry.index);
  const listingPath = entryData
    ? writeListingSidecar(
        destDir, archiveName, program.format, program.entry, entryData,
        allEdits?.[program.entry.index],
      )
    : null;

  return {
    filename: program.title,
    outputPaths: listingPath ? [zipPath, listingPath] : [zipPath],
    format: 'zip',
    size: program.data.length,
    marked: markExported(program.members, program.fileDataMap),
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
    graphic: '#a0a0b0', control: '#6f7a8a', text: '#e0e0e0',
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

/**
 * A BASIC listing as zmakebas source.
 *
 * Every line is indented by one space before its number. zmakebas ignores
 * leading whitespace, and the space keeps a line number from being read as
 * markup by whatever the text is pasted into next.
 */
function listingToText(listing: BasicListing, edits?: Record<number, string>): string {
  const maxLn = listing.lines.length > 0
    ? Math.max(...listing.lines.map((l) => l.lineNumber))
    : 0;
  const width = String(maxLn).length;
  return listing.lines.map((line) => {
    const text = edits?.[line.lineNumber] ?? line.tokens.map((t) => t.text).join('');
    return ` ${String(line.lineNumber).padStart(width, ' ')} ${text}`;
  }).join('\n') + '\n';
}

/**
 * The BASIC a file holds, if it holds any — a program, or the program still
 * standing in a memory image. One reading, so that the listing beside an
 * exported program is the listing the app was showing.
 */
function basicListingOf(
  format: DiskFormat, entry: FileEntry, fileData: Buffer,
): BasicListing | null {
  let listing: BasicListing | null = null;
  if (entry.type === 'basic') {
    listing = detokenizeEntry(format, fileData, entry);
  } else if (entry.type === 'state' || entry.isMemoryDump) {
    const origin = format.startsWith('oliger') ? 0x3E00 : 0x4000;
    const stateInfo = extractBasicFromState(fileData, origin);
    if (stateInfo) listing = detokenize(stateInfo.basicData);
  }
  return listing && listing.lines.length > 0 ? listing : null;
}

/**
 * Write the program's source beside whatever binary shape it went out as.
 *
 * A TAP or a ZIP is for a machine; the `.txt` is for a reader, and it is
 * zmakebas source, so it is also how the program gets rebuilt or corrected
 * without an emulator. It takes the same name as the file it accompanies.
 */
function writeListingSidecar(
  destDir: string, baseName: string, format: DiskFormat, entry: FileEntry,
  fileData: Buffer, edits?: Record<number, string>,
): string | null {
  const listing = basicListingOf(format, entry, fileData);
  if (!listing) return null;
  const txtPath = uniquePath(path.join(destDir, baseName + '.txt'));
  fs.writeFileSync(txtPath, listingToText(listing, edits));
  return txtPath;
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
