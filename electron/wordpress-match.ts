/**
 * Tying catalogued programs to published records, by name.
 *
 * This is the same matching `scripts/match-wordpress.mts` does, moved in here
 * so the app can refresh its own answer from a live site instead of waiting
 * for someone to run a dump and a script. The rules are deliberately
 * identical, and the files written are the ones the script wrote: a
 * catalogue refreshed either way says the same thing.
 *
 * Matching is conservative on purpose. A wrong match tells you a program is
 * safely archived when it is not, which is the one error that loses material
 * — so a candidate is only accepted on a distinctive name, and everything
 * else is left unmatched for a person to look at.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WpRecord } from './wordpress';
import { effectiveDownload } from './wordpress';

interface Program {
  id: string; title: string; titleSource: string; type: string; size: number;
  names: string[];
  occurrences: { image: string; folder: string }[];
}
interface Catalog { root: string; programs: Program[] }

export interface RefreshResult {
  /** Programs the catalogue holds. */
  programs: number;
  /** Of those, ones now tied to a published record. */
  matched: number;
  /** Of those matches, ones on a whole distinctive name rather than a prefix. */
  exact: number;
  /** Published records the site holds. */
  records: number;
  /** Of those, ones tied to something in the collection. */
  recordsMatched: number;
  /** Where the two files went. */
  dir: string;
}

/** Names that identify nothing — see the catalogue build for why. */
const GENERIC = /^(AUTOSTART|AUTO|L|LOAD|LOADER|MENU|BOOT|START|RUN|FORMAT|README|READ ME|ME 1ST|ME1ST|CAT|DIR|COPY|PROG|PROGRAM|A|B|C|X|TEST|TEMP|[0-9]{1,3})$/;

function norm(s: string): string {
  return s
    .replace(/\.[A-Za-z0-9$]{1,3}$/, '')   // trailing Larken/Oliger type suffix
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * The title out of a TOSEC-style archive filename:
 *   "Tick Tack Toe (1984)(Weinberg, Butch)(TS2068)(US)(Program).zip" → "Tick Tack Toe"
 */
function titleFromDownload(url: string): string {
  if (!url) return '';
  let base: string;
  try { base = decodeURIComponent(url.split('/').pop() ?? ''); } catch { return ''; }
  base = base.replace(/\.[a-z0-9]{1,4}$/i, '');
  const paren = base.indexOf('(');
  return (paren > 0 ? base.slice(0, paren) : base).trim();
}

/**
 * A name has to be distinctive before it can carry a match. Short or generic
 * strings collide constantly across a collection this size.
 *
 * The letter test counts letters anywhere rather than three in a row: names
 * like VU-3D and 3D WORDS are perfectly distinctive but have no such run.
 */
function usable(n: string): boolean {
  return n.length >= 5 && !GENERIC.test(n) && (n.match(/[A-Z]/g) ?? []).length >= 3;
}

/**
 * Drop a trailing version, so TECH DRAW 2 0 and TECH DRAW meet. Disk
 * filenames rarely carry the version that the published title does.
 */
function withoutVersion(n: string): string {
  return n.replace(/\s+V?\d+(\s+\d+)*$/, '').trim();
}

interface Match {
  program: Program; recs: WpRecord[]; how: string; via: string;
  exact: boolean; ambiguous: boolean; alternatives: string[];
}

/** Every name a published record could be known by, indexed. */
function indexRecords(wp: WpRecord[]): Map<string, WpRecord[]> {
  const byName = new Map<string, WpRecord[]>();
  const add = (key: string, rec: WpRecord) => {
    const n = norm(key);
    if (!usable(n)) return;
    let list = byName.get(n);
    if (!list) byName.set(n, list = []);
    if (!list.some((r) => r.id === rec.id)) list.push(rec);
  };
  for (const rec of wp) {
    add(rec.title, rec);
    add(withoutVersion(norm(rec.title)), rec);
    const fromFile = titleFromDownload(rec.download_url);
    if (fromFile) {
      add(fromFile, rec);
      add(withoutVersion(norm(fromFile)), rec);
    }
  }
  return byName;
}

function matchPrograms(programs: Program[], wp: WpRecord[]): Match[] {
  const byName = indexRecords(wp);
  // Keys sorted long-first, for resolving a truncated disk filename against a
  // full published title. Longest wins so TECH DRAW does not lose to TECH.
  const keysByLength = [...byName.keys()].sort((a, b) => b.length - a.length);
  const matches: Match[] = [];

  for (const p of programs) {
    // The program's own title first — it is the best name we have for it.
    const candidates: { key: string; how: string }[] = [];
    if (p.titleSource !== 'generic filename') candidates.push({ key: p.title, how: `title (${p.titleSource})` });
    for (const n of p.names ?? []) candidates.push({ key: n, how: 'catalogue filename' });

    let found: Match | null = null;

    for (const c of candidates) {
      const key = norm(c.key);
      if (!usable(key)) continue;
      const hits = byName.get(key) ?? byName.get(withoutVersion(key));
      if (hits?.length) {
        found = { program: p, recs: hits, how: c.how, via: key, exact: true, ambiguous: false, alternatives: [] };
        break;
      }
    }

    // Nothing exact: try the truncation case, where the catalogue name is the
    // opening of a longer published title. Prefix only — a substring match in
    // the middle of a title pairs ADVENTURE with "Space Adventures Coloring
    // Book" and is not evidence of anything.
    if (!found) {
      for (const c of candidates) {
        const key = norm(c.key);
        if (!usable(key) || key.length < 6) continue;
        const fits = keysByLength.filter((w) => w.length > key.length && w.startsWith(key));
        if (fits.length > 0) {
          // Several published titles can open with the same truncation, and
          // nothing in the name says which. Longest is a guess, so say so.
          found = {
            program: p, recs: byName.get(fits[0])!,
            how: `${c.how}, truncated`, via: `${key} → ${fits[0]}`,
            exact: false, ambiguous: fits.length > 1, alternatives: fits.slice(1, 5),
          };
          break;
        }
      }
    }

    if (found) matches.push(found);
  }

  return matches;
}

/**
 * Fold a freshly read archive into a catalogue: keep the archive as
 * `wordpress.json` and the join as `matches.json`, which is what the file
 * browser reads to say a program is already published.
 *
 * `catalog.json` is not touched. A match is a fact about the archive, not
 * about the collection, and rebuilding the one must never disturb the other.
 */
export function refreshMatches(catalogDir: string, wp: WpRecord[]): RefreshResult {
  const catalogPath = path.join(catalogDir, 'catalog.json');
  const cat: Catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const programs = cat.programs ?? [];

  const matches = matchPrograms(programs, wp);
  const matchedWp = new Set<number>();
  for (const m of matches) for (const r of m.recs) matchedWp.add(r.id);

  fs.writeFileSync(path.join(catalogDir, 'wordpress.json'), JSON.stringify(wp, null, 2));

  fs.writeFileSync(path.join(catalogDir, 'matches.json'), JSON.stringify({
    generated: new Date().toISOString(),
    method: 'name',
    programsMatched: matches.length,
    programsTotal: programs.length,
    wpMatched: matchedWp.size,
    wpTotal: wp.length,
    matches: matches.map((m) => ({
      programId: m.program.id,
      programTitle: m.program.title,
      matchedOn: m.via,
      how: m.how,
      exact: m.exact,
      ambiguous: m.ambiguous,
      alternatives: m.alternatives,
      // Every record that shares the name, not just a representative: a title
      // like Chess legitimately has three archive entries behind it.
      wp: m.recs.map((r) => ({
        id: r.id, title: r.title, url: r.url,
        downloadUrl: effectiveDownload(r)?.url ?? '',
        onCompilation: effectiveDownload(r)?.via ?? '',
        mediaType: r.media_type, tags: r.tags, date: r.date,
        programmers: r.programmers, company: r.company,
      })),
    })),
  }, null, 2));

  return {
    programs: programs.length,
    matched: matches.length,
    exact: matches.filter((m) => m.exact).length,
    records: wp.length,
    recordsMatched: matchedWp.size,
    dir: catalogDir,
  };
}
