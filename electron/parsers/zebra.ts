import type { CatalogResult, DiskHeader, FileEntry } from './types';

const CPC_DSK_HEADER = Buffer.from('EXTENDED CPC DSK');
const DIRSCP_MARKER = Buffer.from('DIRSCP');
const ROOT_DIR_OFFSET = 0x2880;
const TRACK_SIZE = 0x1100;    // 4352 bytes per track
const TRACK_HEADER_SIZE = 0x100;
const SECTOR_SIZE = 256;

const TRACK_SKEW = [0, 7, 14, 5, 12, 3, 10, 1, 8, 15, 6, 13, 4, 11, 2, 9];

const MARKER_ROOT_DIR = 0xff;
const MARKER_SUB_DIR = 0x80;
const MARKER_FILE = 0x01;
const MARKER_UNUSED = 0xe5;

function isDirscp(data: Buffer): boolean {
  return data.subarray(ROOT_DIR_OFFSET, ROOT_DIR_OFFSET + 6).equals(DIRSCP_MARKER);
}

// DIRSCP parsing

function readDirscpEntries(data: Buffer, offset: number): FileEntry[] {
  const entries: FileEntry[] = [];
  let scanStart = offset;

  if (data.subarray(offset, offset + 6).equals(DIRSCP_MARKER)) {
    scanStart = offset + 0x28;
  }

  let idx = 0;
  for (let i = scanStart; i < Math.min(scanStart + 0x200, data.length - 32); i++) {
    if (i + 32 > data.length) break;
    const entryData = data.subarray(i, i + 32);
    const marker = entryData[0];

    if (![MARKER_ROOT_DIR, MARKER_SUB_DIR, MARKER_FILE].includes(marker)) continue;

    const name = entryData.subarray(1, 9).toString('ascii').trim();
    if (!name || !/^[A-Za-z]/.test(name)) continue;

    const typeBytes = entryData.subarray(9, 12);
    const fileType = typeBytes.toString('ascii').trim();
    const sizeHi = entryData[14];
    const sizeLo = entryData[15];
    const sizeSectors = (sizeHi << 8) | sizeLo;
    const trackList: number[] = [];
    for (let b = 16; b < 32; b++) {
      if (entryData[b] !== 0 && entryData[b] < 160) trackList.push(entryData[b]);
    }

    const isDir = fileType === 'DIR';
    const isHidden = (typeBytes[1] & 0x80) !== 0;
    const isReadonly = (typeBytes[0] & 0x80) !== 0;

    entries.push({
      index: idx++,
      filename: fileType && !isDir ? `${name}.${fileType}` : name,
      type: isDir ? 'dir' : 'data',
      typeName: isDir ? 'DIR' : (fileType || 'DATA'),
      size: sizeSectors * SECTOR_SIZE,
      params: { sizeSectors, tailBytes: entryData[13], partNumber: entryData[12] },
      blocks: trackList,
      isMemoryDump: false,
      isDirectory: isDir,
      metadata: {
        ...(isHidden ? { hidden: 'true' } : {}),
        ...(isReadonly ? { readonly: 'true' } : {}),
      },
    });
  }

  return entries;
}

// CP/M parsing

function readCpmEntries(data: Buffer, offset: number): FileEntry[] {
  const entries: FileEntry[] = [];
  let idx = 0;

  for (let i = offset; i < Math.min(offset + 0x400, data.length - 32); i += 32) {
    const entryData = data.subarray(i, i + 32);
    if (entryData[0] === MARKER_UNUSED) continue;
    if (entryData[0] !== 0x00) continue;

    const nameBytes = entryData.subarray(1, 9);
    if (nameBytes[0] < 0x41 || nameBytes[0] > 0x5a) continue;

    let name: string, ext: string;
    try {
      name = nameBytes.toString('ascii').trim();
      ext = entryData.subarray(9, 12).toString('ascii').trim();
    } catch {
      continue;
    }
    if (!name) continue;

    const recordCount = entryData[15];
    const allocBlocks: number[] = [];
    for (let b = 16; b < 32; b++) {
      if (entryData[b] !== 0 && entryData[b] < 160) allocBlocks.push(entryData[b]);
    }

    entries.push({
      index: idx++,
      filename: ext ? `${name}.${ext}` : name,
      type: 'data',
      typeName: ext || 'DATA',
      size: recordCount * 128,
      params: { extent: entryData[12], recordCount },
      blocks: allocBlocks,
      isMemoryDump: false,
      isDirectory: false,
      metadata: {},
    });
  }

  return entries;
}

// Disk scanning

function scanDisk(data: Buffer): { rootEntries: FileEntry[]; subdirs: Record<string, FileEntry[]>; dirscp: boolean } {
  const dirscp = isDirscp(data);
  let rootEntries: FileEntry[];

  if (dirscp) {
    rootEntries = readDirscpEntries(data, ROOT_DIR_OFFSET);
  } else {
    rootEntries = readCpmEntries(data, ROOT_DIR_OFFSET);
    if (!rootEntries.length) {
      rootEntries = readCpmEntries(data, 0x2880);
    }
  }

  const subdirs: Record<string, FileEntry[]> = {};

  if (dirscp) {
    const dirNames = rootEntries.filter((e) => e.isDirectory).map((e) => e.filename);
    for (let offset = 0x3000; offset < data.length - 0x200; offset += 0x100) {
      const check = data.subarray(offset, offset + 32);
      if (check[0] !== MARKER_ROOT_DIR && check[0] !== MARKER_SUB_DIR) continue;
      const dirName = check.subarray(1, 9).toString('ascii').trim();
      if (dirNames.includes(dirName) && !subdirs[dirName]) {
        const subEntries = readDirscpEntries(data, offset);
        subdirs[dirName] = subEntries.filter((e) => !e.isDirectory || e.filename !== dirName);
      }
    }
  }

  return { rootEntries, subdirs, dirscp };
}

// File extraction

function extractFileData(data: Buffer, tracks: number[]): Buffer {
  const fileData: number[] = [];

  for (const trackNum of tracks) {
    const trackStart = 0x100 + trackNum * TRACK_SIZE + TRACK_HEADER_SIZE;
    for (let sectorIdx = 0; sectorIdx < 16; sectorIdx++) {
      const skewed = TRACK_SKEW[sectorIdx];
      const sectorOffset = trackStart + skewed * SECTOR_SIZE;
      if (sectorOffset + SECTOR_SIZE <= data.length) {
        for (let j = 0; j < SECTOR_SIZE; j++) fileData.push(data[sectorOffset + j]);
      }
    }
  }

  // If data is all zeros, retry without skew
  if (fileData.length > 0 && fileData.slice(0, 100).every((b) => b === 0)) {
    const retry: number[] = [];
    for (const trackNum of tracks) {
      const trackOffset = 0x100 + trackNum * TRACK_SIZE + TRACK_HEADER_SIZE;
      for (let j = 0; j < TRACK_SIZE - TRACK_HEADER_SIZE && trackOffset + j < data.length; j++) {
        retry.push(data[trackOffset + j]);
      }
    }
    return trimPadding(Buffer.from(retry));
  }

  return trimPadding(Buffer.from(fileData));
}

function trimPadding(data: Buffer): Buffer {
  let end = data.length;
  for (let i = data.length - 1; i >= 0; i--) {
    if (![0x00, 0xff, 0xe5, 0x1a].includes(data[i])) {
      end = i + 1;
      break;
    }
    if (data.length - i > 100) {
      end = i;
      break;
    }
  }
  return data.subarray(0, end);
}

// Public API

export function detect(buffer: Buffer): 'zebra-dirscp' | 'zebra-cpm' | false {
  if (buffer.length < ROOT_DIR_OFFSET + 6) return false;
  if (!buffer.subarray(0, 16).equals(CPC_DSK_HEADER)) return false;
  if (isDirscp(buffer)) return 'zebra-dirscp';
  return 'zebra-cpm';
}

export function readCatalog(buffer: Buffer): CatalogResult {
  const { rootEntries, subdirs, dirscp } = scanDisk(buffer);

  const diskInfo = buffer.subarray(0x22, 0x30).toString('ascii').trim();
  const numTracks = buffer.length > 0x30 ? buffer[0x30] : 0;
  const numSides = buffer.length > 0x31 ? buffer[0x31] : 0;

  const header: DiskHeader = {
    format: dirscp ? 'zebra-dirscp' : 'zebra-cpm',
    formatName: `CPC DSK (${dirscp ? 'DIRSCP' : 'CP/M'})`,
    diskName: diskInfo,
    sides: numSides,
    tracks: numTracks,
    extra: {},
  };

  // Flatten entries with children for directories
  const allEntries: FileEntry[] = [];
  let globalIdx = 0;

  for (const entry of rootEntries) {
    if (entry.isDirectory) {
      const sub = subdirs[entry.filename] ?? [];
      const children: FileEntry[] = sub.map((s) => ({
        ...s,
        index: globalIdx++,
        metadata: { ...s.metadata, parentDir: entry.filename },
      }));
      allEntries.push({ ...entry, index: globalIdx++, children });
    } else {
      allEntries.push({ ...entry, index: globalIdx++ });
    }
  }

  return { header, entries: allEntries };
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  if (entry.isDirectory) return null;
  if (!entry.blocks.length) return null;
  const data = extractFileData(buffer, entry.blocks);
  return data.length > 0 ? data : null;
}
