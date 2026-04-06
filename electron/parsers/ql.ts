import { readUint16BE, readUint32BE } from './utils';
import type { CatalogResult, DiskHeader, FileEntry, FileType } from './types';

const QL5A_MAGIC = Buffer.from('QL5A');
const QL5B_MAGIC = Buffer.from('QL5B');
const LOGICAL_SECTOR_SIZE = 256;
const SECTORS_PER_GROUP = 6;
const GROUP_SIZE = LOGICAL_SECTOR_SIZE * SECTORS_PER_GROUP; // 1536
const SECTORS_PER_CYLINDER = 18;
const CYLINDER_SIZE = SECTORS_PER_CYLINDER * LOGICAL_SECTOR_SIZE; // 4608
const SIDE_SIZE = 9 * LOGICAL_SECTOR_SIZE; // 2304

const DIR_ENTRY_SIZE = 64;
const DIR_HEADER_SIZE = 64;

const TYPE_DATA = 0;
const TYPE_EXEC = 1;
const TYPE_REL = 2;

const FILE_TYPE_NAMES: Record<number, string> = {
  0: 'DATA', 1: 'EXEC', 2: 'REL', 255: 'DIR',
};

// QDOS epoch: 1961-01-01
const QDOS_EPOCH = new Date(Date.UTC(1961, 0, 1));

function typeCodeToFileType(code: number): FileType {
  switch (code) {
    case 0: return 'data';
    case 1: return 'exec';
    case 2: return 'rel';
    case 255: return 'dir';
    default: return 'unknown';
  }
}

function qdosDateToString(rawDate: number): string {
  if (rawDate === 0) return '(no date)';
  try {
    const ms = QDOS_EPOCH.getTime() + rawDate * 1000;
    const dt = new Date(ms);
    return dt.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  } catch {
    return `(invalid: 0x${rawDate.toString(16).padStart(8, '0')})`;
  }
}

interface QLHeader {
  format: string;
  label: string;
  randomId: number;
  updateCount: number;
  freeSectors: number;
  goodSectors: number;
  totalSectors: number;
  sectorsPerTrack: number;
  sectorsPerCylinder: number;
  tracks: number;
  sectorsPerGroup: number;
  dirEntries: number;
  interleave: number[];
  numGroups: number;
}

function readDiskHeader(data: Buffer): QLHeader {
  if (data.length < 96) throw new Error('Image too small for QL format');

  const magic = data.subarray(0, 4);
  if (!magic.equals(QL5A_MAGIC) && !magic.equals(QL5B_MAGIC)) {
    throw new Error(`Not a QL disk image (magic: ${magic.toString('ascii')})`);
  }

  const interleave: number[] = [];
  for (let i = 0x28; i < 0x3a; i++) {
    interleave.push(data[i]);
  }

  return {
    format: magic.toString('ascii'),
    label: data.subarray(4, 14).toString('ascii').trim(),
    randomId: readUint16BE(data, 14),
    updateCount: readUint16BE(data, 16),
    freeSectors: readUint16BE(data, 18),
    goodSectors: readUint16BE(data, 20),
    totalSectors: readUint16BE(data, 22),
    sectorsPerTrack: readUint16BE(data, 26),
    sectorsPerCylinder: readUint16BE(data, 28),
    tracks: readUint16BE(data, 30),
    sectorsPerGroup: readUint16BE(data, 32),
    dirEntries: readUint16BE(data, 36),
    interleave,
    numGroups: Math.floor(data.length / GROUP_SIZE),
  };
}

function logicalToImageOffset(logicalSector: number, interleave: number[]): number {
  const cylinder = Math.floor(logicalSector / SECTORS_PER_CYLINDER);
  const posInCyl = logicalSector % SECTORS_PER_CYLINDER;
  const phys = interleave[posInCyl];
  const side = phys >= 0x80 ? 1 : 0;
  const sector = phys & 0x7f;
  return cylinder * CYLINDER_SIZE + side * SIDE_SIZE + sector * LOGICAL_SECTOR_SIZE;
}

function readGroupData(data: Buffer, groupNum: number, interleave: number[]): Buffer {
  const result: number[] = [];
  const baseSector = groupNum * SECTORS_PER_GROUP;

  for (let i = 0; i < SECTORS_PER_GROUP; i++) {
    const ls = baseSector + i;
    const offset = logicalToImageOffset(ls, interleave);
    if (offset + LOGICAL_SECTOR_SIZE <= data.length) {
      for (let j = 0; j < LOGICAL_SECTOR_SIZE; j++) result.push(data[offset + j]);
    } else {
      for (let j = 0; j < LOGICAL_SECTOR_SIZE; j++) result.push(0);
    }
  }

  return Buffer.from(result);
}

function parseAllocationMap(data: Buffer, header: QLHeader): Record<number, Array<[number, number]>> {
  const mapStart = 0x60;
  const numEntries = header.numGroups;
  const files: Record<number, Array<[number, number]>> = {};

  for (let g = 0; g < numEntries; g++) {
    const offset = mapStart + g * 3;
    if (offset + 3 > data.length) break;

    const b0 = data[offset];
    const b1 = data[offset + 1];
    const b2 = data[offset + 2];

    // Skip special markers
    if (b0 >= 0xf0) continue;
    // Skip free-fill
    if (b0 === b1 && b1 === b2 && b0 !== 0x00) continue;

    const fileNum = (b0 << 4) | (b1 >> 4);
    const blockSeq = ((b1 & 0x0f) << 8) | b2;

    if (!files[fileNum]) files[fileNum] = [];
    files[fileNum].push([g, blockSeq]);
  }

  return files;
}

export function detect(buffer: Buffer): boolean {
  if (buffer.length < 96) return false;
  const magic = buffer.subarray(0, 4);
  return magic.equals(QL5A_MAGIC) || magic.equals(QL5B_MAGIC);
}

export function readCatalog(buffer: Buffer): CatalogResult {
  const qlHeader = readDiskHeader(buffer);

  // Read group 0 data (de-interleaved) for allocation map
  const group0Data = readGroupData(buffer, 0, qlHeader.interleave);
  const fileMap = parseAllocationMap(group0Data, qlHeader);

  const header: DiskHeader = {
    format: 'ql',
    formatName: `${qlHeader.format} (Sinclair QL)`,
    diskName: qlHeader.label,
    sides: 2,
    tracks: qlHeader.tracks,
    extra: {
      sectorsPerTrack: qlHeader.sectorsPerTrack,
      totalSectors: qlHeader.totalSectors,
      freeSectors: qlHeader.freeSectors,
      dirEntries: qlHeader.dirEntries,
    },
  };

  // Read directory entries from group 3+
  const maxEntries = qlHeader.dirEntries;
  const dirBytesNeeded = DIR_HEADER_SIZE + maxEntries * DIR_ENTRY_SIZE;
  const dirGroupsNeeded = Math.ceil(dirBytesNeeded / GROUP_SIZE);
  const dirStartGroup = 3;

  const dirParts: Buffer[] = [];
  for (let g = dirStartGroup; g < dirStartGroup + dirGroupsNeeded; g++) {
    if (g >= qlHeader.numGroups) break;
    dirParts.push(readGroupData(buffer, g, qlHeader.interleave));
  }
  const dirData = Buffer.concat(dirParts);

  const entries: FileEntry[] = [];
  let idx = 0;

  for (let i = 0; i < maxEntries; i++) {
    const offset = DIR_HEADER_SIZE + i * DIR_ENTRY_SIZE;
    if (offset + DIR_ENTRY_SIZE > dirData.length) break;

    const entry = dirData.subarray(offset, offset + DIR_ENTRY_SIZE);

    const flLength = readUint32BE(entry, 0);
    const flType = entry[5];
    const flData = readUint32BE(entry, 6);
    const flNlen = readUint16BE(entry, 14);

    if (flNlen === 0 || flNlen > 36 || flType > 2) continue;

    const flName = entry.subarray(16, 16 + flNlen).toString('ascii');
    const flDate = readUint32BE(entry, 52);
    const flVer = readUint16BE(entry, 56);
    const flFileno = readUint16BE(entry, 58);
    const mapId = flFileno - 1;

    const ft = typeCodeToFileType(flType);

    entries.push({
      index: idx++,
      filename: flName,
      type: ft,
      typeName: FILE_TYPE_NAMES[flType] ?? `Unknown (${flType})`,
      size: flLength,
      params: {
        dataSpace: flData,
        version: flVer,
        fileno: flFileno,
        mapId,
      },
      blocks: (fileMap[mapId] ?? []).map(([g]) => g),
      isMemoryDump: false,
      isDirectory: false,
      metadata: {
        date: qdosDateToString(flDate),
        ...(ft === 'exec' ? { dataSpace: String(flData) } : {}),
      },
    });
  }

  // Store header and fileMap for extraction
  (buffer as any).__qlHeader = qlHeader;
  (buffer as any).__qlFileMap = fileMap;

  return { header, entries };
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  // Retrieve stored header/map
  const qlHeader: QLHeader = (buffer as any).__qlHeader;
  const fileMap: Record<number, Array<[number, number]>> = (buffer as any).__qlFileMap;

  if (!qlHeader || !fileMap) {
    // Re-parse if needed
    const h = readDiskHeader(buffer);
    const g0 = readGroupData(buffer, 0, h.interleave);
    const fm = parseAllocationMap(g0, h);
    return extractFileContent(buffer, h, fm, entry);
  }

  return extractFileContent(buffer, qlHeader, fileMap, entry);
}

function extractFileContent(
  buffer: Buffer,
  qlHeader: QLHeader,
  fileMap: Record<number, Array<[number, number]>>,
  entry: FileEntry,
): Buffer | null {
  const mapId = entry.params.mapId ?? 0;
  const groups = fileMap[mapId];
  if (!groups) return null;

  const sorted = [...groups].sort((a, b) => a[1] - b[1]);
  const fileLength = entry.size;

  const parts: Buffer[] = [];
  for (const [groupNum] of sorted) {
    parts.push(readGroupData(buffer, groupNum, qlHeader.interleave));
  }

  const full = Buffer.concat(parts);
  return full.subarray(0, Math.min(fileLength, full.length));
}
