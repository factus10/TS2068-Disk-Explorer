export type DiskFormat =
  | 'larken'
  | 'oliger-v1'
  | 'oliger-v2'
  | 'aerco-dos64'
  | 'aerco-rpm'
  | 'zebra-dirscp'
  | 'zebra-cpm'
  | 'ql'
  | 'zx81-aerco'
  | 'tap'
  | 'tzx'
  | 'zx81-tzx'
  | 'sna'
  | 'z80'
  | 'scr'
  | 'mgt'
  | 'zip';

/**
 * ZX81 disks and tapes, whatever they arrived in. Their files are memory
 * images from 0x4009 rather than Spectrum blocks, they list in ZX81 BASIC,
 * and they disassemble against the ZX81 ROM — so almost everywhere one is
 * special-cased the other must be too.
 */
export function isZX81Format(format: DiskFormat): boolean {
  return format === 'zx81-aerco' || format === 'zx81-tzx';
}

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

/**
 * Disassembly choices a reader made in the viewer for one file.
 *
 * These have to travel with an extraction. A `.dis` written with the detected
 * origin, when the reader had corrected it by hand, is not merely different —
 * its sidecar records that origin as provenance, so the artifact says the
 * bytes were read a way they were not.
 */
export interface DisasmSettings {
  /** Load address the reader set, overriding the detected one. */
  origin?: number;
  /** Resolve $0000-$1FFF against the TS2068 EXROM rather than the HOME ROM. */
  exrom?: boolean;
}

/** Per-file disassembly settings, keyed by entry index. */
export type DisasmSettingsMap = Record<number, DisasmSettings>;
