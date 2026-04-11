/**
 * TZX tape file reader.
 * Extracts standard data blocks (types 0x10, 0x11) which contain
 * the same header+data structure as TAP files.
 * Non-data blocks (timing, tone, pulses) are skipped.
 */

import { readUint16LE } from './utils';
import type { CatalogResult, DiskHeader, FileEntry, FileType } from './types';

const TZX_SIGNATURE = 'ZXTape!\x1a';
const SCREEN_SIZE = 6912;
const SCREEN_ADDR = 16384;
const STATE_CAPTURE_MIN = 40000;

// Block sizes for skipping non-data blocks
const BLOCK_SKIP: Record<number, (buf: Buffer, pos: number) => number> = {
  0x12: () => 4,                    // Pure tone
  0x13: (buf, pos) => 1 + buf[pos] * 2, // Pulse sequence
  0x14: (buf, pos) => 7 + (readUint16LE(buf, pos + 5) | (buf[pos + 7] << 16)), // Pure data
  0x15: (buf, pos) => 5 + (readUint16LE(buf, pos + 3) | (buf[pos + 5] << 16)), // Direct recording
  0x18: (buf, pos) => 4 + (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)), // CSW recording
  0x19: (buf, pos) => 4 + (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)), // Generalized data
  0x20: () => 2,                    // Pause
  0x21: (buf, pos) => 1 + buf[pos], // Group start
  0x22: () => 0,                    // Group end
  0x23: () => 2,                    // Jump
  0x24: () => 2,                    // Loop start
  0x25: () => 0,                    // Loop end
  0x26: (buf, pos) => 2 + readUint16LE(buf, pos) * 2, // Call sequence
  0x27: () => 0,                    // Return
  0x28: (buf, pos) => 2 + readUint16LE(buf, pos), // Select block
  0x2A: () => 4,                    // Stop tape if 48K
  0x2B: () => 4,                    // Set signal level
  0x30: (buf, pos) => 1 + buf[pos], // Text description
  0x31: (buf, pos) => 2 + buf[pos + 1], // Message block
  0x32: (buf, pos) => 2 + readUint16LE(buf, pos), // Archive info
  0x33: (buf, pos) => 1 + buf[pos] * 3, // Hardware type
  0x35: (buf, pos) => 16 + 4 + (buf[pos + 16] | (buf[pos + 17] << 8) | (buf[pos + 18] << 16) | (buf[pos + 19] << 24)), // Custom info
  0x5A: () => 9,                    // Glue block
};

function tapTypeToFileType(type: number, dataLen: number): FileType {
  if (dataLen > STATE_CAPTURE_MIN && type >= 4) return 'state';
  switch (type) {
    case 0: return 'basic';
    case 1: return 'num-array';
    case 2: return 'str-array';
    case 3: return 'code';
    default: return 'unknown';
  }
}

const TAP_TYPE_NAMES: Record<number, string> = {
  0: 'BASIC', 1: 'Numeric array', 2: 'String array', 3: 'CODE',
};

interface DataBlock {
  offset: number;
  length: number;
  flag: number;
}

export function readCatalog(buffer: Buffer): CatalogResult {
  // Verify TZX signature
  const sig = buffer.subarray(0, 8).toString('ascii');
  if (sig !== TZX_SIGNATURE) {
    throw new Error('Not a valid TZX file');
  }

  const verMajor = buffer[8];
  const verMinor = buffer[9];

  const header: DiskHeader = {
    format: 'tzx',
    formatName: `TZX v${verMajor}.${verMinor}`,
    diskName: '',
    sides: 0,
    tracks: 0,
    extra: { version: `${verMajor}.${verMinor}` },
  };

  // Extract data blocks
  const dataBlocks: DataBlock[] = [];
  let pos = 10;

  while (pos < buffer.length) {
    const blockType = buffer[pos++];

    if (blockType === 0x10) {
      // Standard speed data block
      const dataLen = readUint16LE(buffer, pos + 2);
      dataBlocks.push({ offset: pos + 4, length: dataLen, flag: buffer[pos + 4] });
      pos += 4 + dataLen;
    } else if (blockType === 0x11) {
      // Turbo speed data block
      const dataLen = readUint16LE(buffer, pos + 15) | (buffer[pos + 17] << 16);
      dataBlocks.push({ offset: pos + 18, length: dataLen, flag: buffer[pos + 18] });
      pos += 18 + dataLen;
    } else {
      // Skip non-data block
      const skipper = BLOCK_SKIP[blockType];
      if (skipper) {
        pos += skipper(buffer, pos);
      } else {
        break; // Unknown block type, stop
      }
    }
  }

  // Parse data blocks as TAP-style header+data pairs
  const entries: FileEntry[] = [];
  let idx = 0;

  for (let i = 0; i < dataBlocks.length; i++) {
    const block = dataBlocks[i];

    // Header block: flag=0x00 and length=19
    if (block.flag === 0x00 && block.length === 19) {
      const hdrStart = block.offset;
      const tapType = buffer[hdrStart + 1];
      const name = buffer.subarray(hdrStart + 2, hdrStart + 12).toString('ascii').trim();
      const dataLen = readUint16LE(buffer, hdrStart + 12);
      const param1 = readUint16LE(buffer, hdrStart + 14);
      const param2 = readUint16LE(buffer, hdrStart + 16);

      const dataBlock = (i + 1 < dataBlocks.length && dataBlocks[i + 1].flag === 0xff)
        ? dataBlocks[i + 1] : null;

      const fileType = tapTypeToFileType(tapType, dataLen);
      const isScreen = fileType === 'code' && param1 === SCREEN_ADDR && dataLen === SCREEN_SIZE;
      let typeName = TAP_TYPE_NAMES[tapType] ?? `Type ${tapType}`;
      if (isScreen) typeName = 'SCREEN$';
      if (fileType === 'state') typeName = 'State capture';

      const actualDataLen = dataBlock ? dataBlock.length - 2 : 0;

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
          param1, param2,
          dataBlockOffset: dataBlock ? dataBlock.offset : -1,
          dataBlockLength: dataBlock ? dataBlock.length : 0,
        },
        blocks: dataBlock ? [i, i + 1] : [i],
        isMemoryDump: fileType === 'state',
        isDirectory: false,
        metadata: {},
      });

      if (dataBlock) i++;
    } else if (block.flag === 0xff) {
      // Orphan data block
      entries.push({
        index: idx++,
        filename: `Block ${i}`.padEnd(10, ' '),
        type: 'unknown',
        typeName: 'Data block',
        size: block.length - 2,
        params: {
          dataBlockOffset: block.offset,
          dataBlockLength: block.length,
        },
        blocks: [i],
        isMemoryDump: false,
        isDirectory: false,
        metadata: {},
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
  return Buffer.from(buffer.subarray(offset + 1, offset + length - 1));
}
