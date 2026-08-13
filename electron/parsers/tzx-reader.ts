/**
 * TZX tape file reader.
 *
 * TZX carries tapes for more than one machine. A Spectrum or TS2068 tape uses
 * standard and turbo data blocks (0x10, 0x11) holding the same header+data
 * structure as a TAP file. A ZX81 tape has no such headers — its recording is
 * described by the Generalized Data Block (0x19, added in TZX v1.20), whose
 * data stream is the raw tape bytes: a filename in the ZX81 character set with
 * bit 7 set on its final character, then a memory image from 0x4009, exactly
 * the `.p` layout.
 *
 * The two are told apart by what the file actually contains rather than by
 * anything declaring itself, because a TS2068 tape may legitimately use a
 * generalized block for a custom loader. See detectZX81Tape below.
 */

import { readUint16LE } from './utils';
import { decodeZX81Text } from './zx81';
import type { CatalogResult, DiskHeader, FileEntry, FileType } from './types';

/** Where a ZX81 tape image starts in memory; also the `.p` origin. */
const ZX81_SYS_BASE = 0x4009;
/** Offsets of the ZX81 system variables within a saved image. */
const ZX81_DFILE_OFFSET = 0x400C - ZX81_SYS_BASE;
const ZX81_VARS_OFFSET = 0x4010 - ZX81_SYS_BASE;
const ZX81_ELINE_OFFSET = 0x4014 - ZX81_SYS_BASE;
/** A ZX81 filename is at most 127 characters before the bit-7 terminator. */
const ZX81_MAX_NAME = 128;

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

/**
 * The data stream of a Generalized Data Block, and where it sits.
 *
 * Layout after the block id, all little-endian:
 *   +0x00  4  block length, not counting these four bytes
 *   +0x04  2  pause after the block, ms
 *   +0x06  4  TOTP  symbols in the pilot/sync stream
 *   +0x0A  1  NPP   maximum pulses per pilot symbol
 *   +0x0B  1  ASP   pilot symbols in the alphabet (0 means 256)
 *   +0x0C  4  TOTD  symbols in the data stream
 *   +0x10  1  NPD   maximum pulses per data symbol
 *   +0x11  1  ASD   data symbols in the alphabet (0 means 256)
 *   then   PILOT SYMDEF  ASP * (1 + 2*NPP)      when TOTP > 0
 *          PILOT stream  TOTP * 3
 *          DATA SYMDEF   ASD * (1 + 2*NPD)      when TOTD > 0
 *          DATA stream   ceil(NB * TOTD / 8), NB = ceil(log2(ASD))
 *
 * A two-symbol alphabet — which is what a ZX81 recording uses — gives NB of 1,
 * so the data stream is the tape bytes verbatim. Wider alphabets pack several
 * symbols to a byte and do not decode to bytes at all, so they are ignored.
 */
interface GeneralizedBlock {
  dataOffset: number;
  dataLength: number;
  /** Bits per symbol; only 1 yields recoverable bytes. */
  bitsPerSymbol: number;
}

function parseGeneralized(buf: Buffer, pos: number): GeneralizedBlock | null {
  if (pos + 18 > buf.length) return null;
  const totp = buf.readUInt32LE(pos + 6);
  const npp = buf[pos + 10];
  const asp = buf[pos + 11] === 0 ? 256 : buf[pos + 11];
  const totd = buf.readUInt32LE(pos + 12);
  const npd = buf[pos + 16];
  const asd = buf[pos + 17] === 0 ? 256 : buf[pos + 17];
  if (totd === 0) return null;

  const bitsPerSymbol = Math.max(1, Math.ceil(Math.log2(asd)));
  const pilotSymdef = totp > 0 ? asp * (1 + 2 * npp) : 0;
  const pilotStream = totp > 0 ? totp * 3 : 0;
  const dataSymdef = asd * (1 + 2 * npd);
  const dataOffset = pos + 18 + pilotSymdef + pilotStream + dataSymdef;
  const dataLength = Math.ceil((bitsPerSymbol * totd) / 8);

  if (dataOffset + dataLength > buf.length) return null;
  return { dataOffset, dataLength, bitsPerSymbol };
}

/**
 * A ZX81 tape recording: a filename terminated by a character with bit 7 set,
 * then a memory image whose E_LINE system variable accounts for its length.
 *
 * The E_LINE check is what makes this safe to rely on. A TS2068 custom loader
 * carried in a generalized block would have to coincidentally place a plausible
 * address at exactly the right offset to be mistaken for one.
 */
function readZX81Stream(buf: Buffer, offset: number, length: number): {
  name: string; imageOffset: number; imageLength: number; dfile: number; vars: number;
} | null {
  const end = offset + length;

  let nameEnd = -1;
  for (let i = offset; i < Math.min(offset + ZX81_MAX_NAME, end); i++) {
    if (buf[i] & 0x80) { nameEnd = i; break; }
  }
  if (nameEnd < 0) return null;

  const imageOffset = nameEnd + 1;
  if (imageOffset + ZX81_ELINE_OFFSET + 2 > end) return null;

  const eline = readUint16LE(buf, imageOffset + ZX81_ELINE_OFFSET);
  const declared = eline - ZX81_SYS_BASE;
  const available = end - imageOffset;
  // The image should account for itself. Allow a little slack for a recording
  // that captured a few trailing bytes, but nothing like a wrong reading.
  if (declared <= 0 || declared > available || available - declared > 16) return null;

  const nameBytes = Buffer.from(buf.subarray(offset, nameEnd + 1));
  nameBytes[nameBytes.length - 1] &= 0x7f;

  return {
    name: decodeZX81Text(nameBytes).trim(),
    imageOffset,
    imageLength: declared,
    dfile: readUint16LE(buf, imageOffset + ZX81_DFILE_OFFSET),
    vars: readUint16LE(buf, imageOffset + ZX81_VARS_OFFSET),
  };
}

/** One pass over the block chain, collecting both kinds of payload. */
function walkBlocks(buffer: Buffer): { dataBlocks: DataBlock[]; generalized: GeneralizedBlock[] } {
  const dataBlocks: DataBlock[] = [];
  const generalized: GeneralizedBlock[] = [];
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
    } else if (blockType === 0x19) {
      const block = parseGeneralized(buffer, pos);
      if (block) generalized.push(block);
      pos += 4 + buffer.readUInt32LE(pos);
    } else {
      const skipper = BLOCK_SKIP[blockType];
      if (!skipper) break;   // unknown block: the chain cannot be followed further
      pos += skipper(buffer, pos);
    }
  }

  return { dataBlocks, generalized };
}

/** ZX81 files recovered from generalized blocks, in tape order. */
function readZX81Entries(buffer: Buffer, generalized: GeneralizedBlock[]): FileEntry[] {
  const entries: FileEntry[] = [];

  for (const block of generalized) {
    if (block.bitsPerSymbol !== 1) continue;
    const tape = readZX81Stream(buffer, block.dataOffset, block.dataLength);
    if (!tape) continue;

    entries.push({
      index: entries.length,
      filename: tape.name || `TAPE ${entries.length + 1}`,
      type: 'basic',
      typeName: 'ZX81 BASIC',
      size: tape.imageLength,
      params: {
        startAddr: ZX81_SYS_BASE,
        autostartLine: 0,
        // Offsets within the extracted image, as the ZX81 listing expects.
        varsOffset: tape.vars ? tape.vars - ZX81_SYS_BASE : 0,
        progEnd: tape.dfile ? tape.dfile - ZX81_SYS_BASE : 0,
        param1: ZX81_SYS_BASE,
        param2: tape.vars ? tape.vars - ZX81_SYS_BASE : 0,
        dataBlockOffset: tape.imageOffset,
        dataBlockLength: tape.imageLength,
        // The image is the file. There is no flag byte or checksum to trim,
        // unlike the header+data blocks a Spectrum tape is made of.
        rawImage: 1,
      },
      blocks: [],
      isMemoryDump: false,
      isDirectory: false,
      metadata: {
        'Tape name': tape.name,
        'System variables':
          `D_FILE=0x${tape.dfile.toString(16)} VARS=0x${tape.vars.toString(16)}`,
      },
    });
  }

  return entries;
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

  const { dataBlocks, generalized } = walkBlocks(buffer);

  // A tape whose only payload is generalized blocks carrying ZX81 recordings
  // is a ZX81 tape, and its files are memory images rather than header+data
  // pairs. Anything else stays on the Spectrum/TS2068 path below.
  const zx81 = readZX81Entries(buffer, generalized);
  if (dataBlocks.length === 0 && zx81.length > 0) {
    return {
      header: { ...header, format: 'zx81-tzx', formatName: `ZX81 TZX v${verMajor}.${verMinor}` },
      entries: zx81,
    };
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
  if (offset < 0 || length <= 0) return null;
  if (offset + length > buffer.length) return null;

  // A ZX81 memory image is taken whole; a Spectrum block has its flag byte
  // and trailing checksum stripped.
  if (entry.params.rawImage) return Buffer.from(buffer.subarray(offset, offset + length));
  if (length <= 2) return null;
  return Buffer.from(buffer.subarray(offset + 1, offset + length - 1));
}
