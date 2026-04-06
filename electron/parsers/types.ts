export type DiskFormat =
  | 'larken'
  | 'oliger-v1'
  | 'oliger-v2'
  | 'aerco-dos64'
  | 'aerco-rpm'
  | 'zebra-dirscp'
  | 'zebra-cpm'
  | 'ql';

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
  format: 'tap' | 'raw' | 'dump+tap';
  size: number;
}

export interface CatalogResult {
  header: DiskHeader;
  entries: FileEntry[];
}
