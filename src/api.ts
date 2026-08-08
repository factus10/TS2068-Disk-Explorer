export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  path: string;
}

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

export interface XRefEntry {
  name: string;
  kind: 'numeric' | 'string' | 'array-num' | 'array-str' | 'fn';
  assignments: number[];
  reads: number[];
}

export interface XRefResult {
  entries: XRefEntry[];
}

export interface TapFileSpec {
  filePath: string;
  tapName: string;
  tapType: number; // 0=BASIC, 3=CODE
  param1: number;  // autostart line or start address
  param2: number;  // vars offset or 32768
}

export interface BasicVariable {
  name: string;
  kind: 'number' | 'string' | 'number-array' | 'string-array' | 'for';
  value?: string;
  dimensions?: number[];
  values?: string[];
  forValue?: number;
  forLimit?: number;
  forStep?: number;
  forLine?: number;
  forStatement?: number;
}

interface DiskToolsAPI {
  getPathForFile: (file: File) => string;
  getHomeDirectory: () => Promise<string>;
  listDirectory: (dirPath: string) => Promise<DirEntry[]>;
  openFileDialog: () => Promise<DiskImage | null>;
  openPath: (filePath: string) => Promise<DiskImage>;
  selectDirectory: () => Promise<string | null>;
  extractFile: (imagePath: string, entryIndex: number, destDir: string, editedLines?: Record<number, string>, customBaseName?: string) => Promise<ExtractionResult | null>;
  extractAll: (imagePath: string, destDir: string, allEdits?: Record<number, Record<number, string>>) => Promise<ExtractionResult[]>;
  exportArchive: (imagePath: string, destOrZipPath: string, metadata: { year: string; publisher: string; system: string; country: string; format: string }, allEdits?: Record<number, Record<number, string>>) => Promise<ExtractionResult[]>;
  getFileData: (imagePath: string, entryIndex: number) => Promise<number[] | null>;
  analyzePackages: (imagePath: string) => Promise<TapPackage[]>;
  extractPackage: (imagePath: string, loaderIndex: number, depIndices: number[], destDir: string, allEdits?: Record<number, Record<number, string>>, customBaseName?: string) => Promise<ExtractionResult | null>;
  getBasicListing: (imagePath: string, entryIndex: number, ts2068Mode?: Ts2068Mode) => Promise<BasicListing | null>;
  getBasicVariables: (imagePath: string, entryIndex: number) => Promise<BasicVariable[] | null>;
  getBasicXref: (imagePath: string, entryIndex: number, ts2068Mode?: Ts2068Mode) => Promise<XRefResult | null>;
  getDisassembly: (imagePath: string, entryIndex: number, originOverride?: number, exrom?: boolean)
    => Promise<{ text: string; origin: number; instructions: number; conflicts: number } | null>;
  getDiskMap: (imagePath: string) => Promise<{ totalBlocks: number } | null>;
  extractBasicFromState: (imagePath: string, entryIndex: number, destDir: string) => Promise<ExtractionResult | null>;
  getScreenData: (imagePath: string, entryIndex: number, invert: boolean) => Promise<number[] | null>;
  getArrayData: (imagePath: string, entryIndex: number) => Promise<ArrayData | null>;
  onMenuOpenFile: (callback: () => void) => () => void;
  onMenuOpenRecent: (callback: (_event: any, filePath: string) => void) => () => void;
  onMenuCreateTap: (callback: () => void) => () => void;
  exportAllFonts: (imagePath: string, destDir: string) => Promise<number>;
  exportAllScreens: (imagePath: string, destDir: string) => Promise<number>;
  printListingPdf: (imagePath: string, entryIndex: number, ts2068Mode?: Ts2068Mode) => Promise<string | null>;
  saveTapDialog: (defaultName: string) => Promise<string | null>;
  saveZipDialog: (defaultName: string) => Promise<string | null>;
  selectFilesForTap: () => Promise<string[] | null>;
  createTapFromFiles: (specs: TapFileSpec[], destPath: string) => Promise<string | null>;
}

declare global {
  interface Window {
    diskTools: DiskToolsAPI;
  }
}

export const api = typeof window !== 'undefined' && window.diskTools
  ? window.diskTools
  : null!;
