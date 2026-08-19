/**
 * The two questions a catalogue answers that browsing it cannot.
 *
 * What is rarest and still unarchived — the work queue, ordered so that the
 * material least likely to exist elsewhere comes first. And which folders hold
 * programs found nowhere else, which is the same question asked of the shelf
 * rather than the programs: it says which disks to reach for.
 *
 * Both are derived; nothing here writes.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TodoEntry {
  id: string;
  title: string;
  kind: string;
  size: number;
  /** Copies across the whole collection. */
  copies: number;
  /** Distinct folders holding it — the real measure of how rare it is. */
  folders: number;
  /** Where to find it, first few. */
  foundIn: string[];
  /** What the program says about itself, if anything. */
  clue: string;
}

export interface FolderStat {
  folder: string;
  /** Catalogue entries in it, counting repeats. */
  entries: number;
  /** Distinct programs. */
  programs: number;
  /** Programs that exist in no other folder — what would be lost with it. */
  onlyHere: number;
  /** Of its programs, how many are archived. */
  archived: number;
}

export interface Insights {
  root: string;
  todo: TodoEntry[];
  folders: FolderStat[];
  /** Programs considered archived, for the headline. */
  archived: number;
  programs: number;
}

interface CatalogProgram {
  id: string; title: string; type: string; size: number;
  isScreen: boolean; isFont: boolean; isUdg: boolean;
  basic: { loads: string[]; rems: string[]; strings: string[] } | null;
  occurrences: { image: string; folder: string }[];
}

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

export function buildInsights(catalogDir: string): Insights | null {
  const cat = readJson<{ root: string; programs: CatalogProgram[] }>(path.join(catalogDir, 'catalog.json'));
  if (!cat || !Array.isArray(cat.programs)) return null;

  const marks = readJson<{ marks: Record<string, { status: string }> }>(
    path.join(catalogDir, 'marks.json'),
  )?.marks ?? {};
  const exact = new Set<string>(
    (readJson<{ matches: { programId: string; exact: boolean }[] }>(
      path.join(catalogDir, 'matches.json'),
    )?.matches ?? []).filter((m) => m.exact).map((m) => m.programId),
  );

  const isArchived = (id: string) => marks[id]?.status === 'archived' || exact.has(id);
  const kindOf = (p: CatalogProgram) =>
    p.isScreen ? 'screen' : p.isFont ? 'font' : p.isUdg ? 'UDG'
      : p.basic?.loads.length ? 'loader' : p.type;

  // --- folders -------------------------------------------------------------
  const folderPrograms = new Map<string, Set<string>>();
  const folderEntries = new Map<string, number>();
  const programFolders = new Map<string, Set<string>>();

  for (const p of cat.programs) {
    for (const o of p.occurrences) {
      const folder = o.folder === '.' || !o.folder ? '(root)' : o.folder;
      if (!folderPrograms.has(folder)) folderPrograms.set(folder, new Set());
      folderPrograms.get(folder)!.add(p.id);
      folderEntries.set(folder, (folderEntries.get(folder) ?? 0) + 1);
      if (!programFolders.has(p.id)) programFolders.set(p.id, new Set());
      programFolders.get(p.id)!.add(folder);
    }
  }

  const folders: FolderStat[] = [...folderPrograms].map(([folder, ids]) => ({
    folder,
    entries: folderEntries.get(folder) ?? 0,
    programs: ids.size,
    // A program in exactly one folder exists nowhere else in the collection.
    onlyHere: [...ids].filter((id) => programFolders.get(id)!.size === 1).length,
    archived: [...ids].filter(isArchived).length,
  })).sort((a, b) => b.onlyHere - a.onlyHere || b.programs - a.programs || a.folder.localeCompare(b.folder));

  // --- what still needs archiving ------------------------------------------
  const todo: TodoEntry[] = cat.programs
    .filter((p) => !isArchived(p.id))
    .map((p) => {
      const inFolders = [...(programFolders.get(p.id) ?? new Set<string>())];
      const clue = [
        p.basic?.rems?.[0],
        p.basic?.strings?.[0],
        p.basic?.loads?.length ? `LOADs ${p.basic.loads.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      return {
        id: p.id, title: p.title, kind: kindOf(p), size: p.size,
        copies: p.occurrences.length,
        folders: inFolders.length,
        foundIn: inFolders.slice(0, 3),
        clue: clue.slice(0, 140),
      };
    })
    // Rarest first: fewest folders, then fewest copies. A program on one disk
    // in one place is the one that disappears if that disk does.
    .sort((a, b) => a.folders - b.folders || a.copies - b.copies || a.title.localeCompare(b.title));

  return {
    root: cat.root,
    todo,
    folders,
    archived: cat.programs.filter((p) => isArchived(p.id)).length,
    programs: cat.programs.length,
  };
}
