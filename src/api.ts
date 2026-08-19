/** How an archived folder stands; see electron/archive-marker.ts. */
export interface FolderArchiveState {
  markedAt: string;
  /** Images counted when the mark was made. */
  imageCount: number;
  /** Images in the folder now. */
  currentCount: number;
  /** Images have been added since the mark — "done" is no longer true. */
  stale: boolean;
  /** The mark lives in app settings because the folder was not writable. */
  external: boolean;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  path: string;
  /** Set for folders only; null when the folder was never marked. */
  archived?: FolderArchiveState | null;
  /**
   * How much of this file or folder is archived, per the configured
   * catalogue. Null when no catalogue is set or it knows nothing about this.
   */
  catalog?: { archived: number; total: number; marked: number; matched: number } | null;
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

export interface ShippedComparison {
  inStep: boolean;
  catalogPrograms: number;
  shippedPrograms: number;
  added: number;
  removed: number;
  statusChanged: number;
  shippedPath: string | null;
}

export interface TodoEntry {
  id: string; title: string; kind: string; size: number;
  /** Copies across the whole collection. */
  copies: number;
  /** Distinct folders holding it — the real measure of how rare it is. */
  folders: number;
  foundIn: string[];
  clue: string;
}

export interface FolderStat {
  folder: string; entries: number; programs: number;
  /** Programs that exist in no other folder — what would be lost with it. */
  onlyHere: number;
  archived: number;
}

export interface Insights {
  root: string;
  todo: TodoEntry[];
  folders: FolderStat[];
  archived: number;
  programs: number;
}

export interface CollectionSurvey {
  root: string;
  /** Images on disk the catalogue has never seen. */
  fresh: string[];
  /** Images the catalogue records that are no longer on disk. */
  gone: string[];
  imagesOnDisk: number;
  imagesKnown: number;
}

export interface IngestResult {
  newPrograms: number;
  newOccurrences: number;
  imagesAdded: number;
  unreadable: { file: string; reason: string }[];
  uniqueCount: number;
  imageCount: number;
}

export interface DiskArchiveStatus {
  entries: Record<number, { known: boolean; archived?: 'marked' | 'matched' }>;
  /** Programs on this disk. */
  total: number;
  /** How many the collection already holds. */
  known: number;
  /** How many are new to it. */
  fresh: number;
  /** Which list answered, so a stale shipped copy is not mistaken for live data. */
  source: string;
}

export interface ExtractionResult {
  /** Programs this export also marked archived in the catalogue, if any. */
  marked?: number;
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

/**
 * How to show the body of a ZX81 REM. `characters` renders it through the
 * character set and token table, which is right for a typed comment; `hex`
 * shows the bytes, which is the only honest reading of a REM holding machine
 * code — and on these disks most of them do.
 */
export type RemStyle = 'characters' | 'hex';

export interface Settings {
  /** Where extractions go by default; also where their .dis files land. */
  extractionDir?: string;
  /** A catalogue folder holding occurrences.csv and marks.json. */
  catalogDir?: string;
  /** What the last check of the published program list saw. */
  catalogUpdate?: { etag?: string; checkedAt?: string; rows?: number };
  /** Check for a newer published program list on launch. */
  autoCheckCatalogUpdate?: boolean;
  /** Whether package and archive.org exports also mark those programs archived. */
  markArchivedOnExport?: boolean;
}

/** A SCREEN$ is 6912 bytes: 6144 of pixels then 768 of attributes. */
export const SCREEN_SIZE = 6912;

/**
 * Whether an entry is a SCREEN$ rather than something to run. A screen is
 * stored as CODE, so nothing but its size tells it apart.
 *
 * The main process decides this too, in screen-decoder.ts — the renderer does
 * not import across that boundary, so the two definitions have to agree.
 */
export function isScreenEntry(entry: { type: string; size: number }): boolean {
  return entry.type === 'code' && entry.size === SCREEN_SIZE;
}

/** A file is called text when this fraction of its bytes are printable. */
export const TEXT_PRINTABLE_THRESHOLD = 0.9;

/**
 * Whether a file reads as text rather than as something to execute. Nearly
 * everything on the newsletter disks is saved as CODE, including the articles.
 *
 * The main process decides this too, in parsers/utils.ts — the renderer does
 * not import across that boundary, so the two definitions have to agree.
 */
export function isTextData(data: ArrayLike<number>): boolean {
  if (!data.length) return false;
  const len = Math.min(data.length, 2048);
  let printable = 0;
  for (let i = 0; i < len; i++) {
    const b = data[i];
    if ((b >= 0x20 && b <= 0x7e) || b === 0x0d || b === 0x0a || b === 0x09) printable++;
  }
  return printable / len >= TEXT_PRINTABLE_THRESHOLD;
}

/**
 * Disassembly choices a reader made for one file. They travel with an
 * extraction so a `.dis` records how the bytes were actually read — its
 * sidecar names the origin as provenance, so exporting a different one would
 * make the artifact describe a reading nobody performed.
 */
export interface DisasmSettings {
  origin?: number;
  exrom?: boolean;
}

export type DisasmSettingsMap = Record<number, DisasmSettings>;

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
  /** Mark or unmark a folder as archived; returns its new state, or null when unmarked. */
  setFolderArchived: (dirPath: string, archived: boolean) => Promise<FolderArchiveState | null>;
  /**
   * Record that an image has had a whole-disk export. If that was the last one
   * in its folder, the main process offers to mark the folder and reports
   * whether it did.
   */
  offerFolderArchive: (imagePath: string) =>
    Promise<{ marked: boolean; dir: string; exported: number; total: number }>;
  /** Mark every catalogued program in a file or folder; returns what changed. */
  setCatalogArchived: (targetPath: string, isDirectory: boolean, archived: boolean)
    => Promise<{ changed: number; total: number; titles: string[] } | null>;
  getCatalogSummary: () => Promise<{ dir: string; images: number; folders: number; programs: number; archived: number } | null>;
  /** Whether the list shipping inside the app still says what the catalogue says. */
  compareShippedList: () => Promise<ShippedComparison | null>;
  /**
   * How the open disk stands against the collection: which of its programs are
   * already known, and which of those are archived. Null when nothing is loaded.
   */
  getDiskArchiveStatus: (imagePath: string) => Promise<DiskArchiveStatus | null>;
  /** Rebuild the shared list of known programs from the catalogue. */
  exportKnownPrograms: () => Promise<{ path: string; rows: number; archived: number; matched: number } | null>;
  onMenuExportKnown: (callback: () => void) => () => void;
  /** Compare the published program list against the one in use, and offer it. */
  checkCatalogUpdate: (quiet?: boolean) => Promise<{ updated: boolean; message: string }>;
  clearCatalogUpdate: () => Promise<boolean>;
  onMenuCheckCatalogUpdate: (callback: () => void) => () => void;
  /** What adding new disks would do, without doing it. */
  surveyCollection: (root?: string) => Promise<CollectionSurvey | null>;
  ingestImages: (root: string, relPaths: string[]) => Promise<IngestResult | null>;
  onIngestProgress: (callback: (p: { done: number; total: number; current: string }) => void) => () => void;
  onMenuIngestCatalog: (callback: () => void) => () => void;
  /** What is rarest and unarchived, and which folders hold unique material. */
  getCatalogInsights: () => Promise<Insights | null>;
  markProgramsArchived: (ids: string[], archived?: boolean) => Promise<{ changed: number } | null>;
  onMenuCatalogInsights: (callback: () => void) => () => void;
  pickCatalogDir: () => Promise<string | null>;
  clearCatalogDir: () => Promise<boolean>;
  openFileDialog: () => Promise<DiskImage | null>;
  openPath: (filePath: string) => Promise<DiskImage>;
  selectDirectory: () => Promise<string | null>;
  extractFile: (imagePath: string, entryIndex: number, destDir: string, editedLines?: Record<number, string>, customBaseName?: string) => Promise<ExtractionResult | null>;
  extractAll: (imagePath: string, destDir: string, allEdits?: Record<number, Record<number, string>>, allDisasm?: DisasmSettingsMap) => Promise<ExtractionResult[]>;
  exportArchive: (imagePath: string, destOrZipPath: string, metadata: { year: string; publisher: string; system: string; country: string; format: string }, allEdits?: Record<number, Record<number, string>>, allDisasm?: DisasmSettingsMap, entryIndices?: number[]) => Promise<ExtractionResult[]>;
  getFileData: (imagePath: string, entryIndex: number) => Promise<number[] | null>;
  analyzePackages: (imagePath: string) => Promise<TapPackage[]>;
  extractPackage: (imagePath: string, loaderIndex: number, depIndices: number[], destDir: string, allEdits?: Record<number, Record<number, string>>, customBaseName?: string) => Promise<ExtractionResult | null>;
  getSettings: () => Promise<Settings>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  /** Offer to remember a folder after the first extraction; true if accepted. */
  offerDefaultExtractionDir: (dir: string) => Promise<boolean>;
  /** Choose the default extraction folder outright, from Preferences. */
  pickExtractionDir: () => Promise<string | null>;
  onMenuPreferences: (callback: () => void) => () => void;
  getBasicListing: (imagePath: string, entryIndex: number, ts2068Mode?: Ts2068Mode, remStyle?: RemStyle) => Promise<BasicListing | null>;
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
  printListingPdf: (imagePath: string, entryIndex: number, ts2068Mode?: Ts2068Mode, remStyle?: RemStyle) => Promise<string | null>;
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
