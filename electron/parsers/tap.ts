import { calculateCrc, writeUint16LE } from './utils';
import type { FileEntry } from './types';

/**
 * Build a single TAP block: 2-byte length + flag + data + XOR checksum.
 */
export function buildTapBlock(flag: number, data: Buffer): Buffer {
  const block = Buffer.concat([Buffer.from([flag]), data]);
  const crc = calculateCrc(block);
  const fullBlock = Buffer.concat([block, Buffer.from([crc])]);
  return Buffer.concat([writeUint16LE(fullBlock.length), fullBlock]);
}

/**
 * Build a ZX Spectrum BASIC loader program as raw bytes.
 * Generates:
 *   10 CLEAR <clearAddr>
 *   20 LOAD ""CODE
 *   30 RANDOMIZE USR <entryAddr>
 */
export function buildBasicLoader(clearAddr: number, entryAddr: number): Buffer {
  const lines: Buffer[] = [];

  function numLiteral(n: number): Buffer {
    const digits = Buffer.from(String(n), 'ascii');
    const floatBytes = Buffer.from([
      0x0e, 0x00, 0x00,
      n & 0xff, (n >> 8) & 0xff,
      0x00,
    ]);
    return Buffer.concat([digits, floatBytes]);
  }

  function addLine(lineNum: number, tokens: Buffer) {
    const lineBody = Buffer.concat([tokens, Buffer.from([0x0d])]);
    const lineNumBuf = Buffer.alloc(2);
    lineNumBuf.writeUInt16BE(lineNum);
    const lineLen = writeUint16LE(lineBody.length);
    lines.push(Buffer.concat([lineNumBuf, lineLen, lineBody]));
  }

  // 10 CLEAR <clearAddr>
  addLine(10, Buffer.concat([Buffer.from([0xf9]), numLiteral(clearAddr)]));
  // 20 LOAD ""CODE
  addLine(20, Buffer.from([0xef, 0x22, 0x22, 0xaf]));
  // 30 RANDOMIZE USR <entryAddr>
  addLine(30, Buffer.concat([Buffer.from([0xf5, 0xc0]), numLiteral(entryAddr)]));

  return Buffer.concat(lines);
}

/**
 * Build a complete TAP file for a standard file (BASIC, CODE, arrays).
 */
export function buildTapFile(entry: FileEntry, fileContent: Buffer): Buffer {
  const tapName = Buffer.alloc(10, 0x20); // space-padded
  const nameBytes = Buffer.from(entry.filename.trim().slice(0, 10), 'ascii');
  nameBytes.copy(tapName);

  let tapType: number;
  let tapParam1: number;
  let tapParam2: number;

  switch (entry.type) {
    case 'code':
      tapType = 3;
      tapParam1 = entry.params.startAddr ?? entry.params.param1 ?? 0;
      tapParam2 = 32768;
      break;
    case 'num-array':
      tapType = 1;
      tapParam1 = 0;
      tapParam2 = entry.params.param2 ?? 0;
      break;
    case 'str-array':
      tapType = 2;
      tapParam1 = 0;
      tapParam2 = entry.params.param2 ?? 0;
      break;
    case 'basic':
    default:
      tapType = 0;
      tapParam1 = entry.params.autostartLine ?? entry.params.param1 ?? 0;
      tapParam2 = entry.params.varsOffset ?? entry.params.param2 ?? fileContent.length;
      break;
  }

  // Header block: flag=0x00, type + name + length + param1 + param2
  const headerData = Buffer.concat([
    Buffer.from([0x00]),       // flag
    Buffer.from([tapType]),
    tapName,
    writeUint16LE(fileContent.length),
    writeUint16LE(tapParam1),
    writeUint16LE(tapParam2),
  ]);

  const headerCrc = calculateCrc(headerData);
  const headerBlock = Buffer.concat([
    Buffer.from([0x13, 0x00]),  // length = 19
    headerData,
    Buffer.from([headerCrc]),
  ]);

  // Data block
  const dataBlock = Buffer.concat([Buffer.from([0xff]), fileContent]);
  const dataCrc = calculateCrc(dataBlock);
  const fullDataBlock = Buffer.concat([dataBlock, Buffer.from([dataCrc])]);
  const dataBlockWithLen = Buffer.concat([
    writeUint16LE(fullDataBlock.length),
    fullDataBlock,
  ]);

  return Buffer.concat([headerBlock, dataBlockWithLen]);
}

/**
 * Find the machine code region in a memory dump.
 * Scans from top down for non-zero data, uses RAMTOP from system variables.
 */
function findCodeRegion(dumpData: Buffer, origin: number): { start: number; end: number } {
  const ramtopOffset = 0x5cb2 - origin;
  let codeStartAddr: number;

  if (ramtopOffset >= 0 && ramtopOffset + 2 <= dumpData.length) {
    const ramtop = dumpData[ramtopOffset] | (dumpData[ramtopOffset + 1] << 8);
    codeStartAddr = ramtop + 1;
  } else {
    codeStartAddr = 0xda00; // fallback
  }

  // Find end of code by scanning backward
  let endOffset = dumpData.length - 1;
  while (endOffset > 0 && dumpData[endOffset] === 0) {
    endOffset--;
  }
  const codeEndAddr = origin + endOffset;

  return { start: codeStartAddr, end: codeEndAddr };
}

/**
 * Build a TAP file for a memory dump: BASIC loader + CODE block.
 */
export function buildDumpTap(filename: string, dumpContent: Buffer, origin: number): Buffer {
  const { start: codeStart, end: codeEnd } = findCodeRegion(dumpContent, origin);
  const codeData = dumpContent.subarray(codeStart - origin, codeEnd - origin + 1);
  const clearAddr = codeStart - 1;
  const entryAddr = codeStart;

  // BASIC loader
  const loader = buildBasicLoader(clearAddr, entryAddr);
  const tapName = Buffer.alloc(10, 0x20);
  Buffer.from(filename.slice(0, 10), 'ascii').copy(tapName);

  // BASIC header + data blocks
  const basicHeaderData = Buffer.concat([
    Buffer.from([0x00]),  // type: BASIC
    tapName,
    writeUint16LE(loader.length),
    writeUint16LE(10),              // autostart line 10
    writeUint16LE(loader.length),   // program length
  ]);
  const basicHeaderBlock = buildTapBlock(0x00, basicHeaderData);
  const basicDataBlock = buildTapBlock(0xff, loader);

  // CODE header + data blocks
  const codeHeaderData = Buffer.concat([
    Buffer.from([0x03]),  // type: CODE
    tapName,
    writeUint16LE(codeData.length),
    writeUint16LE(codeStart),
    writeUint16LE(32768),
  ]);
  const codeHeaderBlock = buildTapBlock(0x00, codeHeaderData);
  const codeDataBlock = buildTapBlock(0xff, codeData);

  return Buffer.concat([basicHeaderBlock, basicDataBlock, codeHeaderBlock, codeDataBlock]);
}
