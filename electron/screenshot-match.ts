/**
 * Finding the screenshots that belong to a program.
 *
 * Screenshots are taken by hand into one flat folder and named however the
 * moment suggested — `i ching.png`, `3d-word-1.png` — while the program is
 * known by its disk filename or its published title. Matching the two is what
 * the CSV importer's WCMI_Matcher does, and the rules here are a port of it,
 * thresholds and all, so a screenshot the importer would have attached is the
 * one this offers.
 *
 * The grading matters more than the matching. Below 80% the suggestions stop
 * being trustworthy — `invert` scores 71% against `invaders` — so those are
 * offered and never ticked, and anything under 68% is not offered at all. A
 * wrong screenshot on a record is worse than none, because nobody checks a
 * picture that looks plausible.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Pre-ticked at or above this; the importer's AUTOFILL_THRESHOLD. */
export const AUTOFILL_THRESHOLD = 80;

/** Offered but never ticked at or above this; the importer's SUGGEST_THRESHOLD. */
export const SUGGEST_THRESHOLD = 68;

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif']);

export type MatchGrade = 'exact' | 'likely' | 'check';

export interface ScreenshotMatch {
  /** Absolute path, for uploading. */
  file: string;
  name: string;
  score: number;
  grade: MatchGrade;
}

/** Lowercased, stripped of a known extension and of everything but a-z0-9. */
export function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.(png|jpe?g|gif|txt|tap|tzx|zip)$/, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * The stem a multi-shot set shares: `3d-word-1.png` and `3d-word-2.png` are
 * one program. The separator before the digits is required, so `64column.png`
 * and `textwriter2000.png` keep their numbers.
 */
export function screenshotBase(file: string): string {
  const stem = path.basename(file, path.extname(file));
  return normalise(stem.replace(/[-_ ]\d{1,2}$/, ''));
}

/** Drops the `(1985)(Howard, Bob)(TS2068)…` tail from an archive name. */
export function stripArchiveSuffix(stem: string): string {
  return stem.replace(/\s*\(.*$/, '').trim();
}

/**
 * PHP's `similar_text`, which is what the importer grades with.
 *
 * Longest common substring, then the same again on what lies either side of
 * it. Reimplemented rather than approximated because the thresholds were
 * chosen against these numbers, and a different similarity measure would move
 * every borderline case.
 */
function similarChars(a: string, b: string): number {
  if (!a.length || !b.length) return 0;

  let max = 0;
  let pos1 = 0;
  let pos2 = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let l = 0;
      while (i + l < a.length && j + l < b.length && a[i + l] === b[j + l]) l++;
      if (l > max) { max = l; pos1 = i; pos2 = j; }
    }
  }
  if (max === 0) return 0;

  return max
    + similarChars(a.slice(0, pos1), b.slice(0, pos2))
    + similarChars(a.slice(pos1 + max), b.slice(pos2 + max));
}

/**
 * How alike two normalised names are, 0-100.
 *
 * The prefix rule is the importer's: when one name opens the other and the
 * shorter is at least four characters, the score is lifted to 80 so that a
 * truncated disk filename still reaches its screenshot.
 */
export function score(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;

  let percent = (similarChars(a, b) * 2) / (a.length + b.length) * 100;
  const shortest = Math.min(a.length, b.length);
  if (shortest >= 4 && (a.startsWith(b) || b.startsWith(a))) percent = Math.max(percent, 80);

  return Math.round(percent);
}

/** Every screenshot in the folder, sorted the way a person would sort them. */
export function listScreenshots(dir: string): { file: string; name: string }[] {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }

  return names
    .filter((n) => n && !n.startsWith('.') && EXTENSIONS.has(path.extname(n).toLowerCase()))
    .filter((n) => {
      try { return fs.statSync(path.join(dir, n)).isFile(); } catch { return false; }
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((n) => ({ file: path.join(dir, n), name: n }));
}

/**
 * The screenshots that look like they belong to this program.
 *
 * `keys` are every name the program is known by — its disk filename, the
 * title being published, the archive name with its suffix taken off. The best
 * score across those keys is the one that counts, since a screenshot named
 * after any of them is equally a hit.
 *
 * A whole set is returned together: matching `3d-word-1.png` means
 * `3d-word-2.png` belongs too, and offering one without the other would look
 * like the second was rejected.
 */
export function matchScreenshots(
  dir: string, keys: string[], limit = 8,
): ScreenshotMatch[] {
  const wanted = [...new Set(keys.map(normalise).filter(Boolean))];
  if (wanted.length === 0) return [];

  const best = new Map<string, number>();   // set base -> score
  const files = listScreenshots(dir);

  for (const f of files) {
    const base = screenshotBase(f.name);
    if (!base) continue;
    const s = Math.max(...wanted.map((k) => score(k, base)));
    if (s > (best.get(base) ?? 0)) best.set(base, s);
  }

  const out: ScreenshotMatch[] = [];
  for (const f of files) {
    const base = screenshotBase(f.name);
    const s = best.get(base) ?? 0;
    if (s < SUGGEST_THRESHOLD) continue;
    out.push({
      file: f.file,
      name: f.name,
      score: s,
      grade: s === 100 ? 'exact' : s >= AUTOFILL_THRESHOLD ? 'likely' : 'check',
    });
  }

  // Best first, and within a set the order the files sort in, so a numbered
  // set reads 1, 2, 3.
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return out.slice(0, limit);
}
