/**
 * Turning a program's bytes into something a human can recognise: a title, the
 * text it says about itself, and the files that let you look at it.
 *
 * Shared by the full build and the incremental update so that a program added
 * later is described exactly like one added on the first pass. Two
 * implementations would drift, and the drift would be invisible — a catalogue
 * where old and new entries were characterised by different rules.
 */

import * as fs from 'fs';
import * as path from 'path';
import { detokenize } from './parsers/basic-detokenizer';
import type { BasicListing } from './parsers/basic-detokenizer';
import { readBasicListing as readZX81Listing } from './parsers/zx81-aerco';
import { decodeScreen, SCREEN_SIZE } from './parsers/screen-decoder';
import { encodePng } from './parsers/png-export';
import { buildTapFile } from './parsers/tap';
import { makeSafeFilename } from './parsers/utils';
import type { DiskFormat, FileEntry } from './parsers/types';

// ---------------------------------------------------------------- naming ----

/**
 * Filenames that are disk conventions rather than titles. A collection is full
 * of them — 148 different programs here are called AUTOSTART — so they must
 * never win over a title mined from the program's own content.
 */
const GENERIC_NAMES = new Set([
  'AUTOSTART', 'AUTO', 'L', 'LOAD', 'LOADER', 'MENU', 'BOOT', 'START', 'RUN',
  'FORMAT', 'README', 'READ ME', 'ME 1ST', 'ME1ST', 'CAT', 'DIR', 'COPY',
  'PROG', 'PROGRAM', 'A', 'B', 'C', '1', '2', '3', '0', 'TEST', 'TEMP', 'X',
]);

/** Strip the Larken/Oliger type suffix (.B1, .C$, .Cv …) from a catalogue name. */
export function baseName(name: string): string {
  return name.trim().replace(/\.[BCAbca][\w$]*$/, '').trim();
}

export function isGeneric(name: string): boolean {
  const n = baseName(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  return n === '' || GENERIC_NAMES.has(n) || /^[0-9]{1,3}$/.test(n);
}

/** Text worth showing a human, from the noisy strings a program contains. */
function cleanText(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface BasicClues {
  lineCount: number;
  autostart?: number;
  /** REM text, in program order. */
  rems: string[];
  /** String literals printed to the screen. */
  strings: string[];
  /** Names this program LOADs, which for a loader are its payload. */
  loads: string[];
  /** Machine-code entry points the program calls. */
  usrCalls: string[];
  preview: string;
}

export function mineBasic(listing: BasicListing): BasicClues {
  const rems: string[] = [];
  const strings: string[] = [];
  const loads: string[] = [];
  const usrCalls: string[] = [];

  for (const line of listing.lines) {
    const text = line.tokens.map((t) => t.text).join('');
    const rem = text.match(/\bREM\s+(.+)$/i);
    if (rem) {
      const t = cleanText(rem[1]);
      if (t.length >= 3) rems.push(t);
    }
    for (const m of text.matchAll(/"([^"]{2,60})"/g)) {
      const t = cleanText(m[1]);
      if (t && !/^[\s\-=*_.]+$/.test(t)) strings.push(t);
    }
    for (const m of text.matchAll(/LOAD\s*"([^"]*)"/gi)) {
      const t = cleanText(m[1]);
      if (t) loads.push(t);
    }
    for (const m of text.matchAll(/USR\s*([0-9]+)/gi)) usrCalls.push(m[1]);
  }

  const preview = listing.lines.slice(0, 6)
    .map((l) => `${l.lineNumber} ${l.tokens.map((t) => t.text).join('')}`)
    .join('\n');

  return {
    lineCount: listing.lines.length,
    autostart: listing.autostartLine,
    rems: [...new Set(rems)].slice(0, 8),
    strings: [...new Set(strings)].slice(0, 12),
    loads: [...new Set(loads)],
    usrCalls: [...new Set(usrCalls)].slice(0, 6),
    preview,
  };
}

/**
 * BASIC keywords, as they appear once detokenised. A REM holding these is a
 * fragment of program text rather than a title, and picking one produces
 * entries like `RANDOMIZE USR CODE "d":OPEN #VAL "4"` for a program actually
 * called LogiCall.
 */
const BASIC_WORDS = /\b(RANDOMIZE|USR|POKE|PEEK|GOTO|GO TO|GOSUB|OPEN|CLOSE|PRINT|INPUT|LET|DIM|VAL|CHR\$|STR\$|STEP|THEN|BORDER|PAPER|INK|CLEAR|LOAD|SAVE|VERIFY|MERGE|RUN|STOP|NEXT|FOR|IF|DATA|RESTORE|FORMAT|CAT|ERASE)\b/i;

/**
 * How much a string looks like the name of a program rather than a line of
 * one. Negative means "do not use as a title".
 */
function titleScore(s: string): number {
  const t = s.trim();
  if (t.length < 4 || t.length > 48) return -1;
  if (!/[A-Za-z]{3}/.test(t)) return -1;
  if (BASIC_WORDS.test(t)) return -1;
  const punct = (t.match(/[^A-Za-z0-9 .'&!?:_/-]/g) ?? []).length;
  if (punct / t.length > 0.15) return -1;
  if (/^[0-9\s.]+$/.test(t)) return -1;

  let score = 10;
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  score += Math.min(10, letters / 3);
  // Attribution and dates are strong evidence of a title line.
  if (/\b(19|20)\d{2}\b/.test(t)) score += 6;
  if (/\bby\b/i.test(t)) score += 4;
  if (/\bv(er)?\.?\s?\d/i.test(t)) score += 4;
  if (/^[A-Z][A-Za-z]/.test(t)) score += 2;
  score -= punct * 2;
  if (t.length > 34) score -= 4;
  return score;
}

function bestTitle(candidates: string[]): { text: string; score: number } | null {
  let best: { text: string; score: number } | null = null;
  for (const c of candidates) {
    const score = titleScore(c);
    if (score > 0 && (!best || score > best.score)) best = { text: c.trim(), score };
  }
  return best;
}

/**
 * The best title the evidence supports, and where it came from — recorded so a
 * guess is never mistaken for something the disk actually said.
 */
export function guessTitle(names: string[], clues: BasicClues | null): { title: string; source: string } {
  const realName = names.map(baseName).find((n) => n && !isGeneric(n));
  if (realName) return { title: realName, source: 'filename' };

  if (clues) {
    // A REM naming the program is the author's own words, so it outranks a
    // string that merely happened to be printed.
    const rem = bestTitle(clues.rems);
    const str = bestTitle(clues.strings);
    if (rem && (!str || rem.score >= str.score)) return { title: rem.text, source: 'REM' };
    if (str) return { title: str.text, source: 'PRINT' };
    if (clues.loads.length > 0) {
      return { title: `loader for ${clues.loads.join(', ')}`, source: 'LOAD' };
    }
  }
  return { title: names.map(baseName).find(Boolean) || '(untitled)', source: 'generic filename' };
}


/** The kind shown in the views: a screen, a font, a loader, or its raw type. */
export function kindOf(p: {
  isScreen: boolean; isFont: boolean; isUdg: boolean;
  basic: { loads: string[] } | null; type: string;
}): string {
  if (p.isScreen) return 'screen';
  if (p.isFont) return 'font';
  if (p.isUdg) return 'UDG';
  if (p.basic?.loads.length) return 'loader';
  return p.type;
}

/** Mine a BASIC program for what it says about itself, if it detokenises. */
export function cluesFor(format: DiskFormat, data: Buffer, entry: FileEntry): BasicClues | null {
  if (entry.type !== 'basic') return null;
  try {
    const listing: BasicListing = format === 'zx81-tzx' || format === 'zx81-aerco'
      ? readZX81Listing(data, entry)
      : detokenize(data, entry.params.varsOffset ?? entry.params.param2);
    return listing.lines.length > 0 ? mineBasic(listing) : null;
  } catch {
    // A listing that will not parse simply yields no clues.
    return null;
  }
}

export const TYPE_DIR: Record<string, string> = {
  basic: 'basic', code: 'code', 'num-array': 'arrays', 'str-array': 'arrays',
  state: 'state', data: 'data', module: 'code', exec: 'code', unknown: 'other',
};

export const PROGRAM_DIRS = ['basic', 'code', 'screens', 'arrays', 'state', 'data', 'other'];

export interface WritableProgram {
  id: string; title: string; type: string; size: number;
  isScreen: boolean; names: string[]; occurrences: unknown[];
  data: Buffer; entry: FileEntry; clues: BasicClues | null;
}

/**
 * Write the program itself, its listing, and its screen. Returns the path
 * written, relative to the catalogue.
 */
export function writeProgramFiles(outDir: string, p: WritableProgram): string {
  const dir = p.isScreen ? 'screens' : (TYPE_DIR[p.type] ?? 'other');
  const slug = makeSafeFilename(p.title).replace(/\s+/g, '_').slice(0, 40) || 'untitled';
  const rel = path.join('programs', dir, `${slug}-${p.id}`);
  fs.mkdirSync(path.join(outDir, 'programs', dir), { recursive: true });

  let written = `${rel}.bin`;
  try {
    if (['basic', 'code', 'num-array', 'str-array'].includes(p.type)) {
      fs.writeFileSync(path.join(outDir, `${rel}.tap`), buildTapFile(p.entry, p.data));
      written = `${rel}.tap`;
    } else {
      fs.writeFileSync(path.join(outDir, `${rel}.bin`), p.data);
    }
  } catch {
    fs.writeFileSync(path.join(outDir, `${rel}.bin`), p.data);
    written = `${rel}.bin`;
  }

  if (p.clues) {
    const body = [
      `; ${p.title}`,
      `; ${p.occurrences.length} cop${p.occurrences.length === 1 ? 'y' : 'ies'} in the collection`,
      `; filed as: ${p.names.join(' | ')}`,
      '',
      p.clues.preview,
      p.clues.lineCount > 6 ? `\n; …${p.clues.lineCount - 6} more lines` : '',
    ].join('\n');
    fs.writeFileSync(path.join(outDir, `${rel}.txt`), body + '\n');
  }

  // A screen is the fastest way to recognise a program, so render it.
  if (p.isScreen) {
    try {
      fs.writeFileSync(path.join(outDir, `${rel}.png`), encodePng(decodeScreen(p.data).rgba, 2));
    } catch { /* a screen that will not decode just has no thumbnail */ }
  }

  return written;
}

export { SCREEN_SIZE };
