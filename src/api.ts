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

export interface LoadReference {
  lineNumber: number;
  filename: string;
  loadType: 'any' | 'code' | 'screen' | 'data';
}

export interface TapPackage {
  loader: FileEntry;
  dependencies: FileEntry[];
  unresolved: LoadReference[];
}

export type Ts2068Mode = 'auto' | 'ts2068' | 'spectrum';

export interface BasicToken {
  type: 'statement' | 'function' | 'operator' | 'text' | 'udg' | 'graphic' | 'disk-cmd' | 'ts2068-kw';
  text: string;
}

export interface BasicLine {
  lineNumber: number;
  tokens: BasicToken[];
}

export interface BasicListing {
  lines: BasicLine[];
  autostartLine?: number;
}

export interface NumericArrayData {
  kind: 'numeric';
  dimensions: number[];
  values: number[];
  totalElements: number;
}

export interface CharArrayData {
  kind: 'char';
  dimensions: number[];
  values: string[];
  stringLength: number;
  totalElements: number;
}

export type ArrayData = NumericArrayData | CharArrayData;

export interface ManualPackage {
  id: number;
  entries: FileEntry[]; // ordered list — first entry is the "lead" file
}

/** Per-file edit state: line number → edited text (without line number prefix) */
export type FileEdits = Record<number, string>;

/** Map of entry index → edits for that file */
export type EditState = Record<number, FileEdits>;

interface DiskToolsAPI {
  openFileDialog: () => Promise<DiskImage | null>;
  openPath: (filePath: string) => Promise<DiskImage>;
  selectDirectory: () => Promise<string | null>;
  extractFile: (imagePath: string, entryIndex: number, destDir: string, editedLines?: Record<number, string>) => Promise<ExtractionResult | null>;
  extractAll: (imagePath: string, destDir: string, allEdits?: Record<number, Record<number, string>>) => Promise<ExtractionResult[]>;
  getFileData: (imagePath: string, entryIndex: number) => Promise<number[] | null>;
  analyzePackages: (imagePath: string) => Promise<TapPackage[]>;
  extractPackage: (imagePath: string, loaderIndex: number, depIndices: number[], destDir: string, allEdits?: Record<number, Record<number, string>>) => Promise<ExtractionResult | null>;
  getBasicListing: (imagePath: string, entryIndex: number, ts2068Mode?: Ts2068Mode) => Promise<BasicListing | null>;
  getScreenData: (imagePath: string, entryIndex: number, invert: boolean) => Promise<number[] | null>;
  getArrayData: (imagePath: string, entryIndex: number) => Promise<ArrayData | null>;
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
