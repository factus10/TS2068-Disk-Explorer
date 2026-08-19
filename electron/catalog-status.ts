/**
 * "Is this already archived?", answered while browsing, from a catalogue
 * built by scripts/build-catalog.mts.
 *
 * Two files are read, and they have different jobs:
 *
 *   occurrences.csv  the stable map from an image to the programs inside it.
 *                    Regenerated only when the collection itself changes.
 *   marks.json       the live record of what has been archived, written by
 *                    this app and by scripts/mark-archived.mts alike.
 *
 * Status is the join of the two, computed on demand. Nothing is written back
 * into the CSVs: they are generated views, and render-catalog.mts rewrites
 * them wholesale, so a mark stored there would vanish without warning.
 *
 * Paths in the CSV are relative to the collection root, which this app has no
 * reason to know. An image is matched by asking whether its absolute path ends
 * with one of those relative paths, so the catalogue keeps working if the
 * collection is moved or mounted somewhere else.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ArchiveCount {
  /** Programs here considered archived: your marks plus exact name matches. */
  archived: number;
  /** Programs the catalogue knows about here. */
  total: number;
  /** Of those, ones you marked by hand — decisions. */
  marked: number;
  /** Of those, ones matched to the archive by name alone — guesses. */
  matched: number;
}

interface Catalog {
  /** Relative image path -> the programs in it. */
  byImage: Map<string, string[]>;
  /** Relative folder path -> every program under it. */
  byFolder: Map<string, string[]>;
  /** Basename -> the relative paths sharing it, for suffix matching. */
  byBasename: Map<string, string[]>;
  /** Program id -> a title, for reporting what was marked. */
  titles: Map<string, string>;
  mtimeMs: number;
}

let cached: { dir: string; catalog: Catalog } | null = null;

/** One CSV line, honouring the doubled-quote escaping the writer uses. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

function readCatalog(dir: string): Catalog | null {
  const csvPath = path.join(dir, 'occurrences.csv');
  let stat: fs.Stats;
  try { stat = fs.statSync(csvPath); } catch { return null; }

  if (cached && cached.dir === dir && cached.catalog.mtimeMs === stat.mtimeMs) {
    return cached.catalog;
  }

  let text: string;
  try { text = fs.readFileSync(csvPath, 'utf-8'); } catch { return null; }

  const lines = text.split('\n');
  const header = splitCsvLine(lines[0] ?? '');
  const col = (name: string) => header.indexOf(name);
  const iId = col('id'); const iTitle = col('title');
  const iImage = col('image'); const iFolder = col('folder');
  if (iId < 0 || iImage < 0 || iFolder < 0) return null;

  const byImage = new Map<string, Set<string>>();
  const byFolder = new Map<string, Set<string>>();
  const byBasename = new Map<string, string[]>();
  const titles = new Map<string, string>();

  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line) continue;
    const f = splitCsvLine(line);
    const id = f[iId]; const image = f[iImage]; const folder = f[iFolder];
    if (!id || !image) continue;

    if (!byImage.has(image)) {
      byImage.set(image, new Set());
      const base = path.basename(image);
      if (!byBasename.has(base)) byBasename.set(base, []);
      byBasename.get(base)!.push(image);
    }
    byImage.get(image)!.add(id);

    if (folder) {
      if (!byFolder.has(folder)) byFolder.set(folder, new Set());
      byFolder.get(folder)!.add(id);
    }
    if (iTitle >= 0 && f[iTitle] && !titles.has(id)) titles.set(id, f[iTitle]);
  }

  const catalog: Catalog = {
    byImage: new Map([...byImage].map(([k, v]) => [k, [...v]])),
    byFolder: new Map([...byFolder].map(([k, v]) => [k, [...v]])),
    byBasename,
    titles,
    mtimeMs: stat.mtimeMs,
  };
  cached = { dir, catalog };
  return catalog;
}

/** Does `abs` end with the relative catalogue path `rel`, on a path boundary? */
function endsWithPath(abs: string, rel: string): boolean {
  const a = abs.split(path.sep).join('/');
  if (!a.endsWith(rel)) return false;
  const at = a.length - rel.length;
  return at === 0 || a[at - 1] === '/';
}

interface Marks { generated: string; marks: Record<string, { status: string; note?: string; markedAt: string }> }

/**
 * Programs the name matching tied to a published record with confidence.
 * Read so that a count here agrees with the catalogue page, which treats an
 * exact match as archived — but kept separate from your own marks, because a
 * guess and a decision are not the same thing and the tooltip says which.
 */
function readExactMatches(dir: string): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'matches.json'), 'utf-8'));
    const out = new Set<string>();
    for (const m of raw.matches ?? []) if (m.exact) out.add(m.programId);
    return out;
  } catch {
    return new Set();
  }
}

function readMarks(dir: string): Marks {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'marks.json'), 'utf-8'));
    return raw && typeof raw === 'object' && raw.marks ? raw : { generated: '', marks: {} };
  } catch {
    return { generated: '', marks: {} };
  }
}

/** The program ids the catalogue records for a file or folder, if any. */
export function programsAt(dir: string, absPath: string, isDirectory: boolean): string[] | null {
  const catalog = readCatalog(dir);
  if (!catalog) return null;

  if (!isDirectory) {
    const candidates = catalog.byBasename.get(path.basename(absPath));
    if (!candidates) return null;
    const hit = candidates.find((rel) => endsWithPath(absPath, rel));
    return hit ? catalog.byImage.get(hit) ?? null : null;
  }

  // A folder is matched the same way, then credited with everything beneath
  // it — a disk folder holds its image and the tapes extracted from it.
  for (const [rel, ids] of catalog.byFolder) {
    if (endsWithPath(absPath, rel)) return ids;
  }
  return null;
}

/** How much of a file or folder is archived; null when it is not catalogued. */
export function archiveCount(dir: string, absPath: string, isDirectory: boolean): ArchiveCount | null {
  const ids = programsAt(dir, absPath, isDirectory);
  if (!ids || ids.length === 0) return null;
  const { marks } = readMarks(dir);
  const exact = readExactMatches(dir);
  let marked = 0; let matched = 0;
  for (const id of ids) {
    if (marks[id]?.status === 'archived') marked++;
    else if (exact.has(id)) matched++;
  }
  return { archived: marked + matched, total: ids.length, marked, matched };
}

/**
 * Mark everything in a file or folder. Returns how many programs changed —
 * which is usually fewer than the total, because the same program appears on
 * several disks and one may already have been marked.
 */
export function setArchived(
  dir: string, absPath: string, isDirectory: boolean, archived: boolean,
): { changed: number; total: number; titles: string[] } | null {
  const ids = programsAt(dir, absPath, isDirectory);
  if (!ids || ids.length === 0) return null;

  const store = readMarks(dir);
  const catalog = readCatalog(dir);
  const now = new Date().toISOString();
  let changed = 0;

  for (const id of ids) {
    const already = store.marks[id]?.status === 'archived';
    if (archived && !already) {
      store.marks[id] = { status: 'archived', markedAt: now };
      changed++;
    } else if (!archived && store.marks[id]) {
      delete store.marks[id];
      changed++;
    }
  }

  store.generated = now;
  try {
    fs.writeFileSync(path.join(dir, 'marks.json'), JSON.stringify(store, null, 2) + '\n');
  } catch {
    return null;   // a read-only catalogue folder: report failure rather than lie
  }

  return {
    changed,
    total: ids.length,
    titles: ids.slice(0, 5).map((id) => catalog?.titles.get(id) ?? id),
  };
}

/** How each of these programs stands: your decision, a guess, or neither. */
export function statusForIds(dir: string, ids: string[]): Record<string, 'marked' | 'matched'> {
  const { marks } = readMarks(dir);
  const exact = readExactMatches(dir);
  const out: Record<string, 'marked' | 'matched'> = {};
  for (const id of ids) {
    if (marks[id]?.status === 'archived') out[id] = 'marked';
    else if (exact.has(id)) out[id] = 'matched';
  }
  return out;
}

/**
 * Mark specific programs, by id. Used when an export puts a program into the
 * archive, where the caller already knows exactly what it wrote.
 */
export function markIds(dir: string, ids: string[], archived: boolean): { changed: number } {
  if (ids.length === 0) return { changed: 0 };
  const store = readMarks(dir);
  const now = new Date().toISOString();
  let changed = 0;
  for (const id of ids) {
    const already = store.marks[id]?.status === 'archived';
    if (archived && !already) { store.marks[id] = { status: 'archived', markedAt: now }; changed++; }
    else if (!archived && store.marks[id]) { delete store.marks[id]; changed++; }
  }
  if (changed === 0) return { changed: 0 };
  store.generated = now;
  try {
    fs.writeFileSync(path.join(dir, 'marks.json'), JSON.stringify(store, null, 2) + '\n');
  } catch {
    return { changed: 0 };
  }
  return { changed };
}

/** A quick sanity summary for Preferences, so a wrong folder is obvious. */
export function catalogSummary(dir: string): { images: number; folders: number; programs: number; archived: number } | null {
  const catalog = readCatalog(dir);
  if (!catalog) return null;
  const { marks } = readMarks(dir);
  const exact = readExactMatches(dir);
  const all = new Set<string>();
  for (const ids of catalog.byImage.values()) for (const id of ids) all.add(id);
  let archived = 0;
  for (const id of all) if (marks[id]?.status === 'archived' || exact.has(id)) archived++;
  return { images: catalog.byImage.size, folders: catalog.byFolder.size, programs: all.size, archived };
}
