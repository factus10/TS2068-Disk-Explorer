/**
 * Z80 snapshot file reader.
 * Supports v1 (30-byte header + compressed/uncompressed RAM),
 * v2 (55-byte header + paged memory), and v3 (86/87-byte header + paged memory).
 * Presents as SCREEN$ + state capture entries.
 */

import { readUint16LE } from './utils';
import type { CatalogResult, DiskHeader, FileEntry } from './types';

const SCREEN_SIZE = 6912;
const RAM_ORIGIN = 0x4000;
const RAM_48K = 49152;

/**
 * Decompress Z80 v1 compressed data.
 * ED ED xx yy = byte yy repeated xx times.
 * Terminated by 00 ED ED 00.
 */
function decompressV1(data: Buffer): Buffer {
  const out: number[] = [];
  let i = 0;

  while (i < data.length) {
    if (i + 3 < data.length && data[i] === 0xed && data[i + 1] === 0xed) {
      const count = data[i + 2];
      const value = data[i + 3];
      for (let j = 0; j < count; j++) out.push(value);
      i += 4;
    } else {
      out.push(data[i]);
      i++;
    }
  }

  return Buffer.from(out);
}

/**
 * Decompress a Z80 v2/v3 memory page.
 */
function decompressPage(data: Buffer, compressedLen: number): Buffer {
  if (compressedLen === 0xffff) {
    // Uncompressed 16K block
    return Buffer.from(data.subarray(0, 16384));
  }

  const out: number[] = [];
  let i = 0;
  const end = Math.min(compressedLen, data.length);

  while (i < end) {
    if (i + 3 < end && data[i] === 0xed && data[i + 1] === 0xed) {
      const count = data[i + 2];
      const value = data[i + 3];
      for (let j = 0; j < count; j++) out.push(value);
      i += 4;
    } else {
      out.push(data[i]);
      i++;
    }
  }

  return Buffer.from(out);
}

function detectVersion(buffer: Buffer): { version: number; headerLen: number; pc: number } {
  // V1: PC at offset 6-7 is non-zero
  const pcV1 = readUint16LE(buffer, 6);
  if (pcV1 !== 0) {
    return { version: 1, headerLen: 30, pc: pcV1 };
  }

  // V2/V3: additional header length at offset 30
  const addLen = readUint16LE(buffer, 30);
  const pc = readUint16LE(buffer, 32);

  if (addLen === 23) return { version: 2, headerLen: 32 + addLen, pc };
  return { version: 3, headerLen: 32 + addLen, pc };
}

export function readCatalog(buffer: Buffer): CatalogResult {
  if (buffer.length < 30) throw new Error('Z80 file too small');

  const { version, headerLen, pc } = detectVersion(buffer);

  // Read registers from header
  const regs: Record<string, string> = {};
  regs['A'] = '0x' + buffer[0].toString(16).padStart(2, '0');
  regs['F'] = '0x' + buffer[1].toString(16).padStart(2, '0');
  regs['BC'] = '0x' + readUint16LE(buffer, 2).toString(16).padStart(4, '0');
  regs['HL'] = '0x' + readUint16LE(buffer, 4).toString(16).padStart(4, '0');
  regs['PC'] = '0x' + pc.toString(16).padStart(4, '0');
  regs['SP'] = '0x' + readUint16LE(buffer, 8).toString(16).padStart(4, '0');
  regs['I'] = '0x' + buffer[10].toString(16).padStart(2, '0');
  regs['R'] = '0x' + ((buffer[11] & 0x7f) | ((buffer[12] & 1) << 7)).toString(16).padStart(2, '0');
  regs['Border'] = String((buffer[12] >> 1) & 7);
  regs['DE'] = '0x' + readUint16LE(buffer, 13).toString(16).padStart(4, '0');
  regs['IY'] = '0x' + readUint16LE(buffer, 23).toString(16).padStart(4, '0');
  regs['IX'] = '0x' + readUint16LE(buffer, 25).toString(16).padStart(4, '0');
  regs['IM'] = String(buffer[29] & 3);

  let hwMode = '';
  if (version >= 2 && headerLen > 34) {
    const hw = buffer[34];
    const modes: Record<number, string> = { 0: '48K', 1: '48K+IF1', 2: 'SamRam', 3: '128K', 4: '128K+IF1' };
    hwMode = modes[hw] ?? `HW ${hw}`;
    regs['Hardware'] = hwMode;
  }

  const header: DiskHeader = {
    format: 'z80',
    formatName: `Z80 Snapshot v${version}${hwMode ? ' (' + hwMode + ')' : ''}`,
    diskName: '',
    sides: 0,
    tracks: 0,
    extra: { version, 'PC': regs['PC'], 'SP': regs['SP'], 'Border': regs['Border'] },
  };

  // Decompress RAM
  let ram: Buffer;

  if (version === 1) {
    const compressed = (buffer[12] & 0x20) !== 0;
    const rawData = buffer.subarray(headerLen);
    ram = compressed ? decompressV1(rawData) : Buffer.from(rawData.subarray(0, RAM_48K));
  } else {
    // V2/V3: read paged memory blocks
    // For 48K: pages 4 (0x8000), 5 (0xC000), 8 (0x4000)
    const pages = new Map<number, Buffer>();
    let pos = headerLen;

    while (pos + 3 <= buffer.length) {
      const compLen = readUint16LE(buffer, pos);
      const pageNum = buffer[pos + 2];
      pos += 3;

      if (pos + (compLen === 0xffff ? 16384 : compLen) > buffer.length) break;

      const pageData = decompressPage(buffer.subarray(pos), compLen);
      pages.set(pageNum, pageData);
      pos += compLen === 0xffff ? 16384 : compLen;
    }

    // Assemble 48K RAM: page 8 → 0x4000, page 4 → 0x8000, page 5 → 0xC000
    ram = Buffer.alloc(RAM_48K);
    const p8 = pages.get(8); if (p8) p8.copy(ram, 0, 0, Math.min(p8.length, 16384));
    const p4 = pages.get(4); if (p4) p4.copy(ram, 16384, 0, Math.min(p4.length, 16384));
    const p5 = pages.get(5); if (p5) p5.copy(ram, 32768, 0, Math.min(p5.length, 16384));
  }

  // Store RAM for readFileData
  (buffer as any).__z80ram = ram;

  const entries: FileEntry[] = [];

  // SCREEN$ (first 6912 bytes of RAM)
  if (ram.length >= SCREEN_SIZE) {
    entries.push({
      index: 0,
      filename: 'SCREEN$   ',
      type: 'code',
      typeName: 'SCREEN$',
      size: SCREEN_SIZE,
      params: { startAddr: RAM_ORIGIN, _isZ80Screen: 1 },
      blocks: [0],
      isMemoryDump: false,
      isDirectory: false,
      metadata: {},
    });
  }

  // Full RAM state capture
  entries.push({
    index: 1,
    filename: 'Memory    ',
    type: 'state',
    typeName: 'State capture',
    size: ram.length,
    params: { startAddr: RAM_ORIGIN, _isZ80Ram: 1 },
    blocks: [1],
    isMemoryDump: true,
    isDirectory: false,
    metadata: regs,
  });

  return { header, entries };
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  const ram: Buffer | undefined = (buffer as any).__z80ram;
  if (!ram) return null;

  if (entry.params._isZ80Screen) {
    return Buffer.from(ram.subarray(0, SCREEN_SIZE));
  }

  if (entry.params._isZ80Ram) {
    return Buffer.from(ram);
  }

  return null;
}
