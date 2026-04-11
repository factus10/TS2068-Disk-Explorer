import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('diskTools', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openPath: (filePath: string) => ipcRenderer.invoke('open-path', filePath),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  extractFile: (imagePath: string, entryIndex: number, destDir: string, editedLines?: Record<number, string>) =>
    ipcRenderer.invoke('extract-file', imagePath, entryIndex, destDir, editedLines),
  extractAll: (imagePath: string, destDir: string, allEdits?: Record<number, Record<number, string>>) =>
    ipcRenderer.invoke('extract-all', imagePath, destDir, allEdits),
  getFileData: (imagePath: string, entryIndex: number) =>
    ipcRenderer.invoke('get-file-data', imagePath, entryIndex),
  analyzePackages: (imagePath: string) =>
    ipcRenderer.invoke('analyze-packages', imagePath),
  extractPackage: (imagePath: string, loaderIndex: number, depIndices: number[], destDir: string, allEdits?: Record<number, Record<number, string>>) =>
    ipcRenderer.invoke('extract-package', imagePath, loaderIndex, depIndices, destDir, allEdits),
  getBasicListing: (imagePath: string, entryIndex: number, ts2068Mode?: string) =>
    ipcRenderer.invoke('get-basic-listing', imagePath, entryIndex, ts2068Mode ?? 'auto'),
  getBasicVariables: (imagePath: string, entryIndex: number) =>
    ipcRenderer.invoke('get-basic-variables', imagePath, entryIndex),
  getBasicXref: (imagePath: string, entryIndex: number, ts2068Mode?: string) =>
    ipcRenderer.invoke('get-basic-xref', imagePath, entryIndex, ts2068Mode ?? 'auto'),
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
  printListingPdf: (imagePath: string, entryIndex: number, ts2068Mode?: string) =>
    ipcRenderer.invoke('print-listing-pdf', imagePath, entryIndex, ts2068Mode ?? 'auto'),
  selectFilesForTap: () =>
    ipcRenderer.invoke('select-files-for-tap'),
  createTapFromFiles: (specs: any[], destPath: string) =>
    ipcRenderer.invoke('create-tap-from-files', specs, destPath),
});
