export type DiskFormat =
  | 'larken'
  | 'oliger-v1'
  | 'oliger-v2'
  | 'aerco-dos64'
  | 'aerco-rpm'
  | 'zebra-dirscp'
  | 'zebra-cpm'
  | 'ql'
  | 'tap'
  | 'tzx'
  | 'sna'
  | 'z80'
  | 'scr'
  | 'mgt'
  | 'zip';

export type FileType =
  | 'basic'
  | 'code'
  | 'num-array'
  | 'str-array'
  | 'module'
  | 'data'
  | 'exec'
  | 'rel'
  | 'dir'
  | 'state'
  | 'unknown';

export interface DiskHeader {
  format: DiskFormat;
  formatName: string;
  diskName: string;
  sides: number;
  tracks: number;
  extra: Record<string, string | number>;
}

export interface FileEntry {
  index: number;
  filename: string;
  type: FileType;
  typeName: string;
  size: number;
  /** Format-specific parameters (autostart line, start address, param2, etc.) */
  params: Record<string, number>;
  blocks: number[];
  isMemoryDump: boolean;
  isDirectory: boolean;
  children?: FileEntry[];
  metadata: Record<string, string>;
  /** Indices of files this BASIC program LOADs (auto-detected) */
  loadDependencies?: number[];
}

export interface LoadReference {
  lineNumber: number;
  filename: string;       // "" means "next file on tape" (unnamed)
  loadType: 'any' | 'code' | 'screen' | 'data';
}

export interface TapPackage {
  loader: FileEntry;              // The BASIC program
  dependencies: FileEntry[];      // Files it LOADs, in order
  unresolved: LoadReference[];    // LOADs that couldn't be matched
}

export interface DiskImage {
  path: string;
  format: DiskFormat;
  header: DiskHeader;
  catalog: FileEntry[];
}

export interface ExtractionResult {
  filename: string;
  outputPaths: string[];
  format: 'tap' | 'raw' | 'dump+tap' | 'zip';
  size: number;
}

export interface CatalogResult {
  header: DiskHeader;
  entries: FileEntry[];
}
