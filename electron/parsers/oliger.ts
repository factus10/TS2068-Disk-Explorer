import { readUint16LE, readUint16BE } from './utils';
import type { CatalogResult, DiskHeader, FileEntry, FileType } from './types';

const BLOCK_SIZE = 5120;
const DIR_OFFSET = 0x600;
const DIR_HEADER_SIZE = 32;
const DIR_ENTRY_OFFSET = 0x620;
const DIR_ENTRY_SIZE = 20;
const DIR_END_MARKER = 0x80;

const TYPE_BASIC = 0;
const TYPE_NUM_ARRAY = 1;
const TYPE_STR_ARRAY = 2;
const TYPE_CODE = 3;

const FILE_TYPE_NAMES = ['BASIC', 'Numeric array', 'String array', 'CODE', 'State capture'];

const ABS_SAVE_START = 0x3e00;
const ABS_SAVE_MIN = 45000;

const V1_SLOT_CYLINDERS = 5;
const V1_SLOT_SIZE = V1_SLOT_CYLINDERS * BLOCK_SIZE;

function typeCodeToFileType(code: number): FileType {
  switch (code) {
    case 0: return 'basic';
    case 1: return 'num-array';
    case 2: return 'str-array';
    case 3: return 'code';
    case 4: return 'state';
    default: return 'unknown';
  }
}

function detectVersion(firstBlock: Buffer): 'V1' | 'V2' {
  const tracks = firstBlock[DIR_OFFSET];
  const sides = firstBlock[DIR_OFFSET + 1];
  if (tracks >= 2 && tracks <= 255 && (sides === 1 || sides === 2)) return 'V2';
  return 'V1';
}

function calculateCylinderNumber(b0: number, b1: number, sides: number): number {
  if (sides === 1) {
    // Single-sided: cylinder number = track number directly
    return b0;
  }
  // Double-sided: interleave sides (cyl 0 = T0S0, cyl 1 = T0S1, cyl 2 = T1S0, ...)
  let result = b0 * 2;
  if (b1 !== 0) result += 1;
  return result;
}

// V2 format

function readV2Catalog(buffer: Buffer): CatalogResult {
  const firstBlock = buffer.subarray(0, Math.min(BLOCK_SIZE, buffer.length));
  const dirHeader = firstBlock.subarray(DIR_OFFSET, DIR_OFFSET + DIR_HEADER_SIZE);

  const tracks = dirHeader[0];
  const sides = dirHeader[1];
  const totalCylinders = dirHeader[2];
  const availCylinders = dirHeader[4];
  const diskName = dirHeader.subarray(16, 32).toString('ascii').replace(/\0/g, '').trim();

  const expectedSize = totalCylinders * BLOCK_SIZE;
  const isTruncated = buffer.length < expectedSize;

  const header: DiskHeader = {
    format: 'oliger-v2',
    formatName: 'Oliger (JLO SAFE V2)',
    diskName,
    sides,
    tracks,
    extra: {
      totalCylinders,
      availableCylinders: availCylinders,
      ...(isTruncated ? { warning: `Image truncated: ${buffer.length} of ${expectedSize} bytes` } : {}),
    },
  };

  const entries: FileEntry[] = [];
  let offset = DIR_ENTRY_OFFSET;
  let idx = 0;

  while (offset + DIR_ENTRY_SIZE <= firstBlock.length) {
    const entry = firstBlock.subarray(offset, offset + DIR_ENTRY_SIZE);
    if (entry[0] === DIR_END_MARKER) break;

    const filename = entry.subarray(0, 10).toString('ascii').replace(/\0/g, '');
    const filetype = entry[10];
    const filesize = readUint16LE(entry, 11);
    const staline = readUint16LE(entry, 13);
    const param2 = readUint16LE(entry, 15);
    const cylinder = calculateCylinderNumber(entry[17], entry[18], sides);
    const cylused = entry[19];

    const ft = typeCodeToFileType(filetype);
    const isAbs = filesize >= ABS_SAVE_MIN && filetype === TYPE_BASIC && param2 === 0;

    // Check if file data is within the image boundaries
    const startOffset = cylinder * BLOCK_SIZE;
    const endOffset = (cylinder + cylused) * BLOCK_SIZE;
    const truncated = endOffset > buffer.length;
    const beyond = startOffset >= buffer.length;

    // Check for blank/formatted data (all 0xE5 fill bytes)
    let isBlank = false;
    if (!beyond && startOffset + 32 <= buffer.length) {
      isBlank = true;
      for (let j = startOffset; j < Math.min(startOffset + 32, buffer.length); j++) {
        if (buffer[j] !== 0xe5) { isBlank = false; break; }
      }
    }

    const metadata: Record<string, string> = {};
    if (beyond) metadata['Status'] = 'Beyond image boundary';
    else if (isBlank) metadata['Status'] = 'Empty (unwritten data)';
    else if (truncated) metadata['Status'] = 'Truncated (image too small)';

    entries.push({
      index: idx++,
      filename,
      type: ft,
      typeName: FILE_TYPE_NAMES[filetype] ?? `Unknown (${filetype})`,
      size: filesize,
      params: {
        startAddr: ft === 'code' ? staline : 0,
        autostartLine: ft === 'basic' ? staline : 0,
        varsOffset: ft === 'basic' ? param2 : 0,
        param1: staline,
        param2,
        cylinder,
        cylused,
      },
      blocks: Array.from({ length: cylused }, (_, i) => cylinder + i),
      isMemoryDump: isAbs,
      isDirectory: false,
      metadata,
    });

    offset += DIR_ENTRY_SIZE;
  }

  return { header, entries };
}

// V1 format

function parseV1BootBasic(firstBlock: Buffer): {
  fileNumbers: number[];
  names: Record<number, string>;
} {
  const progLen = readUint16LE(firstBlock, 0);
  const varsOff = readUint16LE(firstBlock, 2);

  let offset = 4;
  const end = 4 + Math.min(varsOff, progLen, firstBlock.length - 4);

  const menuEntries: Record<string, string> = {};
  const explicitLoads: Set<number> = new Set();
  let hasLoadVal = false;

  while (offset + 4 <= end) {
    const lineNum = readUint16BE(firstBlock, offset);
    const lineLen = readUint16LE(firstBlock, offset + 2);
    if (lineNum > 9999 || lineLen > 500 || lineLen === 0) break;

    const lineData = firstBlock.subarray(offset + 4, offset + 4 + lineLen);

    // Extract menu items from PRINT statements: "X. Program Name"
    const qstart = lineData.indexOf(0x22);
    if (qstart !== -1) {
      const qend = lineData.indexOf(0x22, qstart + 1);
      if (qend !== -1) {
        const text = lineData.subarray(qstart + 1, qend).toString('ascii').trim();
        if (text.length > 3 && text[1] === '.') {
          const key = text[0].toUpperCase();
          let name = text.substring(3).trim();
          const paren = name.indexOf('(');
          if (paren > 0) name = name.substring(0, paren).trim();
          if (name) menuEntries[key] = name;
        }
      }
    }

    // Scan for LOAD / patterns
    let i = 0;
    while (i < lineData.length - 2) {
      if (lineData[i] === 0xef && lineData[i + 1] === 0x2f) {
        i += 2;
        if (i < lineData.length && lineData[i] === 0xb0) {
          hasLoadVal = true;
        } else {
          let digits = '';
          while (i < lineData.length && lineData[i] >= 0x30 && lineData[i] <= 0x39) {
            digits += String.fromCharCode(lineData[i]);
            i++;
          }
          if (i < lineData.length && lineData[i] === 0x0e) i += 6;
          if (digits) explicitLoads.add(parseInt(digits));
        }
        continue;
      }
      i++;
    }

    offset += 4 + lineLen;
  }

  // Build key -> file number mapping
  const keyToFile: Record<string, number> = {};
  for (const ch of '123456789') keyToFile[ch] = parseInt(ch);
  keyToFile['0'] = 10;
  'ABCDEF'.split('').forEach((ch, i) => { keyToFile[ch] = 11 + i; });

  const fileNumbers: Set<number> = new Set();
  const names: Record<number, string> = {};

  if (hasLoadVal) {
    for (let n = 1; n <= 9; n++) fileNumbers.add(n);
  }
  for (const fnum of explicitLoads) {
    if (fnum > 0) fileNumbers.add(fnum);
  }

  for (const [key, name] of Object.entries(menuEntries)) {
    const fnum = keyToFile[key];
    if (fnum !== undefined) {
      names[fnum] = name;
      fileNumbers.add(fnum);
    }
  }

  const sorted = Array.from(fileNumbers).sort((a, b) => a - b);
  for (const fnum of sorted) {
    if (!names[fnum]) names[fnum] = `File ${fnum}`;
  }

  return { fileNumbers: sorted, names };
}

function readV1Catalog(buffer: Buffer): CatalogResult {
  const firstBlock = buffer.subarray(0, Math.min(BLOCK_SIZE, buffer.length));
  const boot = parseV1BootBasic(firstBlock);
  const fileSize = buffer.length;

  const header: DiskHeader = {
    format: 'oliger-v1',
    formatName: 'Oliger (JLO SAFE V1)',
    diskName: '',
    sides: 0,
    tracks: 0,
    extra: { totalCylinders: Math.floor(fileSize / BLOCK_SIZE), filesDetected: boot.fileNumbers.length },
  };

  const entries: FileEntry[] = [];
  let idx = 0;

  for (const fnum of boot.fileNumbers) {
    const slotOffset = fnum * V1_SLOT_SIZE;
    if (slotOffset + V1_SLOT_SIZE > fileSize) continue;

    const slotData = buffer.subarray(slotOffset, slotOffset + V1_SLOT_SIZE);

    // Skip empty slots
    const firstSectorEmpty = slotData.subarray(0, 512).every((b) => b === 0xe5);
    if (firstSectorEmpty) {
      if (slotOffset + 0x600 < fileSize) {
        const probe = buffer.subarray(slotOffset + 0x600, slotOffset + 0x600 + 512);
        if (probe.every((b) => b === 0xe5)) continue;
      } else {
        continue;
      }
    }

    // Read file data to determine type and size
    const fileData = readV1FileDataInternal(buffer, fnum);
    const name = boot.names[fnum] ?? `File ${fnum}`;

    const ft = fileData ? typeCodeToFileType(fileData.filetype) : 'code';

    entries.push({
      index: idx++,
      filename: name,
      type: ft,
      typeName: fileData ? (FILE_TYPE_NAMES[fileData.filetype] ?? 'Unknown') : 'CODE',
      size: fileData?.filesize ?? 0,
      params: {
        param1: fileData?.staline ?? 0,
        param2: fileData?.param2 ?? 32768,
        autostartLine: ft === 'basic' ? (fileData?.staline ?? 0) : 0,
        varsOffset: ft === 'basic' ? (fileData?.param2 ?? 0) : 0,
        startAddr: ft === 'code' ? (fileData?.staline ?? 0) : 0,
        cylinder: fnum * V1_SLOT_CYLINDERS,
        cylused: V1_SLOT_CYLINDERS,
        v1FileNumber: fnum,
      },
      blocks: Array.from({ length: V1_SLOT_CYLINDERS }, (_, i) => fnum * V1_SLOT_CYLINDERS + i),
      isMemoryDump: false,
      isDirectory: false,
      metadata: {},
    });
  }

  return { header, entries };
}

interface V1RawFile {
  filetype: number;
  filesize: number;
  staline: number;
  param2: number;
  content: Buffer;
}

function readV1FileDataInternal(buffer: Buffer, fnum: number): V1RawFile | null {
  const cyl = fnum * V1_SLOT_CYLINDERS;
  const ncyl = V1_SLOT_CYLINDERS;
  const startOffset = cyl * BLOCK_SIZE;
  if (startOffset + ncyl * BLOCK_SIZE > buffer.length) return null;

  const raw = buffer.subarray(startOffset, startOffset + ncyl * BLOCK_SIZE);

  // Strip trailing e5 fill
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0xe5) end--;
  let dataEnd = end;
  while (dataEnd > 0 && raw[dataEnd - 1] === 0x00) dataEnd--;
  if (dataEnd === 0) dataEnd = end;

  // Find data start (skip e5-filled sectors)
  let dataStart = 0;
  while (dataStart < raw.length && raw[dataStart] === 0xe5) dataStart++;
  dataStart = Math.floor(dataStart / 512) * 512;

  const effective = raw.subarray(dataStart, end);
  if (effective.length === 0) return null;

  // Heuristic BASIC detection
  if (effective.length >= 8) {
    const progLen = readUint16LE(effective, 0);
    const varsOff = readUint16LE(effective, 2);
    const diff = progLen - varsOff;
    if (progLen > 0 && progLen < effective.length &&
        varsOff > 0 && varsOff <= progLen &&
        diff >= 0 && diff < 1000) {
      if (effective.length > 8) {
        const testLine = readUint16BE(effective, 4);
        const testLen = readUint16LE(effective, 6);
        if (testLine > 0 && testLine < 10000 && testLen > 0 && testLen < 500) {
          return {
            filetype: TYPE_BASIC,
            filesize: progLen,
            staline: testLine,
            param2: varsOff,
            content: Buffer.from(effective.subarray(4, 4 + progLen)),
          };
        }
      }
    }
  }

  // Default to CODE
  return {
    filetype: TYPE_CODE,
    filesize: effective.length,
    staline: 0,
    param2: 32768,
    content: Buffer.from(effective),
  };
}

// Public API

export function detect(buffer: Buffer): 'oliger-v1' | 'oliger-v2' | false {
  if (buffer.length < DIR_ENTRY_OFFSET + DIR_ENTRY_SIZE) return false;

  const version = detectVersion(buffer);
  if (version === 'V2') return 'oliger-v2';

  // V1 check: BASIC boot with LOAD /n
  if (buffer.length > 8) {
    const progLen = readUint16LE(buffer, 0);
    if (progLen > 0 && progLen < 2000) {
      const searchArea = buffer.subarray(4, Math.min(4 + progLen, buffer.length));
      if (searchArea.includes(Buffer.from([0xef, 0x2f]))) {
        return 'oliger-v1';
      }
    }
  }

  return false;
}

export function readCatalog(buffer: Buffer): CatalogResult {
  const version = detectVersion(buffer);
  if (version === 'V1') return readV1Catalog(buffer);
  return readV2Catalog(buffer);
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  const v1Num = entry.params.v1FileNumber;
  if (v1Num !== undefined && v1Num > 0) {
    const raw = readV1FileDataInternal(buffer, v1Num);
    return raw?.content ?? null;
  }

  // V2: read cylinder data
  const cylinder = entry.params.cylinder ?? 0;
  const cylused = entry.params.cylused ?? 0;
  if (cylused === 0) return null;

  const content: number[] = [];
  for (let i = 0; i < cylused; i++) {
    const seekPos = (cylinder + i) * BLOCK_SIZE;
    if (seekPos + BLOCK_SIZE > buffer.length) break;
    for (let j = 0; j < BLOCK_SIZE; j++) {
      content.push(buffer[seekPos + j]);
    }
  }

  const filesize = entry.size;
  return Buffer.from(content.slice(0, filesize));
}
