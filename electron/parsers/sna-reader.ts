/**
 * SNA snapshot file reader.
 * 48K SNA: 27-byte header + 48K RAM (49179 bytes total).
 * Presents the snapshot as entries: SCREEN$ + full state capture.
 */

import { readUint16LE } from './utils';
import type { CatalogResult, DiskHeader, FileEntry } from './types';

const SNA_48K_SIZE = 49179;
const HEADER_SIZE = 27;
const RAM_SIZE = 49152; // 48K
const SCREEN_SIZE = 6912;
const RAM_ORIGIN = 0x4000;

const REGISTER_NAMES = [
  'I', 'HL\'', 'DE\'', 'BC\'', 'AF\'', 'HL', 'DE', 'BC', 'IY', 'IX',
];

export function detect(buffer: Buffer): boolean {
  return buffer.length === SNA_48K_SIZE;
}

export function readCatalog(buffer: Buffer): CatalogResult {
  if (buffer.length < SNA_48K_SIZE) {
    throw new Error('SNA file too small');
  }

  // Read header registers for metadata
  const regs: Record<string, string> = {};
  regs['I'] = '0x' + buffer[0].toString(16).padStart(2, '0');
  regs['HL\''] = '0x' + readUint16LE(buffer, 1).toString(16).padStart(4, '0');
  regs['DE\''] = '0x' + readUint16LE(buffer, 3).toString(16).padStart(4, '0');
  regs['BC\''] = '0x' + readUint16LE(buffer, 5).toString(16).padStart(4, '0');
  regs['AF\''] = '0x' + readUint16LE(buffer, 7).toString(16).padStart(4, '0');
  regs['HL'] = '0x' + readUint16LE(buffer, 9).toString(16).padStart(4, '0');
  regs['DE'] = '0x' + readUint16LE(buffer, 11).toString(16).padStart(4, '0');
  regs['BC'] = '0x' + readUint16LE(buffer, 13).toString(16).padStart(4, '0');
  regs['IY'] = '0x' + readUint16LE(buffer, 15).toString(16).padStart(4, '0');
  regs['IX'] = '0x' + readUint16LE(buffer, 17).toString(16).padStart(4, '0');
  regs['SP'] = '0x' + readUint16LE(buffer, 19).toString(16).padStart(4, '0');
  regs['IM'] = String(buffer[21]);
  regs['Border'] = String(buffer[22]);

  const header: DiskHeader = {
    format: 'sna',
    formatName: 'SNA Snapshot (48K)',
    diskName: '',
    sides: 0,
    tracks: 0,
    extra: { 'SP': regs['SP'], 'IM': regs['IM'], 'Border': regs['Border'] },
  };

  const entries: FileEntry[] = [];

  // SCREEN$ entry (first 6912 bytes of RAM)
  entries.push({
    index: 0,
    filename: 'SCREEN$   ',
    type: 'code',
    typeName: 'SCREEN$',
    size: SCREEN_SIZE,
    params: {
      startAddr: RAM_ORIGIN,
      dataBlockOffset: HEADER_SIZE,
      dataBlockLength: SCREEN_SIZE,
    },
    blocks: [0],
    isMemoryDump: false,
    isDirectory: false,
    metadata: {},
  });

  // Full RAM as state capture
  entries.push({
    index: 1,
    filename: 'Memory    ',
    type: 'state',
    typeName: 'State capture',
    size: RAM_SIZE,
    params: {
      startAddr: RAM_ORIGIN,
      dataBlockOffset: HEADER_SIZE,
      dataBlockLength: RAM_SIZE,
      ...Object.fromEntries(Object.entries(regs).map(([k, v]) => ['reg_' + k, v])),
    },
    blocks: [1],
    isMemoryDump: true,
    isDirectory: false,
    metadata: regs,
  });

  return { header, entries };
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  const offset = entry.params.dataBlockOffset as number;
  const length = entry.params.dataBlockLength as number;
  if (offset === undefined || length === undefined) return null;
  if (offset + length > buffer.length) return null;
  return Buffer.from(buffer.subarray(offset, offset + length));
}
