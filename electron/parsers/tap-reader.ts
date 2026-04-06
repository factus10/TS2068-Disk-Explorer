/**
 * TAP file reader.
 * Parses ZX Spectrum .tap files into the same CatalogResult/FileEntry
 * structure used by disk image parsers, so the existing UI works unchanged.
 *
 * TAP format: sequential blocks, each with [2B length LE] [flag] [content] [checksum].
 * Flag 0x00 = header (17 data bytes), flag 0xFF = data block.
 * Header+data pairs form logical files.
 */

import { readUint16LE } from './utils';
import type { CatalogResult, DiskHeader, FileEntry, FileType } from './types';

const SCREEN_SIZE = 6912;
const SCREEN_ADDR = 16384;
const STATE_CAPTURE_MIN = 40000;

const TAP_TYPE_NAMES: Record<number, string> = {
  0: 'BASIC',
  1: 'Numeric array',
  2: 'String array',
  3: 'CODE',
};

function tapTypeToFileType(type: number, dataLen: number, param1: number): FileType {
  // Detect state captures: very large data with non-standard type
  if (dataLen > STATE_CAPTURE_MIN && type >= 4) return 'state';
  switch (type) {
    case 0: return 'basic';
    case 1: return 'num-array';
    case 2: return 'str-array';
    case 3: return 'code';
    default: return 'unknown';
  }
}

interface TapBlock {
  offset: number;       // Offset in buffer where the block starts (after length field)
  length: number;       // Declared block length (includes flag + content + checksum)
  flag: number;         // 0x00 = header, 0xFF = data
  isHeader: boolean;
  checksumValid: boolean;
  // Header fields (only if isHeader)
  tapType?: number;
  name?: string;
  dataLen?: number;
  param1?: number;
  param2?: number;
}

function parseBlocks(buffer: Buffer): TapBlock[] {
  const blocks: TapBlock[] = [];
  let pos = 0;

  while (pos + 2 <= buffer.length) {
    const blockLen = readUint16LE(buffer, pos);
    pos += 2;

    if (blockLen === 0 || pos + blockLen > buffer.length) break;

    const blockStart = pos;
    const flag = buffer[pos];

    // Validate checksum (XOR of all bytes including flag)
    let xor = 0;
    for (let i = 0; i < blockLen - 1; i++) {
      xor ^= buffer[pos + i];
    }
    const checksumValid = xor === buffer[pos + blockLen - 1];

    const block: TapBlock = {
      offset: blockStart,
      length: blockLen,
      flag,
      isHeader: flag === 0x00 && blockLen === 19,
      checksumValid,
    };

    // Parse header fields
    if (block.isHeader) {
      block.tapType = buffer[pos + 1];
      block.name = buffer.subarray(pos + 2, pos + 12).toString('ascii').trim();
      block.dataLen = readUint16LE(buffer, pos + 12);
      block.param1 = readUint16LE(buffer, pos + 14);
      block.param2 = readUint16LE(buffer, pos + 16);
    }

    blocks.push(block);
    pos += blockLen;
  }

  return blocks;
}

export function readCatalog(buffer: Buffer): CatalogResult {
  const blocks = parseBlocks(buffer);

  const header: DiskHeader = {
    format: 'tap',
    formatName: 'TAP File',
    diskName: '',
    sides: 0,
    tracks: 0,
    extra: { blocks: blocks.length },
  };

  const entries: FileEntry[] = [];
  let idx = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.isHeader) {
      // Look for the data block that follows this header
      const dataBlock = (i + 1 < blocks.length && blocks[i + 1].flag === 0xff)
        ? blocks[i + 1]
        : null;

      const tapType = block.tapType ?? 0;
      const dataLen = block.dataLen ?? 0;
      const param1 = block.param1 ?? 0;
      const param2 = block.param2 ?? 0;
      const name = block.name ?? '';

      const fileType = tapTypeToFileType(tapType, dataLen, param1);
      const isScreen = fileType === 'code' && param1 === SCREEN_ADDR && dataLen === SCREEN_SIZE;

      let typeName = TAP_TYPE_NAMES[tapType] ?? `Type ${tapType}`;
      if (isScreen) typeName = 'SCREEN$';
      if (fileType === 'state') typeName = 'State capture';

      const actualDataLen = dataBlock ? dataBlock.length - 2 : 0; // minus flag and checksum

      entries.push({
        index: idx++,
        filename: name.padEnd(10, ' '),
        type: fileType,
        typeName,
        size: actualDataLen || dataLen,
        params: {
          startAddr: fileType === 'code' ? param1 : 0,
          autostartLine: fileType === 'basic' ? (param1 < 32768 ? param1 : 0) : 0,
          varsOffset: fileType === 'basic' ? param2 : 0,
          param1,
          param2,
          // Store data block location for readFileData
          dataBlockOffset: dataBlock ? dataBlock.offset : -1,
          dataBlockLength: dataBlock ? dataBlock.length : 0,
          headerBlockIndex: i,
        },
        blocks: dataBlock ? [i, i + 1] : [i],
        isMemoryDump: fileType === 'state',
        isDirectory: false,
        metadata: {
          ...(block.checksumValid ? {} : { 'Header checksum': 'INVALID' }),
          ...(dataBlock && !dataBlock.checksumValid ? { 'Data checksum': 'INVALID' } : {}),
        },
      });

      // Skip the data block since we've paired it
      if (dataBlock) i++;
    } else {
      // Orphan data block (no preceding header)
      entries.push({
        index: idx++,
        filename: `Block ${i}`.padEnd(10, ' '),
        type: 'unknown',
        typeName: 'Data block',
        size: block.length - 2,
        params: {
          dataBlockOffset: block.offset,
          dataBlockLength: block.length,
          headerBlockIndex: -1,
        },
        blocks: [i],
        isMemoryDump: false,
        isDirectory: false,
        metadata: {
          ...(block.checksumValid ? {} : { Checksum: 'INVALID' }),
        },
      });
    }
  }

  return { header, entries };
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  const offset = entry.params.dataBlockOffset;
  const length = entry.params.dataBlockLength;

  if (offset < 0 || length <= 2) return null;
  if (offset + length > buffer.length) return null;

  // Return content between flag byte and checksum byte
  return Buffer.from(buffer.subarray(offset + 1, offset + length - 1));
}
