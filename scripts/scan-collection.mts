/**
 * Read-only survey of a collection of disk images and tapes.
 *
 * Walks a tree, opens every image the app can open, and reports what is in
 * them: how many programs, how many survive de-duplication, and what the
 * characterisation has to work with. Writes nothing — the catalogue build is
 * a separate pass, and this exists so the scale is known before it runs.
 *
 *   npx tsx scripts/scan-collection.ts <root> [--json out.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { detectFormat } from '../electron/parsers/detect';
import { isSupportedFile } from '../electron/parsers/supported-formats';
import { readCatalog as readLarken, readFileData as readLarkenFile } from '../electron/parsers/larken';
import { readCatalog as readOliger, readFileData as readOligerFile } from '../electron/parsers/oliger';
import { readCatalog as readAerco, readFileData as readAercoFile } from '../electron/parsers/aerco';
import { readCatalog as readZebra, readFileData as readZebraFile } from '../electron/parsers/zebra';
import { readCatalog as readQL, readFileData as readQLFile } from '../electron/parsers/ql';
import { readCatalog as readTap, readFileData as readTapFile } from '../electron/parsers/tap-reader';
import { readCatalog as readTzx, readFileData as readTzxFile } from '../electron/parsers/tzx-reader';
import { readCatalog as readSNA, readFileData as readSNAFile } from '../electron/parsers/sna-reader';
import { readCatalog as readZ80, readFileData as readZ80File } from '../electron/parsers/z80-reader';
import { readCatalog as readSCR, readFileData as readSCRFile } from '../electron/parsers/scr-reader';
import { readCatalog as readMGT, readFileData as readMGTFile } from '../electron/parsers/mgt-reader';
import { readCatalog as readZIP, readFileData as readZIPFile } from '../electron/parsers/zip-reader';
import { readCatalog as readZX81Aerco, readFileData as readZX81AercoFile } from '../electron/parsers/zx81-aerco';
import type { DiskFormat, FileEntry, CatalogResult } from '../electron/parsers/types';

type Parser = {
  readCatalog: (buf: Buffer) => CatalogResult;
  readFileData: (buf: Buffer, entry: FileEntry) => Buffer | null;
};

/** Mirrors getParser in main.ts; kept in step with it by the format list. */
function getParser(format: DiskFormat): Parser {
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
    case 'tzx': return { readCatalog: readTzx, readFileData: readTzxFile };
    case 'sna': return { readCatalog: readSNA, readFileData: readSNAFile };
    case 'z80': return { readCatalog: readZ80, readFileData: readZ80File };
    case 'scr': return { readCatalog: readSCR, readFileData: readSCRFile };
    case 'mgt': return { readCatalog: readMGT, readFileData: readMGTFile };
    case 'zip': return { readCatalog: readZIP, readFileData: readZIPFile };
    default: throw new Error(`Unknown format: ${format}`);
  }
}

function flattenEntries(entries: FileEntry[]): FileEntry[] {
  const flat: FileEntry[] = [];
  for (const e of entries) {
    flat.push(e);
    if (e.children) flat.push(...e.children);
  }
  return flat;
}

function walk(dir: string, out: string[] = []): string[] {
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (isSupportedFile(item.name)) out.push(full);
  }
  return out;
}

interface Occurrence {
  image: string;
  format: DiskFormat;
  index: number;
  filename: string;
}

interface Unique {
  hash: string;
  size: number;
  type: string;
  /** Names this same byte-for-byte content is filed under across the collection. */
  names: Set<string>;
  occurrences: Occurrence[];
}

const root = process.argv[2];
if (!root) {
  console.error('usage: scan-collection.ts <root> [--json out.json]');
  process.exit(1);
}
const jsonAt = process.argv.indexOf('--json');
const jsonOut = jsonAt > 0 ? process.argv[jsonAt + 1] : null;

const images = walk(root);
console.log(`Walking ${root}`);
console.log(`${images.length} candidate images/tapes\n`);

const uniques = new Map<string, Unique>();
const unreadable: { file: string; reason: string }[] = [];
const byFormat = new Map<string, number>();
const byType = new Map<string, number>();
let totalEntries = 0;
let emptyImages = 0;
let done = 0;

const started = Date.now();

/**
 * Parsing an image takes about a millisecond; fetching one off cloud storage
 * takes the better part of a second, and that wait is idle. So reads run
 * concurrently and the parsing stays sequential, which keeps the accumulators
 * below free of races.
 */
const READ_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 32);

async function* readAhead(files: string[]): AsyncGenerator<[string, Buffer | Error]> {
  const inFlight = new Map<number, Promise<[string, Buffer | Error]>>();
  const start = (i: number) => {
    inFlight.set(i, fs.promises.readFile(files[i])
      .then((b) => [files[i], b] as [string, Buffer])
      .catch((e) => [files[i], e as Error] as [string, Error]));
  };
  let next = 0;
  for (; next < Math.min(READ_CONCURRENCY, files.length); next++) start(next);
  // Yields in input order while keeping the window full, so a slow fetch
  // holds up only its own slot rather than the whole queue.
  for (let i = 0; i < files.length; i++) {
    const result = await inFlight.get(i)!;
    inFlight.delete(i);
    if (next < files.length) start(next++);
    yield result;
  }
}

for await (const [file, payload] of readAhead(images)) {
  done++;
  if (done % 250 === 0) {
    const rate = done / ((Date.now() - started) / 1000);
    process.stderr.write(
      `  ${done}/${images.length}  ${rate.toFixed(0)}/s  eta ${((images.length - done) / rate / 60).toFixed(1)}min\n`,
    );
  }
  const fileStart = Date.now();

  if (payload instanceof Error) {
    unreadable.push({ file, reason: `read failed: ${payload.message}` });
    continue;
  }
  const buffer = payload;

  const format = detectFormat(buffer, file);
  if (!format) {
    unreadable.push({ file, reason: 'format not recognised' });
    continue;
  }
  byFormat.set(format, (byFormat.get(format) ?? 0) + 1);

  let entries: FileEntry[];
  let parser: Parser;
  try {
    parser = getParser(format);
    entries = flattenEntries(parser.readCatalog(buffer).entries);
  } catch (err: any) {
    unreadable.push({ file, reason: `catalog failed (${format}): ${err.message}` });
    continue;
  }

  const real = entries.filter((e) => !e.isDirectory);
  if (real.length === 0) { emptyImages++; continue; }

  for (const entry of real) {
    let data: Buffer | null = null;
    try {
      data = parser.readFileData(buffer, entry);
    } catch { /* counted as unreadable entry below */ }
    if (!data || data.length === 0) continue;

    totalEntries++;
    byType.set(entry.type, (byType.get(entry.type) ?? 0) + 1);

    const hash = crypto.createHash('sha256').update(data).digest('hex');
    let u = uniques.get(hash);
    if (!u) {
      u = { hash, size: data.length, type: entry.type, names: new Set(), occurrences: [] };
      uniques.set(hash, u);
    }
    u.names.add(entry.filename.trim());
    u.occurrences.push({
      image: path.relative(root, file),
      format,
      index: entry.index,
      filename: entry.filename.trim(),
    });
  }

  const took = Date.now() - fileStart;
  if (took > 2000) {
    process.stderr.write(`  SLOW ${(took / 1000).toFixed(1)}s  ${format}  ${path.relative(root, file)}\n`);
  }
}

// ---- report ----
const list = [...uniques.values()];
const dupes = list.filter((u) => u.occurrences.length > 1);
const singles = list.filter((u) => u.occurrences.length === 1);

const pct = (n: number, d: number) => d === 0 ? '0' : (100 * n / d).toFixed(1);

console.log('\n════ IMAGES ════');
console.log(`  opened          ${images.length - unreadable.length}`);
console.log(`  unreadable      ${unreadable.length}`);
console.log(`  parsed but empty ${emptyImages}`);
console.log('\n  by format:');
for (const [f, n] of [...byFormat].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${f.padEnd(14)} ${String(n).padStart(5)}`);
}

console.log('\n════ PROGRAMS ════');
console.log(`  total entries   ${totalEntries}`);
console.log(`  unique by bytes ${list.length}  (${pct(list.length, totalEntries)}% of entries)`);
console.log(`  duplicated      ${dupes.length} unique programs appear more than once`);
console.log(`  one-off         ${singles.length}`);
console.log(`  redundancy      ${totalEntries - list.length} copies could be collapsed`);
console.log('\n  by type:');
for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${t.padEnd(14)} ${String(n).padStart(5)}`);
}

console.log('\n════ MOST DUPLICATED ════');
for (const u of [...dupes].sort((a, b) => b.occurrences.length - a.occurrences.length).slice(0, 15)) {
  const names = [...u.names].slice(0, 3).join(' / ');
  console.log(`  ${String(u.occurrences.length).padStart(4)}×  ${names.padEnd(34).slice(0, 34)} ${u.type.padEnd(10)} ${String(u.size).padStart(7)}b`);
}

// Same name, different bytes: the variants that need a human eye.
const byName = new Map<string, Set<string>>();
for (const u of list) {
  for (const n of u.names) {
    const key = n.toUpperCase().replace(/\.[BC][\w$]*$/i, '').trim();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key)!.add(u.hash);
  }
}
const variants = [...byName].filter(([, hashes]) => hashes.size > 1);
console.log('\n════ VARIANTS (same name, different bytes) ════');
console.log(`  ${variants.length} names have more than one distinct version`);
for (const [name, hashes] of variants.sort((a, b) => b[1].size - a[1].size).slice(0, 12)) {
  console.log(`  ${String(hashes.size).padStart(3)} versions  ${name}`);
}

if (unreadable.length > 0) {
  console.log('\n════ UNREADABLE (first 15) ════');
  for (const u of unreadable.slice(0, 15)) {
    console.log(`  ${u.reason.padEnd(34).slice(0, 34)} ${path.relative(root, u.file)}`);
  }
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({
    root,
    imageCount: images.length,
    totalEntries,
    uniques: list.map((u) => ({ ...u, names: [...u.names] })),
    unreadable,
  }, null, 2));
  console.log(`\nDetail written to ${jsonOut}`);
}
