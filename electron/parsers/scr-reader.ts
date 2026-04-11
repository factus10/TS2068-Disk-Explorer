/**
 * SCR screen file reader.
 * A .scr file is simply a raw 6912-byte ZX Spectrum SCREEN$ dump.
 */

import type { CatalogResult, DiskHeader, FileEntry } from './types';

const SCREEN_SIZE = 6912;

export function detect(buffer: Buffer): boolean {
  return buffer.length === SCREEN_SIZE;
}

export function readCatalog(buffer: Buffer): CatalogResult {
  if (buffer.length < SCREEN_SIZE) {
    throw new Error('SCR file too small');
  }

  const header: DiskHeader = {
    format: 'scr',
    formatName: 'SCR Screen File',
    diskName: '',
    sides: 0,
    tracks: 0,
    extra: {},
  };

  const entries: FileEntry[] = [{
    index: 0,
    filename: 'SCREEN$   ',
    type: 'code',
    typeName: 'SCREEN$',
    size: SCREEN_SIZE,
    params: { startAddr: 16384 },
    blocks: [0],
    isMemoryDump: false,
    isDirectory: false,
    metadata: {},
  }];

  return { header, entries };
}

export function readFileData(buffer: Buffer, _entry: FileEntry): Buffer | null {
  if (buffer.length < SCREEN_SIZE) return null;
  return Buffer.from(buffer.subarray(0, SCREEN_SIZE));
}
