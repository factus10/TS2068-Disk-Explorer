/**
 * Opening an image with the right parser, and hashing the programs inside it.
 *
 * The hashing here is the definition of program identity used across the
 * catalogue, so every script that computes one must come through this
 * function or the keys will not line up.
 */

import * as crypto from 'crypto';
import { detectFormat } from './parsers/detect';
import { readCatalog as readLarken, readFileData as readLarkenFile } from './parsers/larken';
import { readCatalog as readOliger, readFileData as readOligerFile } from './parsers/oliger';
import { readCatalog as readAerco, readFileData as readAercoFile } from './parsers/aerco';
import { readCatalog as readZebra, readFileData as readZebraFile } from './parsers/zebra';
import { readCatalog as readQL, readFileData as readQLFile } from './parsers/ql';
import { readCatalog as readTap, readFileData as readTapFile } from './parsers/tap-reader';
import { readCatalog as readTzx, readFileData as readTzxFile } from './parsers/tzx-reader';
import { readCatalog as readSNA, readFileData as readSNAFile } from './parsers/sna-reader';
import { readCatalog as readZ80, readFileData as readZ80File } from './parsers/z80-reader';
import { readCatalog as readSCR, readFileData as readSCRFile } from './parsers/scr-reader';
import { readCatalog as readMGT, readFileData as readMGTFile } from './parsers/mgt-reader';
import { readCatalog as readZIP, readFileData as readZIPFile } from './parsers/zip-reader';
import {
  readCatalog as readZX81Aerco, readFileData as readZX81AercoFile,
} from './parsers/zx81-aerco';
import type { DiskFormat, FileEntry, CatalogResult } from './parsers/types';

export interface Parser {
  readCatalog: (buf: Buffer) => CatalogResult;
  readFileData: (buf: Buffer, entry: FileEntry) => Buffer | null;
}

/** Mirrors getParser in electron/main.ts. */
export function getParser(format: DiskFormat): Parser {
  switch (format) {
    case 'larken': return { readCatalog: readLarken, readFileData: readLarkenFile };
    case 'oliger-v1':
    case 'oliger-v2': return { readCatalog: readOliger, readFileData: readOligerFile };
    case 'aerco-dos64':
    case 'aerco-rpm': return { readCatalog: readAerco, readFileData: readAercoFile };
    case 'zebra-dirscp':
    case 'zebra-cpm': return { readCatalog: readZebra, readFileData: readZebraFile };
    case 'ql': return { readCatalog: readQL, readFileData: readQLFile };
    case 'zx81-aerco': return { readCatalog: readZX81Aerco, readFileData: readZX81AercoFile };
    case 'tap': return { readCatalog: readTap, readFileData: readTapFile };
    case 'tzx':
    case 'zx81-tzx': return { readCatalog: readTzx, readFileData: readTzxFile };
    case 'sna': return { readCatalog: readSNA, readFileData: readSNAFile };
    case 'z80': return { readCatalog: readZ80, readFileData: readZ80File };
    case 'scr': return { readCatalog: readSCR, readFileData: readSCRFile };
    case 'mgt': return { readCatalog: readMGT, readFileData: readMGTFile };
    case 'zip': return { readCatalog: readZIP, readFileData: readZIPFile };
    default: throw new Error(`Unknown format: ${format}`);
  }
}

export function flattenEntries(entries: FileEntry[]): FileEntry[] {
  const flat: FileEntry[] = [];
  for (const e of entries) {
    flat.push(e);
    if (e.children) flat.push(...e.children);
  }
  return flat;
}

export interface HashedProgram {
  sha256: string;
  size: number;
  type: string;
  filename: string;
  index: number;
}

/**
 * Every program inside one image, with the hash that identifies it. Returns
 * an empty array for anything that is not a recognised image, so a caller can
 * feed it arbitrary files.
 */
export function hashPrograms(buffer: Buffer, hintPath: string): {
  format: DiskFormat | null; programs: HashedProgram[];
} {
  const format = detectFormat(buffer, hintPath);
  if (!format) return { format: null, programs: [] };

  let parser: Parser;
  let entries: FileEntry[];
  try {
    parser = getParser(format);
    entries = flattenEntries(parser.readCatalog(buffer).entries);
  } catch {
    return { format, programs: [] };
  }

  const programs: HashedProgram[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let data: Buffer | null = null;
    try { data = parser.readFileData(buffer, entry); } catch { /* skipped */ }
    if (!data || data.length === 0) continue;
    programs.push({
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      size: data.length,
      type: entry.type,
      filename: entry.filename.trim(),
      index: entry.index,
    });
  }
  return { format, programs };
}
