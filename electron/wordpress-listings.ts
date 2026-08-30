/**
 * Searching the published listings, from a copy held on this machine.
 *
 * The listings are fetched once and kept as `wordpress-listings.json` beside
 * `wordpress.json`, and every search reads that. Two faults in asking the
 * site each time are what put the copy here:
 *
 *   - **The site cannot find half of them.** WordPress searches
 *     `post_content`, and only some records render their listing into the
 *     body; the rest keep it in the `source_code` field alone. A record like
 *     that is never offered, so a search could not reach it however far down
 *     the results it read. On this archive that lost 12 of the 68 records
 *     holding `GO SUB 9000`.
 *   - **A common phrase was cut short.** The site matches each *word*
 *     anywhere in a record, so `PRINT AT` offered 1,385 candidates for a
 *     phrase held by a few hundred, and reading was capped part-way through.
 *
 * Neither survives having the listings to hand: a search here reads all of
 * them, so what comes back is exact and complete, and it takes no network at
 * all. The cost is one fetch of about 15 MB, which the same pass that
 * refreshes the matches already has reason to make.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WpHit, WpListing } from './wordpress';

export const LISTINGS_FILE = 'wordpress-listings.json';

interface ListingsFile {
  generated: string;
  /** Which site they came from, so a copy of another archive is obvious. */
  site: string;
  records: WpListing[];
}

export interface LocalSearchResult {
  hits: WpHit[];
  /** Listings actually read — every one held, not a sample. */
  searched: number;
  /** When the copy was taken, for saying how old the answer is. */
  generated: string;
  /** The phrase as searched, after any surrounding quotes were removed. */
  phrase: string;
}

export interface ListingsStatus {
  generated: string;
  site: string;
  records: number;
  /** Of those, ones that actually carry a listing. */
  withSource: number;
}

export function listingsPath(dir: string): string {
  return path.join(dir, LISTINGS_FILE);
}

export function saveListings(dir: string, site: string, records: WpListing[]): ListingsStatus {
  const file: ListingsFile = { generated: new Date().toISOString(), site, records };
  // No indentation: this is a cache of fifteen megabytes that nobody reads by
  // hand, and pretty-printing it would half again the size for nothing.
  fs.writeFileSync(listingsPath(dir), JSON.stringify(file));
  cached = null;
  return {
    generated: file.generated,
    site,
    records: records.length,
    withSource: records.filter((r) => r.source).length,
  };
}

/**
 * The copy is large enough that re-reading it per keystroke would be felt, so
 * it is held once and dropped when the file underneath it changes.
 */
let cached: { path: string; mtimeMs: number; file: ListingsFile } | null = null;

function load(dir: string): ListingsFile | null {
  const file = listingsPath(dir);
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return null; }
  if (cached && cached.path === file && cached.mtimeMs === stat.mtimeMs) return cached.file;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!parsed || !Array.isArray(parsed.records)) return null;
    cached = { path: file, mtimeMs: stat.mtimeMs, file: parsed };
    return parsed;
  } catch {
    return null;   // truncated by a failed write, or from an older shape
  }
}

export function listingsStatus(dir: string): ListingsStatus | null {
  const file = load(dir);
  if (!file) return null;
  return {
    generated: file.generated,
    site: file.site ?? '',
    records: file.records.length,
    withSource: file.records.filter((r) => r.source).length,
  };
}

/**
 * A phrase in quotes means the phrase, not the quote marks.
 *
 * Wrapping a search in quotes is the habit every search box teaches, and it
 * used to guarantee no results here: the quotes were kept and looked for in
 * the listing, where they never appear. Stripping them is what the reader
 * meant, and matches what the site's own search does with a quoted term.
 */
export function unquote(phrase: string): string {
  const q = phrase.trim();
  const quoted = (q.length >= 2 && q.startsWith('"') && q.endsWith('"'))
    || (q.length >= 2 && q.startsWith('“') && q.endsWith('”'));
  return quoted ? q.slice(1, -1).trim() : q;
}

/**
 * Published programs whose *title* holds `name`, from the same copy.
 *
 * The site cannot rank this usefully. Its search matches each word anywhere
 * in a record, so "On Your Mark" matched 80 records on the strength of "on",
 * "your" and "mark" appearing somewhere, and the REST API returns them
 * newest-first rather than by relevance — which put the record actually
 * called "On Your Mark" fiftieth, behind "Household Finance Calculator" and
 * "TEST". Asking for the first twenty of that got twenty wrong answers.
 *
 * Here every title is read, and the ones that are the name outright come
 * first, then the ones that begin with it, then the rest — so the answer a
 * reader wants is the answer at the top.
 */
export function searchTitles(dir: string, name: string): LocalSearchResult | null {
  const file = load(dir);
  if (!file) return null;

  const wanted = unquote(name);
  const empty = { hits: [], searched: file.records.length, generated: file.generated, phrase: wanted };
  if (!wanted) return empty;

  const needle = wanted.toLowerCase();
  const ranked: { rank: number; hit: WpHit }[] = [];
  for (const rec of file.records) {
    const title = rec.title.toLowerCase();
    const rank = title === needle ? 0 : title.startsWith(needle) ? 1 : title.includes(needle) ? 2 : -1;
    if (rank < 0) continue;
    const { source: _omit, ...rest } = rec;
    ranked.push({ rank, hit: { ...rest, context: [] } });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.hit.title.localeCompare(b.hit.title));

  return { ...empty, hits: ranked.map((r) => r.hit) };
}

/** The lines holding the phrase, for showing why a record matched. */
function contextFor(source: string, needle: string, want = 3): { line: string; number: number }[] {
  const lines = source.split(/\r?\n/);
  const out: { line: string; number: number }[] = [];
  for (let i = 0; i < lines.length && out.length < want; i++) {
    if (lines[i].toLowerCase().includes(needle)) out.push({ line: lines[i].trim(), number: i + 1 });
  }
  return out;
}

/**
 * Every published program whose listing holds `phrase`.
 *
 * Case is ignored, on both sides — a listing is shouted in upper case and
 * nobody types it that way. Otherwise the match is literal: the characters
 * as given, in that order, so a line of BASIC can be pasted in and found.
 *
 * Null means there is no copy to search; the caller should offer to fetch one
 * rather than quietly returning nothing found.
 */
export function searchListings(dir: string, phrase: string): LocalSearchResult | null {
  const file = load(dir);
  if (!file) return null;

  const wanted = unquote(phrase);
  const empty = { hits: [], searched: file.records.length, generated: file.generated, phrase: wanted };
  if (!wanted) return empty;

  const needle = wanted.toLowerCase();
  const hits: WpHit[] = [];
  for (const rec of file.records) {
    if (!rec.source) continue;
    if (!rec.source.toLowerCase().includes(needle)) continue;
    const { source: _omit, ...rest } = rec;
    hits.push({ ...rest, context: contextFor(rec.source, needle) });
  }

  return { ...empty, hits };
}
