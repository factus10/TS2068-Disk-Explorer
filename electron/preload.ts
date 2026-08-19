import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('diskTools', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getHomeDirectory: () => ipcRenderer.invoke('get-home-directory'),
  listDirectory: (dirPath: string) => ipcRenderer.invoke('list-directory', dirPath),
  setFolderArchived: (dirPath: string, archived: boolean) =>
    ipcRenderer.invoke('set-folder-archived', dirPath, archived),
  offerFolderArchive: (imagePath: string) =>
    ipcRenderer.invoke('offer-folder-archive', imagePath),
  setCatalogArchived: (targetPath: string, isDirectory: boolean, archived: boolean) =>
    ipcRenderer.invoke('set-catalog-archived', targetPath, isDirectory, archived),
  getCatalogSummary: () => ipcRenderer.invoke('get-catalog-summary'),
  compareShippedList: () => ipcRenderer.invoke('compare-shipped-list'),
  exportKnownPrograms: () => ipcRenderer.invoke('export-known-programs'),
  checkCatalogUpdate: (quiet?: boolean) => ipcRenderer.invoke('check-catalog-update', quiet ?? false),
  surveyCollection: (root?: string) => ipcRenderer.invoke('survey-collection', root),
  getCatalogInsights: () => ipcRenderer.invoke('get-catalog-insights'),
  markProgramsArchived: (ids: string[], archived?: boolean) =>
    ipcRenderer.invoke('mark-programs-archived', ids, archived ?? true),
  onMenuCatalogInsights: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu-catalog-insights', handler);
    return () => ipcRenderer.removeListener('menu-catalog-insights', handler);
  },
  ingestImages: (root: string, relPaths: string[]) => ipcRenderer.invoke('ingest-images', root, relPaths),
  onIngestProgress: (callback: (p: { done: number; total: number; current: string }) => void) => {
    const handler = (_e: any, p: any) => callback(p);
    ipcRenderer.on('ingest-progress', handler);
    return () => ipcRenderer.removeListener('ingest-progress', handler);
  },
  onMenuIngestCatalog: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu-ingest-catalog', handler);
    return () => ipcRenderer.removeListener('menu-ingest-catalog', handler);
  },
  clearCatalogUpdate: () => ipcRenderer.invoke('clear-catalog-update'),
  onMenuCheckCatalogUpdate: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu-check-catalog-update', handler);
    return () => ipcRenderer.removeListener('menu-check-catalog-update', handler);
  },
  onMenuExportKnown: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu-export-known', handler);
    return () => ipcRenderer.removeListener('menu-export-known', handler);
  },
  getDiskArchiveStatus: (imagePath: string) => ipcRenderer.invoke('get-disk-archive-status', imagePath),
  pickCatalogDir: () => ipcRenderer.invoke('pick-catalog-dir'),
  clearCatalogDir: () => ipcRenderer.invoke('clear-catalog-dir'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openPath: (filePath: string) => ipcRenderer.invoke('open-path', filePath),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  extractFile: (imagePath: string, entryIndex: number, destDir: string, editedLines?: Record<number, string>, customBaseName?: string) =>
    ipcRenderer.invoke('extract-file', imagePath, entryIndex, destDir, editedLines, customBaseName),
  extractAll: (imagePath: string, destDir: string, allEdits?: Record<number, Record<number, string>>,
    allDisasm?: Record<number, { origin?: number; exrom?: boolean }>) =>
    ipcRenderer.invoke('extract-all', imagePath, destDir, allEdits, allDisasm),
  exportArchive: (imagePath: string, destDir: string, metadata: any, allEdits?: Record<number, Record<number, string>>,
    allDisasm?: Record<number, { origin?: number; exrom?: boolean }>, entryIndices?: number[]) =>
    ipcRenderer.invoke('export-archive', imagePath, destDir, metadata, allEdits, allDisasm, entryIndices),
  saveZipDialog: (defaultName: string) =>
    ipcRenderer.invoke('save-zip-dialog', defaultName),
  getFileData: (imagePath: string, entryIndex: number) =>
    ipcRenderer.invoke('get-file-data', imagePath, entryIndex),
  analyzePackages: (imagePath: string) =>
    ipcRenderer.invoke('analyze-packages', imagePath),
  extractPackage: (imagePath: string, loaderIndex: number, depIndices: number[], destDir: string, allEdits?: Record<number, Record<number, string>>, customBaseName?: string) =>
    ipcRenderer.invoke('extract-package', imagePath, loaderIndex, depIndices, destDir, allEdits, customBaseName),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('update-settings', patch),
  offerDefaultExtractionDir: (dir: string) => ipcRenderer.invoke('offer-default-extraction-dir', dir),
  pickExtractionDir: () => ipcRenderer.invoke('pick-extraction-dir'),
  onMenuPreferences: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu-preferences', handler);
    return () => ipcRenderer.removeListener('menu-preferences', handler);
  },
  getBasicListing: (imagePath: string, entryIndex: number, ts2068Mode?: string, remStyle?: string) =>
    ipcRenderer.invoke('get-basic-listing', imagePath, entryIndex, ts2068Mode ?? 'auto', remStyle ?? 'characters'),
  getBasicVariables: (imagePath: string, entryIndex: number) =>
    ipcRenderer.invoke('get-basic-variables', imagePath, entryIndex),
  getBasicXref: (imagePath: string, entryIndex: number, ts2068Mode?: string) =>
    ipcRenderer.invoke('get-basic-xref', imagePath, entryIndex, ts2068Mode ?? 'auto'),
  getDisassembly: (imagePath: string, entryIndex: number, originOverride?: number, exrom?: boolean) =>
    ipcRenderer.invoke('get-disassembly', imagePath, entryIndex, originOverride, exrom),
  getDiskMap: (imagePath: string) =>
    ipcRenderer.invoke('get-disk-map', imagePath),
  extractBasicFromState: (imagePath: string, entryIndex: number, destDir: string) =>
    ipcRenderer.invoke('extract-basic-from-state', imagePath, entryIndex, destDir),
  getScreenData: (imagePath: string, entryIndex: number, invert: boolean) =>
    ipcRenderer.invoke('get-screen-data', imagePath, entryIndex, invert),
  getArrayData: (imagePath: string, entryIndex: number) =>
    ipcRenderer.invoke('get-array-data', imagePath, entryIndex),
  onMenuOpenFile: (callback: () => void) => {
    ipcRenderer.on('menu-open-file', callback);
    return () => ipcRenderer.removeListener('menu-open-file', callback);
  },
  onMenuOpenRecent: (callback: (_event: any, filePath: string) => void) => {
    ipcRenderer.on('menu-open-recent', callback);
    return () => ipcRenderer.removeListener('menu-open-recent', callback);
  },
  onMenuCreateTap: (callback: () => void) => {
    ipcRenderer.on('menu-create-tap', callback);
    return () => ipcRenderer.removeListener('menu-create-tap', callback);
  },
  exportAllFonts: (imagePath: string, destDir: string) =>
    ipcRenderer.invoke('export-all-fonts', imagePath, destDir),
  exportAllScreens: (imagePath: string, destDir: string) =>
    ipcRenderer.invoke('export-all-screens', imagePath, destDir),
  printListingPdf: (imagePath: string, entryIndex: number, ts2068Mode?: string, remStyle?: string) =>
    ipcRenderer.invoke('print-listing-pdf', imagePath, entryIndex, ts2068Mode ?? 'auto', remStyle ?? 'characters'),
  saveTapDialog: (defaultName: string) =>
    ipcRenderer.invoke('save-tap-dialog', defaultName),
  selectFilesForTap: () =>
    ipcRenderer.invoke('select-files-for-tap'),
  createTapFromFiles: (specs: any[], destPath: string) =>
    ipcRenderer.invoke('create-tap-from-files', specs, destPath),
});
