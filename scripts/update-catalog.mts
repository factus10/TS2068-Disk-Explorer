/**
 * Add newly imaged disks to an existing catalogue, without re-reading the
 * whole collection.
 *
 *   npx tsx scripts/update-catalog.mts <root> <catalogDir> [--prune] [--dry-run]
 *
 * Finds images the catalogue has never seen, fingerprints what is inside them,
 * and folds the result in: a program already known gains an occurrence, a
 * program nobody has seen becomes a new entry. Nothing else is touched.
 *
 * Deliberately does not re-run the WordPress or archive.org matching. The
 * catalogue is the source of truth and those are downstream of it; a program
 * that has just arrived cannot already have been published, so there is
 * nothing for a match pass to find.
 *
 * Existing entries keep their recorded title even if a new disk files the same
 * program under a better name. Their extracted files are named from the title,
 * and churning those paths would orphan every file already written.
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

interface Occurrence {
  image: string; folder: string; format: string; index: number; filename: string;
}

interface StoredProgram {
  id: string; sha256: string; title: string; titleSource: string;
  type: string; size: number;
  isScreen: boolean; isFont: boolean; isUdg: boolean;
  names: string[]; formats: string[];
  basic: BasicClues | null;
  occurrences: Occurrence[];
}

interface Catalog {
  root: string; generated: string;
  imageCount: number; entryCount: number; uniqueCount: number;
  programs: StoredProgram[];
  unreadable: { file: string; reason: string }[];
}

const root = process.argv[2];
const outDir = process.argv[3];
const prune = process.argv.includes('--prune');
const dryRun = process.argv.includes('--dry-run');
if (!root || !outDir) {
  console.error('usage: update-catalog.mts <root> <catalogDir> [--prune] [--dry-run]');
  process.exit(1);
}

const catalogPath = path.join(outDir, 'catalog.json');
let cat: Catalog;
try {
  cat = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
} catch {
  console.error(`no catalog.json in ${outDir} — use build-catalog.mts for a first pass`);
  process.exit(1);
}

if (path.resolve(cat.root) !== path.resolve(root)) {
  // Occurrence paths are relative to the recorded root. Folding in paths
  // relative to a different one would produce a catalogue that half-matches.
  console.error('the catalogue was built from a different collection root:');
  console.error(`  catalogue: ${cat.root}`);
  console.error(`  given    : ${root}`);
  process.exit(1);
}

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

const known = new Set<string>();
for (const p of cat.programs) for (const o of p.occurrences) known.add(o.image);

const onDisk = walk(root).map((f) => ({ abs: f, rel: path.relative(root, f) }));
const fresh = onDisk.filter((f) => !known.has(f.rel));
const onDiskRel = new Set(onDisk.map((f) => f.rel));
const gone = [...known].filter((rel) => !onDiskRel.has(rel));

console.log(`catalogue: ${cat.programs.length} programs across ${known.size} images`);
console.log(`collection: ${onDisk.length} images on disk`);
console.log(`  new to the catalogue: ${fresh.length}`);
console.log(`  in the catalogue but no longer on disk: ${gone.length}${gone.length && !prune ? ' (left alone; --prune to remove)' : ''}`);

if (fresh.length === 0 && (!prune || gone.length === 0)) {
  console.log('\nnothing to do');
  process.exit(0);
}

// ------------------------------------------------------------------ scan ----

const byHash = new Map<string, StoredProgram>();
for (const p of cat.programs) byHash.set(p.sha256, p);

/** Programs whose files need rewriting: new ones, and ones that gained a copy. */
const touched = new Map<string, { p: StoredProgram; data: Buffer; entry: FileEntry }>();
let newPrograms = 0; let newOccurrences = 0;
const unreadable: { file: string; reason: string }[] = [];

for (const { abs, rel } of fresh) {
  let buf: Buffer;
  try { buf = fs.readFileSync(abs); } catch (err: any) {
    unreadable.push({ file: abs, reason: err.message });
    continue;
  }
  const format = detectFormat(buf, abs);
  if (!format) { unreadable.push({ file: abs, reason: 'format not recognised' }); continue; }

  let parser: Parser; let entries: FileEntry[];
  try {
    parser = getParser(format);
    entries = flattenEntries(parser.readCatalog(buf).entries);
  } catch (err: any) {
    unreadable.push({ file: abs, reason: `catalog failed: ${err.message}` });
    continue;
  }

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let data: Buffer | null = null;
    try { data = parser.readFileData(buf, entry); } catch { /* skipped */ }
    if (!data || data.length === 0) continue;

    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    const occurrence: Occurrence = {
      image: rel, folder: path.dirname(rel),
      format, index: entry.index, filename: entry.filename.trim(),
    };

    let p = byHash.get(sha256);
    if (!p) {
      const clues = cluesFor(format as DiskFormat, data, entry);
      const names = [entry.filename.trim()];
      const { title, source } = guessTitle(names, clues);
      p = {
        id: sha256.slice(0, 8), sha256, title, titleSource: source,
        type: entry.type, size: data.length,
        isScreen: entry.type === 'code' && data.length === SCREEN_SIZE,
        isFont: entry.type === 'code' && data.length === 768,
        isUdg: entry.type === 'code' && data.length === 256,
        names, formats: [format], basic: clues, occurrences: [],
      };
      byHash.set(sha256, p);
      cat.programs.push(p);
      newPrograms++;
    } else {
      if (!p.names.includes(occurrence.filename)) p.names.push(occurrence.filename);
      if (!p.formats.includes(format)) p.formats.push(format);
    }

    p.occurrences.push(occurrence);
    newOccurrences++;
    // Its listing states a copy count, so a program that gained one needs
    // rewriting even though its bytes have not changed.
    if (!touched.has(sha256)) touched.set(sha256, { p, data, entry });
  }
}

// ----------------------------------------------------------------- prune ----

let prunedOccurrences = 0; let prunedPrograms = 0;
if (prune && gone.length > 0) {
  const goneSet = new Set(gone);
  for (const p of cat.programs) {
    const before = p.occurrences.length;
    p.occurrences = p.occurrences.filter((o) => !goneSet.has(o.image));
    prunedOccurrences += before - p.occurrences.length;
  }
  const kept = cat.programs.filter((p) => p.occurrences.length > 0);
  prunedPrograms = cat.programs.length - kept.length;
  cat.programs = kept;
}

// ----------------------------------------------------------------- write ----

if (dryRun) {
  console.log(`\ndry run — would add ${newPrograms} program(s) and ${newOccurrences} occurrence(s)`);
  if (prune) console.log(`would drop ${prunedOccurrences} occurrence(s) and ${prunedPrograms} program(s)`);
  process.exit(0);
}

for (const d of PROGRAM_DIRS) fs.mkdirSync(path.join(outDir, 'programs', d), { recursive: true });
for (const { p, data, entry } of touched.values()) {
  // The stored title is reused rather than re-derived: the extracted files are
  // named from it, and a changed title would orphan what is already written.
  writeProgramFiles(outDir, {
    id: p.id, title: p.title, type: p.type, size: p.size,
    isScreen: p.isScreen, names: p.names, occurrences: p.occurrences,
    data, entry, clues: p.basic,
  });
}

cat.generated = new Date().toISOString();
cat.imageCount = onDisk.length;
cat.entryCount = cat.programs.reduce((n, p) => n + p.occurrences.length, 0);
cat.uniqueCount = cat.programs.length;
if (unreadable.length > 0) cat.unreadable = [...cat.unreadable, ...unreadable];

fs.writeFileSync(catalogPath, JSON.stringify(cat, null, 2));

console.log(`\nadded ${newPrograms} new program(s), ${newOccurrences} occurrence(s) from ${fresh.length} image(s)`);
if (prune) console.log(`dropped ${prunedOccurrences} occurrence(s) and ${prunedPrograms} program(s) no longer on disk`);
if (unreadable.length > 0) console.log(`${unreadable.length} image(s) could not be read`);
console.log(`catalogue now ${cat.uniqueCount} programs across ${cat.imageCount} images`);
console.log(`\nNow render the views:  npx tsx scripts/render-catalog.mts ${outDir}`);
