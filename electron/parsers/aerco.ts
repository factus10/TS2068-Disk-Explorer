import { readUint16LE } from './utils';
import type { CatalogResult, DiskHeader, FileEntry, FileType } from './types';

const SECTOR_SIZE = 512;
const SECTORS_PER_TRACK = 10;
const TRACK_SIZE = SECTOR_SIZE * SECTORS_PER_TRACK; // 5120

const DIR_START = 0x200;
const DIR_ENTRY_SIZE = 32;

const TYPE_BASIC = 0x00;
const TYPE_CODE = 0x03;
const TYPE_MODULE = 0x04;
const TYPE_DATA = 0x08;
const TYPE_BITMAP = 0xff;

const FILE_TYPE_NAMES: Record<number, string> = {
  0x00: 'BASIC', 0x01: 'Num array', 0x02: 'Str array',
  0x03: 'CODE', 0x04: 'MODULE', 0x08: 'DATA', 0xff: 'BITMAP',
};

const FILE_HEADER_SIZE = 17;

// RP/M constants
const RPM_SYSTEM_TRACKS = 4;
const RPM_BLS = 2048;
const RPM_DIR_TRACK = 4;
const RPM_RECORD_SIZE = 128;

function typeCodeToFileType(code: number): FileType {
  switch (code) {
    case 0x00: return 'basic';
    case 0x03: return 'code';
    case 0x04: return 'module';
    case 0x08: return 'data';
    default: return 'unknown';
  }
}

function blockToOffset(blockNum: number, numTracks: number): number {
  if (blockNum < 0x80) {
    return blockNum * TRACK_SIZE;
  }
  const half = Math.floor(numTracks / 2);
  return (half + (blockNum - 0x80)) * TRACK_SIZE;
}

function detectSubFormat(data: Buffer): 'DOS64' | 'RPM' | null {
  if (data.length < TRACK_SIZE) return null;
  if (data[0] !== 0x18) return null;

  const name = data.subarray(6, 16).toString('ascii').replace(/\0/g, '').trim();
  if (name.includes('RP/M') || name.includes('RPM')) return 'RPM';
  if (data[16] === 0xc3 && data[17] === 0x39 && data[18] === 0x35) return 'DOS64';
  if (data[DIR_START] === TYPE_BITMAP) return 'DOS64';
  return null;
}

export function detect(buffer: Buffer): 'aerco-dos64' | 'aerco-rpm' | false {
  const fmt = detectSubFormat(buffer);
  if (fmt === 'DOS64') return 'aerco-dos64';
  if (fmt === 'RPM') return 'aerco-rpm';
  return false;
}

// DOS-64

function readDos64Catalog(data: Buffer): CatalogResult {
  const diskName = data.subarray(6, 16).toString('ascii').replace(/\0/g, '').trim();
  const numTracks = Math.floor(data.length / TRACK_SIZE);
  const sides = numTracks > 40 ? 2 : 1;

  const header: DiskHeader = {
    format: 'aerco-dos64',
    formatName: 'Aerco FD (DOS-64)',
    diskName,
    sides,
    tracks: Math.floor(numTracks / sides),
    extra: { numTracks },
  };

  const entries: FileEntry[] = [];
  let offset = DIR_START;
  let idx = 0;

  while (offset + DIR_ENTRY_SIZE <= TRACK_SIZE) {
    const entry = data.subarray(offset, offset + DIR_ENTRY_SIZE);

    if (entry.every((b) => b === 0x00 || b === 0xe5)) {
      offset += DIR_ENTRY_SIZE;
      continue;
    }

    const etype = entry[0];
    if (etype === TYPE_BITMAP) {
      offset += DIR_ENTRY_SIZE;
      continue;
    }

    let nameEnd = 1;
    while (nameEnd < 11 && entry[nameEnd] !== 0) nameEnd++;
    const name = entry.subarray(1, nameEnd).toString('ascii');
    if (!name) {
      offset += DIR_ENTRY_SIZE;
      continue;
    }

    const flen = readUint16LE(entry, 11);
    const param1 = readUint16LE(entry, 13);
    const param2 = readUint16LE(entry, 15);
    const blocks: number[] = [];
    for (let b = 17; b < 32; b++) {
      if (entry[b] !== 0) blocks.push(entry[b]);
    }

    const ft = typeCodeToFileType(etype);

    entries.push({
      index: idx++,
      filename: name,
      type: ft,
      typeName: FILE_TYPE_NAMES[etype] ?? `Type 0x${etype.toString(16)}`,
      size: flen,
      params: {
        param1,
        param2,
        autostartLine: ft === 'basic' ? param1 : 0,
        startAddr: ft === 'code' ? param1 : 0,
        varsOffset: ft === 'basic' ? param2 : 0,
        rawType: etype,
      },
      blocks,
      isMemoryDump: false,
      isDirectory: false,
      metadata: {},
    });

    offset += DIR_ENTRY_SIZE;
  }

  return { header, entries };
}

function readDos64FileData(data: Buffer, entry: FileEntry): Buffer | null {
  const numTracks = Math.floor(data.length / TRACK_SIZE);
  const blocks = entry.blocks;
  const etype = entry.params.rawType ?? 0;
  const flen = entry.size;

  if (!blocks.length) return null;

  const content: number[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const offset = blockToOffset(blocks[i], numTracks);
    if (offset + TRACK_SIZE > data.length) break;

    const trackData = data.subarray(offset, offset + TRACK_SIZE);

    if (i === 0 && [TYPE_BASIC, TYPE_CODE, TYPE_DATA].includes(etype)) {
      for (let j = FILE_HEADER_SIZE; j < TRACK_SIZE; j++) content.push(trackData[j]);
    } else {
      for (let j = 0; j < TRACK_SIZE; j++) content.push(trackData[j]);
    }
  }

  if ([TYPE_BASIC, TYPE_CODE, TYPE_DATA].includes(etype) && flen > 0) {
    return Buffer.from(content.slice(0, flen));
  }

  return Buffer.from(content);
}

// RP/M (CP/M)

function readRpmCatalog(data: Buffer): CatalogResult {
  const diskName = data.subarray(6, 16).toString('ascii').replace(/\0/g, '').trim();
  const numTracks = Math.floor(data.length / TRACK_SIZE);

  const header: DiskHeader = {
    format: 'aerco-rpm',
    formatName: 'Aerco FD (RP/M)',
    diskName,
    sides: numTracks > 40 ? 2 : 1,
    tracks: numTracks,
    extra: {},
  };

  const dirOffset = RPM_DIR_TRACK * TRACK_SIZE;
  const entries: FileEntry[] = [];
  const seen: Record<string, FileEntry> = {};
  let idx = 0;

  for (let j = 0; j < TRACK_SIZE; j += 32) {
    const entry = data.subarray(dirOffset + j, dirOffset + j + 32);
    if (entry.length < 32) break;

    const user = entry[0];
    if (user === 0xe5 || user > 0x0f) continue;

    const name = Buffer.from(entry.subarray(1, 9).map((b) => b & 0x7f)).toString('ascii').trim();
    const ext = Buffer.from(entry.subarray(9, 12).map((b) => b & 0x7f)).toString('ascii').trim();
    if (!name) continue;

    const recCount = entry[15];
    const blocks: number[] = [];
    for (let b = 16; b < 32; b++) {
      if (entry[b] !== 0) blocks.push(entry[b]);
    }

    const key = `${user}-${name}-${ext}`;
    const filename = ext ? `${name}.${ext}` : name;

    if (seen[key]) {
      seen[key].blocks.push(...blocks);
      seen[key].params.records = (seen[key].params.records ?? 0) + recCount;
      seen[key].params.extents = (seen[key].params.extents ?? 1) + 1;
      seen[key].size = (seen[key].params.records ?? 0) * RPM_RECORD_SIZE;
    } else {
      const fe: FileEntry = {
        index: idx++,
        filename,
        type: 'data',
        typeName: 'DATA',
        size: recCount * RPM_RECORD_SIZE,
        params: { records: recCount, extents: 1, user },
        blocks,
        isMemoryDump: false,
        isDirectory: false,
        metadata: { ext },
      };
      seen[key] = fe;
      entries.push(fe);
    }
  }

  return { header, entries };
}

function readRpmFileData(data: Buffer, entry: FileEntry): Buffer | null {
  const blocks = entry.blocks;
  const records = entry.params.records ?? 0;
  const fileSize = records * RPM_RECORD_SIZE;
  const baseOffset = RPM_SYSTEM_TRACKS * TRACK_SIZE;

  const content: number[] = [];
  for (const block of blocks) {
    const offset = baseOffset + block * RPM_BLS;
    if (offset + RPM_BLS <= data.length) {
      for (let i = 0; i < RPM_BLS; i++) content.push(data[offset + i]);
    }
  }

  let result = content.slice(0, fileSize);

  // Strip trailing CP/M EOF for text files
  const ext = (entry.metadata.ext ?? '').toUpperCase();
  if (['DOC', 'TXT', 'ASM', 'BAS', 'SUB'].includes(ext)) {
    const eofPos = result.indexOf(0x1a);
    if (eofPos >= 0) result = result.slice(0, eofPos);
  }

  return result.length ? Buffer.from(result) : null;
}

// Public API

export function readCatalog(buffer: Buffer): CatalogResult {
  const fmt = detectSubFormat(buffer);
  if (fmt === 'RPM') return readRpmCatalog(buffer);
  return readDos64Catalog(buffer);
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  if (entry.params.records !== undefined) {
    return readRpmFileData(buffer, entry);
  }
  return readDos64FileData(buffer, entry);
}
