/**
 * "Is this already archived?", answered while browsing, from a catalogue
 * built by scripts/build-catalog.mts.
 *
 * Two files are read, and they have different jobs:
 *
 *   catalog.json  the catalogue itself: which programs exist and which images
 *                 hold them. Rewritten only when the collection changes.
 *   marks.json    the live record of what has been archived, written by this
 *                 app and by scripts/mark-archived.mts alike.
 *
 * Status is the join of the two, computed on demand. Nothing is written back
 * into catalog.json: a mark is a decision about a program, not a fact about
 * the collection, and rebuilding the one must never destroy the other.
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

interface CatalogFile {
  programs: {
    id: string; sha256: string; title: string;
    occurrences: { image: string; folder: string }[];
  }[];
}

function readCatalog(dir: string): Catalog | null {
  const jsonPath = path.join(dir, 'catalog.json');
  let stat: fs.Stats;
  try { stat = fs.statSync(jsonPath); } catch { return null; }

  if (cached && cached.dir === dir && cached.catalog.mtimeMs === stat.mtimeMs) {
    return cached.catalog;
  }

  let data: CatalogFile;
  try { data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch { return null; }
  if (!Array.isArray(data.programs)) return null;

  const byImage = new Map<string, Set<string>>();
  const byFolder = new Map<string, Set<string>>();
  const byBasename = new Map<string, string[]>();
  const titles = new Map<string, string>();

  for (const p of data.programs) {
    titles.set(p.id, p.title);
    for (const o of p.occurrences ?? []) {
      if (!byImage.has(o.image)) {
        byImage.set(o.image, new Set());
        const base = path.basename(o.image);
        if (!byBasename.has(base)) byBasename.set(base, []);
        byBasename.get(base)!.push(o.image);
      }
      byImage.get(o.image)!.add(p.id);

      if (o.folder) {
        if (!byFolder.has(o.folder)) byFolder.set(o.folder, new Set());
        byFolder.get(o.folder)!.add(p.id);
      }
    }
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
export function endsWithPath(abs: string, rel: string): boolean {
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

/**
 * Every program the collection is known to hold, from the copy that ships
 * with the app or from a live catalogue if one is configured.
 *
 * This is what answers "is this disk new?", which is a different question
 * from "is this path archived?" and needs a different key: a program's own
 * bytes, not where anybody happens to keep it.
 */
interface Known { ids: Map<string, { title: string; archived: string }>; mtimeMs: number; source: string }
let knownCache: { key: string; known: Known } | null = null;

/** Where the shipped copy lives, whether running from source or packaged. */
function bundledKnownPath(): string | null {
  for (const candidate of [
    path.join(__dirname, 'data', 'known-programs.csv'),
    path.join(__dirname, '..', 'electron', 'data', 'known-programs.csv'),
    path.join(__dirname, '..', '..', 'electron', 'data', 'known-programs.csv'),
  ]) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}

/**
 * A live catalogue wins over the shipped copy: whoever built it has the
 * newest answer, and the shipped one is a snapshot of some earlier release.
 */
export function loadKnown(catalogDir?: string, downloadedPath?: string): Known | null {
  let file: string | null = null;
  // A live catalogue answers from itself; the projection is only for shipping.
  if (catalogDir) {
    const built = buildKnownProgramsCsv(catalogDir);
    if (built) {
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(path.join(catalogDir, 'catalog.json')).mtimeMs; } catch { /* ignore */ }
      const ids = new Map<string, { title: string; archived: string }>();
      for (const line of built.text.split('\n').slice(1)) {
        if (!line) continue;
        const f = splitCsvLine(line);
        if (f[0]) ids.set(f[0], { title: f[1] ?? '', archived: f[5] ?? '' });
      }
      return { ids, mtimeMs, source: path.join(catalogDir, 'catalog.json') };
    }
  }
  // Then a list downloaded since the app was built, then the one it shipped
  // with. Each is newer than the one after it.
  if (!file && downloadedPath) {
    try { if (fs.statSync(downloadedPath).isFile()) file = downloadedPath; } catch { /* fall through */ }
  }
  if (!file) file = bundledKnownPath();
  if (!file) return null;

  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return null; }
  const key = file;
  if (knownCache && knownCache.key === key && knownCache.known.mtimeMs === stat.mtimeMs) {
    return knownCache.known;
  }

  let text: string;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { return null; }
  const lines = text.split('\n');
  const header = splitCsvLine(lines[0] ?? '');
  const iId = header.indexOf('id');
  const iTitle = header.indexOf('title');
  const iArchived = header.indexOf('archived');
  if (iId < 0) return null;

  const ids = new Map<string, { title: string; archived: string }>();
  for (let n = 1; n < lines.length; n++) {
    if (!lines[n]) continue;
    const f = splitCsvLine(lines[n]);
    if (!f[iId]) continue;
    if (!ids.has(f[iId])) {
      ids.set(f[iId], {
        title: iTitle >= 0 ? f[iTitle] ?? '' : '',
        archived: iArchived >= 0 ? f[iArchived] ?? '' : '',
      });
    }
  }

  const known: Known = { ids, mtimeMs: stat.mtimeMs, source: file };
  knownCache = { key, known };
  return known;
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

/**
 * The shareable projection of a catalogue: which programs exist and which are
 * published, with nothing about where anybody keeps them.
 *
 * Built from catalog.csv for the program list, but from marks.json and
 * matches.json for the status, because those are live while the CSV is only
 * as fresh as the last render.
 */
export function buildKnownProgramsCsv(dir: string): { text: string; rows: number; archived: number; matched: number } | null {
  let data: {
    programs: {
      id: string; title: string; type: string; size: number;
      isScreen: boolean; isFont: boolean; isUdg: boolean;
      basic: { loads: string[] } | null;
      occurrences: unknown[];
    }[];
  };
  try { data = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf-8')); } catch { return null; }
  if (!Array.isArray(data.programs)) return null;

  const { marks } = readMarks(dir);
  const exact = readExactMatches(dir);

  const kindOf = (p: typeof data.programs[number]) =>
    p.isScreen ? 'screen' : p.isFont ? 'font' : p.isUdg ? 'UDG'
      : p.basic?.loads.length ? 'loader' : p.type;

  const seen = new Set<string>();
  const rows: { id: string; cells: string[] }[] = [];
  let archived = 0; let matched = 0;

  for (const p of data.programs) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);

    let state = '';
    if (marks[p.id]?.status === 'archived') { state = 'yes'; archived++; }
    else if (exact.has(p.id)) { state = 'matched'; matched++; }

    rows.push({
      id: p.id,
      cells: [p.id, p.title, kindOf(p), String(p.size), String(p.occurrences.length), state],
    });
  }

  // Sorted by id so refreshing the file is a small diff rather than seven
  // thousand reshuffled lines.
  rows.sort((a, b) => a.id.localeCompare(b.id));

  const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const out = ['id,title,kind,size,copies,archived']
    .concat(rows.map((r) => r.cells.map(csv).join(',')))
    .join('\n') + '\n';

  return { text: out, rows: rows.length, archived, matched };
}

export interface ShippedComparison {
  /** The shipped list already says what the catalogue would say. */
  inStep: boolean;
  catalogPrograms: number;
  shippedPrograms: number;
  /** Programs the catalogue has that the shipped list does not. */
  added: number;
  /** Programs the shipped list has that the catalogue no longer does. */
  removed: number;
  /** Programs whose archived state has changed since the list was written. */
  statusChanged: number;
  shippedPath: string | null;
}

/**
 * Whether the list that travels inside the app still says what the catalogue
 * says. It falls behind silently — the catalogue grows, marks accumulate, and
 * nothing in the app notices — so the answer is worth stating rather than
 * leaving to be remembered.
 */
export function compareShippedList(catalogDir: string): ShippedComparison | null {
  const projected = buildKnownProgramsCsv(catalogDir);
  if (!projected) return null;

  const parse = (text: string) => {
    const rows = new Map<string, string>();
    for (const line of text.split('\n').slice(1)) {
      if (!line) continue;
      const f = splitCsvLine(line);
      if (f[0]) rows.set(f[0], f[5] ?? '');
    }
    return rows;
  };

  const shippedPath = bundledKnownPath();
  let shippedText: string | null = null;
  if (shippedPath) {
    try { shippedText = fs.readFileSync(shippedPath, 'utf-8'); } catch { /* absent */ }
  }

  const now = parse(projected.text);
  if (shippedText === null) {
    return {
      inStep: false, catalogPrograms: now.size, shippedPrograms: 0,
      added: now.size, removed: 0, statusChanged: 0, shippedPath,
    };
  }
  if (shippedText === projected.text) {
    return {
      inStep: true, catalogPrograms: now.size, shippedPrograms: now.size,
      added: 0, removed: 0, statusChanged: 0, shippedPath,
    };
  }

  const was = parse(shippedText);
  let added = 0; let statusChanged = 0;
  for (const [id, state] of now) {
    if (!was.has(id)) added++;
    else if (was.get(id) !== state) statusChanged++;
  }
  let removed = 0;
  for (const id of was.keys()) if (!now.has(id)) removed++;

  return {
    inStep: false, catalogPrograms: now.size, shippedPrograms: was.size,
    added, removed, statusChanged, shippedPath,
  };
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
