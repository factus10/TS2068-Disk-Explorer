/**
 * MGT/+D (DISCiPLE/+D) disk image reader.
 * Raw disk: 80 tracks × 2 sides × 10 sectors × 512 bytes = 819200 bytes.
 * Directory in first 4 tracks of side 0 (sectors 1-10, tracks 0-3).
 * Each directory entry is 256 bytes (2 per sector).
 */

import { readUint16LE } from './utils';
import type { CatalogResult, DiskHeader, FileEntry, FileType } from './types';

const SECTOR_SIZE = 512;
const SECTORS_PER_TRACK = 10;
const TRACK_SIZE = SECTOR_SIZE * SECTORS_PER_TRACK;
const MGT_DISK_SIZE = 819200; // 80 tracks × 2 sides × 10 sectors × 512 bytes
const DIR_ENTRY_SIZE = 256;
const DIR_TRACKS = 4; // First 4 tracks hold directory
const DIR_ENTRIES = DIR_TRACKS * SECTORS_PER_TRACK * 2; // 80 entries max

// MGT file types
const MGT_TYPES: Record<number, { type: FileType; name: string }> = {
  1: { type: 'basic', name: 'BASIC' },
  2: { type: 'num-array', name: 'Numeric array' },
  3: { type: 'str-array', name: 'String array' },
  4: { type: 'code', name: 'CODE' },
  5: { type: 'state', name: '48K Snapshot' },
  7: { type: 'code', name: 'SCREEN$' },
  9: { type: 'data', name: 'OPENTYPE' },
  10: { type: 'code', name: 'EXECUTE' },
  13: { type: 'code', name: 'UNIDOS' },
};

function getSectorOffset(track: number, sector: number): number {
  // Tracks 0-79 = side 0, tracks 128-207 = side 1
  let physTrack: number;
  let side: number;
  if (track < 128) {
    physTrack = track;
    side = 0;
  } else {
    physTrack = track - 128;
    side = 1;
  }
  return (physTrack * 2 + side) * TRACK_SIZE + (sector - 1) * SECTOR_SIZE;
}

export function detect(buffer: Buffer): boolean {
  if (buffer.length !== MGT_DISK_SIZE) return false;
  // Check for valid directory entries in the first sector
  let validEntries = 0;
  for (let i = 0; i < 2; i++) {
    const status = buffer[i * DIR_ENTRY_SIZE];
    if (status >= 1 && status <= 13) validEntries++;
    if (status === 0) validEntries++; // unused entry
  }
  return validEntries >= 1;
}

export function readCatalog(buffer: Buffer): CatalogResult {
  const header: DiskHeader = {
    format: 'mgt',
    formatName: 'MGT +D/DISCiPLE',
    diskName: '',
    sides: 2,
    tracks: 80,
    extra: { sectors: SECTORS_PER_TRACK },
  };

  const entries: FileEntry[] = [];
  let idx = 0;

  // Read directory entries from first 4 tracks
  for (let dirIdx = 0; dirIdx < DIR_ENTRIES; dirIdx++) {
    const track = Math.floor(dirIdx / (SECTORS_PER_TRACK * 2));
    const sectorIdx = Math.floor((dirIdx % (SECTORS_PER_TRACK * 2)) / 2);
    const entryInSector = dirIdx % 2;

    const sectorOffset = getSectorOffset(track, sectorIdx + 1);
    const entryOffset = sectorOffset + entryInSector * DIR_ENTRY_SIZE;

    if (entryOffset + DIR_ENTRY_SIZE > buffer.length) break;

    const status = buffer[entryOffset];
    if (status === 0) continue; // Unused/deleted entry
    if (status > 13) continue; // Invalid

    const typeInfo = MGT_TYPES[status] ?? { type: 'unknown' as FileType, name: `Type ${status}` };
    const filename = buffer.subarray(entryOffset + 1, entryOffset + 11).toString('ascii').trim();
    const sectorsUsed = readUint16LE(buffer, entryOffset + 11);

    // Sector allocation map starts at offset 15
    // Each entry: track (1 byte) + sector (1 byte)
    const blocks: number[] = [];
    const sectorList: { track: number; sector: number }[] = [];
    for (let s = 0; s < sectorsUsed && s < 195; s++) {
      const mapOffset = entryOffset + 15 + s * 2;
      if (mapOffset + 2 > buffer.length) break;
      const t = buffer[mapOffset];
      const sec = buffer[mapOffset + 1];
      if (t === 0 && sec === 0) break;
      sectorList.push({ track: t, sector: sec });
      blocks.push(t * 10 + sec);
    }

    // File header info (type-specific, at offset 211-219)
    let param1 = 0;
    let param2 = 0;
    let fileSize = sectorsUsed * SECTOR_SIZE;

    if (entryOffset + 219 <= buffer.length) {
      // For BASIC: offset 212-213 = program length, 214-215 = autostart
      // For CODE: offset 212-213 = load address, 214-215 = length
      param1 = readUint16LE(buffer, entryOffset + 214);
      param2 = readUint16LE(buffer, entryOffset + 212);
      const declaredSize = readUint16LE(buffer, entryOffset + 212);
      if (declaredSize > 0 && declaredSize < fileSize) fileSize = declaredSize;
    }

    const isScreen = status === 7 || (status === 4 && fileSize === 6912);

    entries.push({
      index: idx++,
      filename: filename.padEnd(10, ' '),
      type: typeInfo.type,
      typeName: isScreen ? 'SCREEN$' : typeInfo.name,
      size: fileSize,
      params: {
        startAddr: typeInfo.type === 'code' ? param1 : 0,
        autostartLine: typeInfo.type === 'basic' ? param1 : 0,
        varsOffset: typeInfo.type === 'basic' ? param2 : 0,
        param1, param2,
        mgtStatus: status,
      },
      blocks,
      isMemoryDump: status === 5,
      isDirectory: false,
      metadata: {},
      _mgtSectors: sectorList,
    } as FileEntry & { _mgtSectors: { track: number; sector: number }[] });
  }

  return { header, entries };
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  const sectorList = (entry as any)._mgtSectors as { track: number; sector: number }[] | undefined;
  if (!sectorList || sectorList.length === 0) return null;

  const chunks: Buffer[] = [];
  let remaining = entry.size;

  for (const { track, sector } of sectorList) {
    if (remaining <= 0) break;
    const offset = getSectorOffset(track, sector);
    if (offset + SECTOR_SIZE > buffer.length) break;

    // First sector of a file has a 9-byte +D header; skip it for the first sector
    // Actually, the +D stores the file header in the directory, not the sector
    // Data starts at the beginning of each sector
    const chunkSize = Math.min(SECTOR_SIZE, remaining);
    chunks.push(Buffer.from(buffer.subarray(offset, offset + chunkSize)));
    remaining -= chunkSize;
  }

  if (chunks.length === 0) return null;
  return Buffer.concat(chunks);
}
