/**
 * Folding newly imaged disks into a catalogue, from inside the app.
 *
 * A collection grows a few disks at a time. Re-reading all of it to account
 * for three of them is minutes of waiting for no gain, so this finds the
 * images the catalogue has never seen, fingerprints what is inside them, and
 * merges: a program already known gains an occurrence, one nobody has seen
 * becomes a new entry.
 *
 * The WordPress and archive.org matching is deliberately untouched. The
 * catalogue is the source of truth and those follow from it; a disk that
 * arrived this morning cannot already have been published.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { detectFormat } from './parsers/detect';
import { isSupportedFile } from './parsers/supported-formats';
import { SCREEN_SIZE } from './parsers/screen-decoder';
import { cluesFor, guessTitle, writeProgramFiles, PROGRAM_DIRS } from './catalog-characterize';
import type { BasicClues } from './catalog-characterize';
import type { DiskFormat, FileEntry } from './parsers/types';

export interface Occurrence {
  image: string; folder: string; format: string; index: number; filename: string;
}

export interface StoredProgram {
  id: string; sha256: string; title: string; titleSource: string;
  type: string; size: number;
  isScreen: boolean; isFont: boolean; isUdg: boolean;
  names: string[]; formats: string[];
  basic: BasicClues | null;
  occurrences: Occurrence[];
}

export interface Catalog {
  root: string; generated: string;
  imageCount: number; entryCount: number; uniqueCount: number;
  programs: StoredProgram[];
  unreadable: { file: string; reason: string }[];
}

export interface IngestSurvey {
  root: string;
  /** Images on disk the catalogue has never seen. */
  fresh: string[];
  /** Images the catalogue records that are no longer on disk. */
  gone: string[];
  imagesOnDisk: number;
  imagesKnown: number;
}

export interface IngestResult {
  newPrograms: number;
  newOccurrences: number;
  imagesAdded: number;
  unreadable: { file: string; reason: string }[];
  uniqueCount: number;
  imageCount: number;
}

export function readCatalogFile(catalogDir: string): Catalog | null {
  try { return JSON.parse(fs.readFileSync(path.join(catalogDir, 'catalog.json'), 'utf-8')); }
  catch { return null; }
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

/** What an ingest would do, without doing any of it. */
export function surveyCollection(catalogDir: string, root?: string): IngestSurvey | null {
  const cat = readCatalogFile(catalogDir);
  if (!cat) return null;
  const from = root ?? cat.root;

  const known = new Set<string>();
  for (const p of cat.programs) for (const o of p.occurrences) known.add(o.image);

  const onDisk = walk(from).map((f) => path.relative(from, f));
  const onDiskSet = new Set(onDisk);

  return {
    root: from,
    fresh: onDisk.filter((rel) => !known.has(rel)),
    gone: [...known].filter((rel) => !onDiskSet.has(rel)),
    imagesOnDisk: onDisk.length,
    imagesKnown: known.size,
  };
}

/**
 * Add the given images — relative paths, as the survey reports them — to the
 * catalogue. `onProgress` is called as each is read so a long run can be
 * watched rather than merely waited on.
 */
export function ingestImages(
  catalogDir: string,
  root: string,
  relPaths: string[],
  onProgress?: (done: number, total: number, current: string) => void,
): IngestResult | null {
  const cat = readCatalogFile(catalogDir);
  if (!cat) return null;

  const byHash = new Map<string, StoredProgram>();
  for (const p of cat.programs) byHash.set(p.sha256, p);

  const touched = new Map<string, { p: StoredProgram; data: Buffer; entry: FileEntry }>();
  const unreadable: { file: string; reason: string }[] = [];
  let newPrograms = 0; let newOccurrences = 0; let imagesAdded = 0;

  // Loaded here rather than at module scope so the app does not pay for the
  // parser table until a catalogue is actually being updated.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getParser, flattenEntries } = require('./catalog-parsers') as typeof import('./catalog-parsers');

  relPaths.forEach((rel, i) => {
    onProgress?.(i, relPaths.length, rel);
    const abs = path.join(root, rel);

    let buf: Buffer;
    try { buf = fs.readFileSync(abs); } catch (err: any) {
      unreadable.push({ file: rel, reason: err.message });
      return;
    }
    const format = detectFormat(buf, abs);
    if (!format) { unreadable.push({ file: rel, reason: 'format not recognised' }); return; }

    let entries: FileEntry[];
    let parser;
    try {
      parser = getParser(format);
      entries = flattenEntries(parser.readCatalog(buf).entries);
    } catch (err: any) {
      unreadable.push({ file: rel, reason: `catalog failed: ${err.message}` });
      return;
    }

    let addedFromThis = 0;
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
      addedFromThis++;
      // A listing states its copy count, so a program that gained one needs
      // rewriting even though its bytes have not changed.
      if (!touched.has(sha256)) touched.set(sha256, { p, data, entry });
    }
    if (addedFromThis > 0) imagesAdded++;
  });
  onProgress?.(relPaths.length, relPaths.length, '');

  for (const d of PROGRAM_DIRS) fs.mkdirSync(path.join(catalogDir, 'programs', d), { recursive: true });
  for (const { p, data, entry } of touched.values()) {
    // The stored title is reused rather than re-derived: the extracted files
    // are named from it, and a changed title would orphan what is written.
    writeProgramFiles(catalogDir, {
      id: p.id, title: p.title, type: p.type, size: p.size,
      isScreen: p.isScreen, names: p.names, occurrences: p.occurrences,
      data, entry, clues: p.basic,
    });
  }

  cat.generated = new Date().toISOString();
  cat.imageCount = new Set(cat.programs.flatMap((p) => p.occurrences.map((o) => o.image))).size;
  cat.entryCount = cat.programs.reduce((n, p) => n + p.occurrences.length, 0);
  cat.uniqueCount = cat.programs.length;
  if (unreadable.length > 0) cat.unreadable = [...cat.unreadable, ...unreadable];

  fs.writeFileSync(path.join(catalogDir, 'catalog.json'), JSON.stringify(cat, null, 2));

  return {
    newPrograms, newOccurrences, imagesAdded, unreadable,
    uniqueCount: cat.uniqueCount, imageCount: cat.imageCount,
  };
}
