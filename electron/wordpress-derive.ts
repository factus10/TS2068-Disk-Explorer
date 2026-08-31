/**
 * What the app can work out for itself before asking.
 *
 * Cataloguing a program means answering the same handful of questions about
 * it, and three of them are already settled by the time anyone is asked: the
 * machine follows from the disk it came off, the BASIC keywords are in the
 * program's own bytes, and the machine and year tags follow from those two.
 * Deriving them is not a guess — it is reading what is already known.
 *
 * Everything here is a *suggestion*. The dialog pre-ticks what this returns
 * and the reader can untick any of it; nothing is assigned unseen. And
 * nothing here invents a vocabulary term: a keyword the site has never heard
 * of is reported as unmatched rather than created, so a controlled vocabulary
 * cannot grow by accident.
 */

import type { BasicListing } from './parsers/basic-detokenizer';
import { isZX81Format, type DiskFormat } from './parsers/types';

/** Token kinds that are a BASIC keyword rather than the reader's own text. */
const KEYWORD_TYPES = new Set(['statement', 'function', 'ts2068-kw', 'disk-cmd']);

/** The vocabulary's name for a program that carries its own characters. */
export const UDG_TERM = 'User Defined Graphics (UDG)';

/**
 * Every BASIC keyword the program actually uses, by the name the site's
 * `basic` vocabulary spells it with.
 *
 * The detokenizer's token text carries a trailing space on most keywords
 * (`'SCREEN$ '`, `'VAL$ '`) and none on a few (`'OPEN #'`), which is a
 * detail of how a listing is laid out rather than of what the keyword is
 * called — so it is trimmed away here.
 */
export function keywordsUsed(listing: BasicListing): string[] {
  const found = new Set<string>();
  let sawUdg = false;

  for (const line of listing.lines) {
    for (const token of line.tokens) {
      if (token.type === 'udg') { sawUdg = true; continue; }
      if (!KEYWORD_TYPES.has(token.type)) continue;
      const name = token.text.trim();
      if (name) found.add(name);
    }
  }

  if (sawUdg) found.add(UDG_TERM);
  return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * Which of those keywords the site already knows, and which it does not.
 *
 * The unmatched ones are worth showing rather than hiding: this vocabulary is
 * newly started, and a keyword used by a real program is exactly the kind of
 * term worth adding — but adding it is a decision, not a side effect of an
 * import.
 */
export function matchVocabulary(
  used: string[], vocabulary: { id: number; name: string }[],
): { matched: { id: number; name: string }[]; unmatched: string[] } {
  const byName = new Map(vocabulary.map((t) => [t.name.toLowerCase(), t]));
  const matched: { id: number; name: string }[] = [];
  const unmatched: string[] = [];

  for (const name of used) {
    const hit = byName.get(name.toLowerCase());
    if (hit) matched.push(hit); else unmatched.push(name);
  }
  return { matched, unmatched };
}

export interface ModelSuggestion {
  /** The vocabulary term to pre-tick. */
  name: string;
  /**
   * Other terms the same disk could reasonably mean. A ZX81 image says which
   * family the program is for but not which badge was on the case, and the
   * archive keeps Timex/Sinclair 1000 and Sinclair ZX81 as separate terms.
   */
  alternatives: string[];
}

/**
 * The machine a disk's programs were written for.
 *
 * The interface settles the family and no more. An Aerco or Larken ZX81 disk
 * was sold in the United States, where the machine on the desk was almost
 * always a TS1000 — so that is what is offered first, with the ZX81 beside it
 * rather than instead of it, because the disk itself cannot tell them apart.
 */
export function deriveModel(format: DiskFormat): ModelSuggestion | null {
  if (isZX81Format(format)) {
    return { name: 'Timex/Sinclair 1000', alternatives: ['Sinclair ZX81', 'Timex/Sinclair 1500'] };
  }
  switch (format) {
    case 'larken':
    case 'oliger-v1':
    case 'oliger-v2':
    case 'aerco-dos64':
    case 'tap':
    case 'tzx':
      return { name: 'Timex/Sinclair 2068', alternatives: ['Sinclair ZX Spectrum', 'Timex Computer 2068'] };
    case 'ql':
      return { name: 'Sinclair QL', alternatives: [] };
    default:
      // Aerco RP/M and Zebra CP/M are an operating system's files rather than
      // a machine's programs, and the vocabulary has no term for that.
      return null;
  }
}

/** The tag the archive files a machine's programs under. */
const MODEL_TAG: Record<string, string> = {
  'Timex/Sinclair 1000': 'TS 1000',
  'Timex/Sinclair 1500': 'TS 1500',
  'Timex/Sinclair 2068': 'TS 2068',
  'Sinclair ZX81': 'ZX81',
  'Sinclair QL': 'QL',
  'Sinclair ZX Spectrum': 'ZX Spectrum',
};

/**
 * Tags that follow from what is already settled: the machine, and the year if
 * one is known well enough to name.
 *
 * A year is only offered when it is a year. The archive writes an uncertain
 * date as `198x`, which is a useful thing to record in the date field and a
 * useless thing to tag with, so it is left out.
 */
export function deriveTags(model: string | null, year: string): string[] {
  const tags: string[] = [];
  const machine = model ? MODEL_TAG[model] : undefined;
  if (machine) tags.push(machine);
  if (/^\d{4}$/.test(year.trim())) tags.push(year.trim());
  return tags;
}
