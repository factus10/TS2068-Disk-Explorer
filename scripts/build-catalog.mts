/**
 * Build a de-duplicated, characterised catalogue of a collection of disk
 * images and tapes.
 *
 *   npx tsx scripts/build-catalog.mts <root> <outDir>
 *
 * Writes catalog.json and one extracted copy of each unique program. The
 * human-facing views — the CSVs and index.html — are render-catalog.mts's job,
 * because they are cheap to regenerate and get iterated on constantly, while
 * this pass re-reads the whole collection.
 *
 * Programs are grouped by the SHA-256 of their bytes, so the same program on
 * twelve disks is one entry with twelve occurrences. Characterisation comes
 * from the content rather than the filename: in a real collection the
 * filenames are conventions — AUTOSTART, L, MENU — reused across hundreds of
 * unrelated disks and worth nothing as titles.
 *
 * To add a few new disks to an existing catalogue, use update-catalog.mts
 * instead; this pass reads everything.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { detectFormat } from '../electron/parsers/detect';
import { isSupportedFile } from '../electron/parsers/supported-formats';
import { SCREEN_SIZE } from '../electron/parsers/screen-decoder';
import { getParser, flattenEntries, type Parser } from './lib/collection.mts';
import {
  cluesFor, guessTitle, writeProgramFiles, PROGRAM_DIRS, type BasicClues,
} from './lib/characterize.mts';
import type { DiskFormat, FileEntry } from '../electron/parsers/types';

function walk(dir: string, out: string[] = []): string[] {
  let items: fs.Dirent[];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (isSupportedFile(item.name)) out.push(full);
  }
  return out;
}

interface Occurrence {
  image: string; folder: string; format: DiskFormat; index: number; filename: string;
}

interface Program {
  hash: string; size: number; type: string;
  names: Set<string>; formats: Set<string>;
  occurrences: Occurrence[];
  data: Buffer; entry: FileEntry; clues: BasicClues | null;
  isScreen: boolean; isFont: boolean; isUdg: boolean;
}

const root = process.argv[2];
const outDir = process.argv[3];
if (!root || !outDir) {
  console.error('usage: build-catalog.mts <root> <outDir>');
  process.exit(1);
}

/**
 * Parsing an image takes about a millisecond; fetching one off cloud storage
 * takes the better part of a second, and that wait is idle. So reads run
 * concurrently and parsing stays sequential, which keeps the accumulators free
 * of races.
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
  for (let i = 0; i < files.length; i++) {
    const r = await inFlight.get(i)!;
    inFlight.delete(i);
    if (next < files.length) start(next++);
    yield r;
  }
}

const images = walk(root);
console.log(`${images.length} images under ${root}`);

const programs = new Map<string, Program>();
const unreadable: { file: string; reason: string }[] = [];
let done = 0;
const started = Date.now();

for await (const [file, payload] of readAhead(images)) {
  done++;
  if (done % 500 === 0) {
    const rate = done / ((Date.now() - started) / 1000);
    process.stderr.write(`  read ${done}/${images.length}  ${rate.toFixed(0)}/s\n`);
  }
  if (payload instanceof Error) { unreadable.push({ file, reason: payload.message }); continue; }

  const format = detectFormat(payload, file);
  if (!format) { unreadable.push({ file, reason: 'format not recognised' }); continue; }

  let parser: Parser; let entries: FileEntry[];
  try {
    parser = getParser(format);
    entries = flattenEntries(parser.readCatalog(payload).entries);
  } catch (err: any) {
    unreadable.push({ file, reason: `catalog failed: ${err.message}` });
    continue;
  }

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let data: Buffer | null = null;
    try { data = parser.readFileData(payload, entry); } catch { /* skipped */ }
    if (!data || data.length === 0) continue;

    const hash = crypto.createHash('sha256').update(data).digest('hex');
    let p = programs.get(hash);
    if (!p) {
      p = {
        hash, size: data.length, type: entry.type,
        names: new Set(), formats: new Set(), occurrences: [],
        data, entry, clues: cluesFor(format, data, entry),
        isScreen: entry.type === 'code' && data.length === SCREEN_SIZE,
        isFont: entry.type === 'code' && data.length === 768,
        isUdg: entry.type === 'code' && data.length === 256,
      };
      programs.set(hash, p);
    }
    p.names.add(entry.filename.trim());
    p.formats.add(format);
    p.occurrences.push({
      image: path.relative(root, file),
      folder: path.dirname(path.relative(root, file)),
      format, index: entry.index, filename: entry.filename.trim(),
    });
  }
}

const entryCount = [...programs.values()].reduce((n, p) => n + p.occurrences.length, 0);
console.log(`\n${programs.size} unique programs from ${entryCount} entries`);

fs.mkdirSync(outDir, { recursive: true });
for (const d of PROGRAM_DIRS) fs.mkdirSync(path.join(outDir, 'programs', d), { recursive: true });

const list = [...programs.values()];
for (const p of list) {
  const { title } = guessTitle([...p.names], p.clues);
  writeProgramFiles(outDir, {
    id: p.hash.slice(0, 8), title, type: p.type, size: p.size,
    isScreen: p.isScreen, names: [...p.names], occurrences: p.occurrences,
    data: p.data, entry: p.entry, clues: p.clues,
  });
}

fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify({
  root, generated: new Date().toISOString(),
  imageCount: images.length,
  entryCount,
  uniqueCount: list.length,
  programs: list.map((p) => {
    const { title, source } = guessTitle([...p.names], p.clues);
    return {
      id: p.hash.slice(0, 8), sha256: p.hash, title, titleSource: source,
      type: p.type, size: p.size,
      isScreen: p.isScreen, isFont: p.isFont, isUdg: p.isUdg,
      names: [...p.names], formats: [...p.formats],
      basic: p.clues, occurrences: p.occurrences,
    };
  }),
  unreadable,
}, null, 2));

console.log(`catalog.json      ${list.length} programs`);
console.log(`programs/         one copy of each`);
console.log(`\nwritten to ${outDir}`);
console.log(`\nNow render the views:  npx tsx scripts/render-catalog.mts ${outDir}`);
