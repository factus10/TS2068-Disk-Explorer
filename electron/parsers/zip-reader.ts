/**
 * ZIP container reader. Opens a ZIP archive, parses each recognized
 * disk/tape image inside, and returns a unified catalog. The inner
 * file's compressed data is cached so readFileData can delegate to
 * the original parser without hitting disk again.
 */

import * as zlib from 'zlib';
import { detectFormat } from './detect';
import type { CatalogResult, DiskHeader, FileEntry, DiskFormat } from './types';

// Lazy-loaded parsers to avoid circular imports
let parsers: Record<string, { readCatalog: (buf: Buffer) => CatalogResult; readFileData: (buf: Buffer, entry: FileEntry) => Buffer | null }> | null = null;

function getParsers() {
  if (!parsers) {
    const larken = require('./larken');
    const oliger = require('./oliger');
    const aerco = require('./aerco');
    const zebra = require('./zebra');
    const ql = require('./ql');
    const tap = require('./tap-reader');
    const tzx = require('./tzx-reader');
    const sna = require('./sna-reader');
    const z80 = require('./z80-reader');
    const scr = require('./scr-reader');
    const mgt = require('./mgt-reader');
    parsers = {
      larken, 'oliger-v1': oliger, 'oliger-v2': oliger,
      'aerco-dos64': aerco, 'aerco-rpm': aerco,
      'zebra-dirscp': zebra, 'zebra-cpm': zebra,
      ql, tap, tzx, sna, z80, scr, mgt,
    };
  }
  return parsers;
}

// ---- Minimal ZIP reader using Node built-in zlib ----

interface ZipEntry {
  name: string;
  data: Buffer;
}

function readZipEntries(zipData: Buffer): ZipEntry[] {
  const files: ZipEntry[] = [];
  let offset = 0;

  while (offset + 30 <= zipData.length) {
    const sig = zipData.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compression = zipData.readUInt16LE(offset + 8);
    const compSize = zipData.readUInt32LE(offset + 18);
    const uncompSize = zipData.readUInt32LE(offset + 22);
    const nameLen = zipData.readUInt16LE(offset + 26);
    const extraLen = zipData.readUInt16LE(offset + 28);
    const name = zipData.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;

    if (compSize > 0 || uncompSize > 0) {
      const raw = zipData.subarray(dataStart, dataStart + compSize);
      let data: Buffer;
      if (compression === 8) {
        data = zlib.inflateRawSync(raw);
      } else if (compression === 0) {
        data = Buffer.from(raw);
      } else {
        offset = dataStart + compSize;
        continue;
      }
      files.push({ name, data });
    }

    offset = dataStart + compSize;
  }

  return files;
}

// ---- Cached inner-file data for readFileData ----

// Map from ZIP buffer identity → map from unified entry index → { innerBuffer, innerFormat, innerEntry }
const zipCache = new WeakMap<Buffer, Map<number, { buffer: Buffer; format: DiskFormat; entry: FileEntry }>>();

function getOrBuildCache(
  zipData: Buffer,
): { catalog: CatalogResult; cache: Map<number, { buffer: Buffer; format: DiskFormat; entry: FileEntry }> } {
  const existing = zipCache.get(zipData);
  if (existing) {
    // Rebuild catalog (cheap) but reuse cache
    return { catalog: buildCatalog(zipData), cache: existing };
  }

  const cache = new Map<number, { buffer: Buffer; format: DiskFormat; entry: FileEntry }>();
  const catalog = buildCatalog(zipData, cache);
  zipCache.set(zipData, cache);
  return { catalog, cache };
}

function buildCatalog(
  zipData: Buffer,
  cache?: Map<number, { buffer: Buffer; format: DiskFormat; entry: FileEntry }>,
): CatalogResult {
  const zipEntries = readZipEntries(zipData);
  const allParsers = getParsers();

  const combinedEntries: FileEntry[] = [];
  let globalIdx = 0;
  const innerFileNames: string[] = [];

  for (const ze of zipEntries) {
    const format = detectFormat(ze.data, ze.name);
    if (!format) continue;

    const parser = allParsers[format];
    if (!parser) continue;

    try {
      const { entries } = parser.readCatalog(ze.data);
      // Flatten children
      const flat: FileEntry[] = [];
      for (const e of entries) {
        flat.push(e);
        if (e.children) flat.push(...e.children);
      }

      for (const innerEntry of flat) {
        const unified: FileEntry = {
          ...innerEntry,
          index: globalIdx,
          // Prefix filename with inner ZIP entry name if there are multiple inner files
          metadata: {
            ...innerEntry.metadata,
            zipSource: ze.name,
          },
        };
        combinedEntries.push(unified);

        if (cache) {
          cache.set(globalIdx, { buffer: ze.data, format, entry: innerEntry });
        }
        globalIdx++;
      }
      innerFileNames.push(ze.name);
    } catch {
      // Skip unparseable inner files
    }
  }

  const header: DiskHeader = {
    format: 'zip',
    formatName: 'ZIP Archive',
    diskName: innerFileNames.length === 1 ? innerFileNames[0] : `${innerFileNames.length} files`,
    sides: 0,
    tracks: 0,
    extra: { innerFiles: innerFileNames.length, totalEntries: combinedEntries.length },
  };

  return { header, entries: combinedEntries };
}

// ---- Public API (same shape as other parsers) ----

export function detect(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B &&
    buffer[2] === 0x03 && buffer[3] === 0x04;
}

export function readCatalog(buffer: Buffer): CatalogResult {
  const { catalog } = getOrBuildCache(buffer);
  return catalog;
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  const { cache } = getOrBuildCache(buffer);
  const mapping = cache.get(entry.index);
  if (!mapping) return null;

  const allParsers = getParsers();
  const parser = allParsers[mapping.format];
  if (!parser) return null;

  return parser.readFileData(mapping.buffer, mapping.entry);
}
