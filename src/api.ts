export interface DiskHeader {
  format: string;
  formatName: string;
  diskName: string;
  sides: number;
  tracks: number;
  extra: Record<string, string | number>;
}

export interface FileEntry {
  index: number;
  filename: string;
  type: string;
  typeName: string;
  size: number;
  params: Record<string, number>;
  blocks: number[];
  isMemoryDump: boolean;
  isDirectory: boolean;
  children?: FileEntry[];
  metadata: Record<string, string>;
}

export interface DiskImage {
  path: string;
  format: string;
  header: DiskHeader;
  catalog: FileEntry[];
}

export interface ExtractionResult {
  filename: string;
  outputPaths: string[];
  format: string;
  size: number;
}

interface DiskToolsAPI {
  openFileDialog: () => Promise<DiskImage | null>;
  openPath: (filePath: string) => Promise<DiskImage>;
  selectDirectory: () => Promise<string | null>;
  extractFile: (imagePath: string, entryIndex: number, destDir: string) => Promise<ExtractionResult | null>;
  extractAll: (imagePath: string, destDir: string) => Promise<ExtractionResult[]>;
  getFileData: (imagePath: string, entryIndex: number) => Promise<number[] | null>;
  onMenuOpenFile: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    diskTools: DiskToolsAPI;
  }
}

export const api = typeof window !== 'undefined' && window.diskTools
  ? window.diskTools
  : null!;
