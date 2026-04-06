import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('diskTools', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openPath: (filePath: string) => ipcRenderer.invoke('open-path', filePath),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  extractFile: (imagePath: string, entryIndex: number, destDir: string) =>
    ipcRenderer.invoke('extract-file', imagePath, entryIndex, destDir),
  extractAll: (imagePath: string, destDir: string) =>
    ipcRenderer.invoke('extract-all', imagePath, destDir),
  getFileData: (imagePath: string, entryIndex: number) =>
    ipcRenderer.invoke('get-file-data', imagePath, entryIndex),
  onMenuOpenFile: (callback: () => void) => {
    ipcRenderer.on('menu-open-file', callback);
    return () => ipcRenderer.removeListener('menu-open-file', callback);
  },
});
