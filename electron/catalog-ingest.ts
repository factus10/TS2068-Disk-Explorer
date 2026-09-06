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
import { endsWithPath } from './catalog-status';
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
  /**
   * Every folder that has been scanned into this catalogue. `root` is the
   * first; a folder added through the ingest chooser is appended. Recorded so
   * a survey knows where disks were kept and a deletion check can look in each.
   */
  roots?: string[];
  imageCount: number; entryCount: number; uniqueCount: number;
  programs: StoredProgram[];
  unreadable: { file: string; reason: string }[];
  /**
   * Images examined that held no extractable program — the empty tapes and
   * blank disks a collection accumulates. Recorded so a survey remembers
   * having looked: without it, an image that yields nothing has no occurrence,
   * so every survey re-reports it as new and re-adding it does nothing.
   */
  emptyImages?: string[];
}

export interface IngestSurvey {
  root: string;
  /** Images on disk the catalogue has never seen. */
  fresh: string[];
  /** Images the catalogue records that are no longer on disk. */
  gone: string[];
  imagesOnDisk: number;
  imagesKnown: number;
  /** Images on disk already examined and found to hold no program. */
  imagesEmpty: number;
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

/**
 * What an ingest would do, without doing any of it. `scanDir` limits the scan
 * to one folder — which may be anywhere, not only under the collection root —
 * so newly imaged disks kept in their own folder can be added without moving
 * them first.
 */
export function surveyCollection(catalogDir: string, scanDir?: string): IngestSurvey | null {
  const cat = readCatalogFile(catalogDir);
  if (!cat) return null;
  const from = scanDir ?? cat.root;
  const roots = cat.roots?.length ? cat.roots : [cat.root];

  // Match an on-disk file to the catalogue by path suffix, the way the browser
  // does (catalog-status.endsWithPath): a disk is recognised wherever it is
  // kept, so a folder scanned from anywhere resolves against the same
  // programs and is not re-offered. Indexed by basename so each file is only
  // checked against its namesakes.
  interface Ent { rel: string; catalogued: boolean }
  const byBase = new Map<string, Ent[]>();
  const index = (rel: string, catalogued: boolean) => {
    const base = path.basename(rel);
    let list = byBase.get(base);
    if (!list) byBase.set(base, (list = []));
    list.push({ rel, catalogued });
  };
  for (const p of cat.programs) for (const o of p.occurrences) index(o.image, true);
  for (const rel of cat.emptyImages ?? []) index(rel, false);
  for (const u of cat.unreadable ?? []) index(u.file, false);
  const match = (abs: string): Ent | undefined =>
    byBase.get(path.basename(abs))?.find((e) => endsWithPath(abs, e.rel));

  const onDiskAbs = walk(from);
  const fresh: string[] = [];
  let known = 0; let empty = 0;
  for (const abs of onDiskAbs) {
    const hit = match(abs);
    if (!hit) fresh.push(path.relative(from, abs));
    else if (hit.catalogued) known++;
    else empty++;
  }

  // "Gone" is a claim about the whole collection, so it is only made on a full
  // scan of the primary root, and existence is checked across every recorded
  // root — a disk kept in another folder is not a deletion.
  let gone: string[] = [];
  if (from === cat.root) {
    const present = new Set<string>();
    const consider = (list: string[]) => {
      for (const abs of list) { const hit = match(abs); if (hit?.catalogued) present.add(hit.rel); }
    };
    consider(onDiskAbs);
    for (const r of roots) if (r !== from) consider(walk(r));
    const catalogued = new Set<string>();
    for (const p of cat.programs) for (const o of p.occurrences) catalogued.add(o.image);
    gone = [...catalogued].filter((rel) => !present.has(rel));
  }

  return { root: from, fresh, gone, imagesOnDisk: onDiskAbs.length, imagesKnown: known, imagesEmpty: empty };
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

  // Record where these disks were read from, so a later survey knows to look
  // there and the deletion check does not mistake them for gone.
  const roots = new Set(cat.roots?.length ? cat.roots : [cat.root]);
  roots.add(root);
  cat.roots = [...roots];

  const byHash = new Map<string, StoredProgram>();
  for (const p of cat.programs) byHash.set(p.sha256, p);

  const touched = new Map<string, { p: StoredProgram; data: Buffer; entry: FileEntry }>();
  const unreadable: { file: string; reason: string }[] = [];
  // Which images yielded a program this run, and which parsed but held none —
  // the latter are remembered so the survey stops re-offering empty tapes.
  const produced = new Set<string>();
  const emptyThisRun: string[] = [];
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
    // Reached only for an image that read and parsed: an unreadable one has
    // already returned. So no additions here means examined-but-empty.
    if (addedFromThis > 0) { imagesAdded++; produced.add(rel); }
    else emptyThisRun.push(rel);
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

  // Remember the empties so they are not re-offered; drop any that this run
  // finally got a program out of (a fixed file, or a parser that learned to
  // read it).
  const empty = new Set(cat.emptyImages ?? []);
  for (const rel of produced) empty.delete(rel);
  for (const rel of emptyThisRun) empty.add(rel);
  cat.emptyImages = [...empty].sort();

  fs.writeFileSync(path.join(catalogDir, 'catalog.json'), JSON.stringify(cat, null, 2));

  return {
    newPrograms, newOccurrences, imagesAdded, unreadable,
    uniqueCount: cat.uniqueCount, imageCount: cat.imageCount,
  };
}
