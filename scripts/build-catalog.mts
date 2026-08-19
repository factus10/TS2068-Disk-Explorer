/**
 * Build a de-duplicated, characterised catalogue of a collection of disk
 * images and tapes.
 *
 * Walks a tree, opens every image, extracts every program, and groups them by
 * the SHA-256 of their bytes. Each unique program is characterised from its
 * content rather than its filename, because in a real collection the filenames
 * are largely conventions — AUTOSTART, L, MENU, FORMAT — reused across
 * hundreds of unrelated disks and worth nothing as titles.
 *
 *   npx tsx scripts/build-catalog.mts <root> <outDir>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { detectFormat } from '../electron/parsers/detect';
import { isSupportedFile } from '../electron/parsers/supported-formats';
import { readCatalog as readLarken, readFileData as readLarkenFile } from '../electron/parsers/larken';
import { readCatalog as readOliger, readFileData as readOligerFile } from '../electron/parsers/oliger';
import { readCatalog as readAerco, readFileData as readAercoFile } from '../electron/parsers/aerco';
import { readCatalog as readZebra, readFileData as readZebraFile } from '../electron/parsers/zebra';
import { readCatalog as readQL, readFileData as readQLFile } from '../electron/parsers/ql';
import { readCatalog as readTap, readFileData as readTapFile } from '../electron/parsers/tap-reader';
import { readCatalog as readTzx, readFileData as readTzxFile } from '../electron/parsers/tzx-reader';
import { readCatalog as readSNA, readFileData as readSNAFile } from '../electron/parsers/sna-reader';
import { readCatalog as readZ80, readFileData as readZ80File } from '../electron/parsers/z80-reader';
import { readCatalog as readSCR, readFileData as readSCRFile } from '../electron/parsers/scr-reader';
import { readCatalog as readMGT, readFileData as readMGTFile } from '../electron/parsers/mgt-reader';
import { readCatalog as readZIP, readFileData as readZIPFile } from '../electron/parsers/zip-reader';
import {
  readCatalog as readZX81Aerco, readFileData as readZX81AercoFile, readBasicListing as readZX81Listing,
} from '../electron/parsers/zx81-aerco';
import { detokenize } from '../electron/parsers/basic-detokenizer';
import type { BasicListing } from '../electron/parsers/basic-detokenizer';
import { decodeScreen, SCREEN_SIZE } from '../electron/parsers/screen-decoder';
import { encodePng } from '../electron/parsers/png-export';
import { buildTapFile } from '../electron/parsers/tap';
import { makeSafeFilename } from '../electron/parsers/utils';
import type { DiskFormat, FileEntry, CatalogResult } from '../electron/parsers/types';

type Parser = {
  readCatalog: (buf: Buffer) => CatalogResult;
  readFileData: (buf: Buffer, entry: FileEntry) => Buffer | null;
};

function getParser(format: DiskFormat): Parser {
  switch (format) {
    case 'larken': return { readCatalog: readLarken, readFileData: readLarkenFile };
    case 'oliger-v1':
    case 'oliger-v2': return { readCatalog: readOliger, readFileData: readOligerFile };
    case 'aerco-dos64':
    case 'aerco-rpm': return { readCatalog: readAerco, readFileData: readAercoFile };
    case 'zebra-dirscp':
    case 'zebra-cpm': return { readCatalog: readZebra, readFileData: readZebraFile };
    case 'ql': return { readCatalog: readQL, readFileData: readQLFile };
    case 'zx81-aerco': return { readCatalog: readZX81Aerco, readFileData: readZX81AercoFile };
    case 'tap': return { readCatalog: readTap, readFileData: readTapFile };
    case 'tzx': return { readCatalog: readTzx, readFileData: readTzxFile };
    case 'sna': return { readCatalog: readSNA, readFileData: readSNAFile };
    case 'z80': return { readCatalog: readZ80, readFileData: readZ80File };
    case 'scr': return { readCatalog: readSCR, readFileData: readSCRFile };
    case 'mgt': return { readCatalog: readMGT, readFileData: readMGTFile };
    case 'zip': return { readCatalog: readZIP, readFileData: readZIPFile };
    default: throw new Error(`Unknown format: ${format}`);
  }
}

function flattenEntries(entries: FileEntry[]): FileEntry[] {
  const flat: FileEntry[] = [];
  for (const e of entries) {
    flat.push(e);
    if (e.children) flat.push(...e.children);
  }
  return flat;
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
function baseName(name: string): string {
  return name.trim().replace(/\.[BCAbca][\w$]*$/, '').trim();
}

function isGeneric(name: string): boolean {
  const n = baseName(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  return n === '' || GENERIC_NAMES.has(n) || /^[0-9]{1,3}$/.test(n);
}

/** Text worth showing a human, from the noisy strings a program contains. */
function cleanText(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface BasicClues {
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

function mineBasic(listing: BasicListing): BasicClues {
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
function guessTitle(names: string[], clues: BasicClues | null): { title: string; source: string } {
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

// ------------------------------------------------------------------ types ---

interface Occurrence {
  image: string;
  folder: string;
  format: DiskFormat;
  index: number;
  filename: string;
}

interface Program {
  hash: string;
  size: number;
  type: string;
  names: Set<string>;
  formats: Set<string>;
  occurrences: Occurrence[];
  data: Buffer;
  entry: FileEntry;
  clues: BasicClues | null;
  isScreen: boolean;
  isFont: boolean;
  isUdg: boolean;
  loadAddress?: number;
}

// ------------------------------------------------------------------- main ---

const root = process.argv[2];
const outDir = process.argv[3];
if (!root || !outDir) {
  console.error('usage: build-catalog.mts <root> <outDir>');
  process.exit(1);
}

const READ_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 32);

async function* readAhead(files: string[]): AsyncGenerator<[string, Buffer | Error]> {
  const inFlight = new Map<number, Promise<[string, Buffer | Error]>>();
  const start = (i: number) => {
    inFlight.set(i, fs.promises.readFile(files[i])
      .then((b) => [files[i], b] as [string, Buffer])
      .catch((e) => [files[i], e as Error] as [string, Error]));
  };
  let next = 0;
  for (; next < Math.min(READ_CONCURRENCY, files.length); next++) start(next);
  for (let i = 0; i < files.length; i++) {
    const r = await inFlight.get(i)!;
    inFlight.delete(i);
    if (next < files.length) start(next++);
    yield r;
  }
}

const images = walk(root);
console.log(`${images.length} images under ${root}`);

const programs = new Map<string, Program>();
const unreadable: { file: string; reason: string }[] = [];
let done = 0;
const started = Date.now();

for await (const [file, payload] of readAhead(images)) {
  done++;
  if (done % 500 === 0) {
    const rate = done / ((Date.now() - started) / 1000);
    process.stderr.write(`  read ${done}/${images.length}  ${rate.toFixed(0)}/s\n`);
  }
  if (payload instanceof Error) { unreadable.push({ file, reason: payload.message }); continue; }

  const format = detectFormat(payload, file);
  if (!format) { unreadable.push({ file, reason: 'format not recognised' }); continue; }

  let parser: Parser; let entries: FileEntry[];
  try {
    parser = getParser(format);
    entries = flattenEntries(parser.readCatalog(payload).entries);
  } catch (err: any) {
    unreadable.push({ file, reason: `catalog failed: ${err.message}` });
    continue;
  }

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let data: Buffer | null = null;
    try { data = parser.readFileData(payload, entry); } catch { /* skipped */ }
    if (!data || data.length === 0) continue;

    const hash = crypto.createHash('sha256').update(data).digest('hex');
    let p = programs.get(hash);
    if (!p) {
      let clues: BasicClues | null = null;
      if (entry.type === 'basic') {
        try {
          const listing = format === 'zx81-aerco'
            ? readZX81Listing(data, entry)
            : detokenize(data, entry.params.varsOffset ?? entry.params.param2);
          if (listing.lines.length > 0) clues = mineBasic(listing);
        } catch { /* a listing that will not parse simply yields no clues */ }
      }
      p = {
        hash, size: data.length, type: entry.type,
        names: new Set(), formats: new Set(), occurrences: [],
        data, entry, clues,
        isScreen: entry.type === 'code' && data.length === SCREEN_SIZE,
        isFont: entry.type === 'code' && data.length === 768,
        isUdg: entry.type === 'code' && data.length === 256,
        loadAddress: entry.params.param1,
      };
      programs.set(hash, p);
    }
    p.names.add(entry.filename.trim());
    p.formats.add(format);
    p.occurrences.push({
      image: path.relative(root, file),
      folder: path.dirname(path.relative(root, file)),
      format, index: entry.index, filename: entry.filename.trim(),
    });
  }
}

console.log(`\n${programs.size} unique programs from ${[...programs.values()].reduce((n, p) => n + p.occurrences.length, 0)} entries`);

// ----------------------------------------------------------------- write ----

const TYPE_DIR: Record<string, string> = {
  basic: 'basic', code: 'code', 'num-array': 'arrays', 'str-array': 'arrays',
  state: 'state', data: 'data', module: 'code', exec: 'code', unknown: 'other',
};

fs.mkdirSync(outDir, { recursive: true });
for (const d of ['basic', 'code', 'screens', 'arrays', 'state', 'data', 'other']) {
  fs.mkdirSync(path.join(outDir, 'programs', d), { recursive: true });
}

interface Row {
  hash8: string; title: string; titleSource: string; type: string; kind: string;
  size: number; copies: number; folders: number; names: string; autostart: string;
  lines: string; loads: string; rems: string; strings: string; file: string;
}

const rows: Row[] = [];
const list = [...programs.values()];

for (const p of list) {
  const hash8 = p.hash.slice(0, 8);
  const names = [...p.names];
  const { title, source } = guessTitle(names, p.clues);
  const kind = p.isScreen ? 'screen' : p.isFont ? 'font' : p.isUdg ? 'UDG'
    : p.clues?.loads.length ? 'loader' : p.type;

  const dir = p.isScreen ? 'screens' : (TYPE_DIR[p.type] ?? 'other');
  const slug = (makeSafeFilename(title).replace(/\s+/g, '_').slice(0, 40) || 'untitled');
  const stem = `${slug}-${hash8}`;
  const rel = path.join('programs', dir, stem);

  // The program itself. TAP where the type carries over, raw otherwise.
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

  // A readable listing for anything that detokenised.
  if (p.clues) {
    const body = [
      `; ${title}`,
      `; ${p.occurrences.length} cop${p.occurrences.length === 1 ? 'y' : 'ies'} in the collection`,
      `; filed as: ${names.join(' | ')}`,
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

  rows.push({
    hash8, title, titleSource: source, type: p.type, kind,
    size: p.size,
    copies: p.occurrences.length,
    folders: new Set(p.occurrences.map((o) => o.folder)).size,
    names: names.join(' | '),
    autostart: p.clues?.autostart != null ? String(p.clues.autostart) : '',
    lines: p.clues ? String(p.clues.lineCount) : '',
    loads: p.clues?.loads.join(' | ') ?? '',
    rems: p.clues?.rems.slice(0, 3).join(' / ') ?? '',
    strings: p.clues?.strings.slice(0, 5).join(' / ') ?? '',
    file: written,
  });
}

const csv = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

rows.sort((a, b) => b.copies - a.copies || a.title.localeCompare(b.title));

fs.writeFileSync(path.join(outDir, 'catalog.csv'),
  ['id,title,title_from,type,kind,size,copies,folders,filed_as,autostart,basic_lines,loads,rems,strings,file']
    .concat(rows.map((r) => [
      r.hash8, r.title, r.titleSource, r.type, r.kind, r.size, r.copies, r.folders,
      r.names, r.autostart, r.lines, r.loads, r.rems, r.strings, r.file,
    ].map(csv).join(',')))
    .join('\n') + '\n');

fs.writeFileSync(path.join(outDir, 'occurrences.csv'),
  ['id,title,image,folder,format,catalog_index,filed_as']
    .concat(list.flatMap((p) => {
      const { title } = guessTitle([...p.names], p.clues);
      return p.occurrences.map((o) => [
        p.hash.slice(0, 8), title, o.image, o.folder, o.format, o.index, o.filename,
      ].map(csv).join(','));
    }))
    .join('\n') + '\n');

// Same name, different bytes — the pile that needs a human eye.
const byName = new Map<string, string[]>();
for (const p of list) {
  for (const n of p.names) {
    const key = baseName(n).toUpperCase();
    if (!key || isGeneric(key)) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(p.hash.slice(0, 8));
  }
}
const variants = [...byName].filter(([, ids]) => new Set(ids).size > 1)
  .sort((a, b) => new Set(b[1]).size - new Set(a[1]).size);
fs.writeFileSync(path.join(outDir, 'variants.csv'),
  ['name,versions,ids'].concat(variants.map(([n, ids]) =>
    [n, new Set(ids).size, [...new Set(ids)].join(' ')].map(csv).join(','))).join('\n') + '\n');

fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify({
  root, generated: new Date().toISOString(),
  imageCount: images.length,
  entryCount: list.reduce((n, p) => n + p.occurrences.length, 0),
  uniqueCount: list.length,
  programs: list.map((p) => {
    const { title, source } = guessTitle([...p.names], p.clues);
    return {
      id: p.hash.slice(0, 8), sha256: p.hash, title, titleSource: source,
      type: p.type, size: p.size,
      isScreen: p.isScreen, isFont: p.isFont, isUdg: p.isUdg,
      names: [...p.names], formats: [...p.formats],
      basic: p.clues, occurrences: p.occurrences,
    };
  }),
  unreadable,
}, null, 2));

// A browsable index. Thumbnails are referenced rather than embedded, so the
// page stays small enough to open even with several thousand rows.
const esc = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>TS Collection Catalogue</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.45 system-ui, sans-serif; margin: 0; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #888; margin-bottom: 14px; }
  .controls { position: sticky; top: 0; background: Canvas; padding: 8px 0; border-bottom: 1px solid #8884; display: flex; gap: 8px; flex-wrap: wrap; z-index: 2; }
  input, select { font: inherit; padding: 5px 8px; border: 1px solid #8886; border-radius: 4px; background: Canvas; color: CanvasText; }
  #q { flex: 1; min-width: 240px; }
  table { border-collapse: collapse; width: 100%; margin-top: 10px; }
  th { text-align: left; border-bottom: 2px solid #8886; padding: 6px 8px; position: sticky; top: 46px; background: Canvas; cursor: pointer; user-select: none; }
  td { border-bottom: 1px solid #8883; padding: 6px 8px; vertical-align: top; }
  tr:hover td { background: #8881; }
  .title { font-weight: 600; }
  .clue { color: #888; font-size: 11px; display: block; max-width: 460px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; border: 1px solid #8886; }
  img { image-rendering: pixelated; border: 1px solid #8884; display: block; }
  a { color: inherit; }
  #count { color: #888; align-self: center; }
</style></head><body>
<h1>TS Collection Catalogue</h1>
<div class="meta">${esc(root)}<br>
${images.length} images &middot; ${list.reduce((n, p) => n + p.occurrences.length, 0)} entries &middot;
<strong>${rows.length} unique programs</strong> &middot; generated ${new Date().toISOString().slice(0, 10)}</div>
<div class="controls">
  <input id="q" placeholder="Search title, filenames, REMs, printed text&hellip;" autofocus>
  <select id="kind"><option value="">every kind</option>${
    [...new Set(rows.map((r) => r.kind))].sort().map((k) => `<option>${esc(k)}</option>`).join('')}</select>
  <select id="dupes"><option value="">any number of copies</option><option value="1">one-offs only</option><option value="2">duplicated only</option></select>
  <span id="count"></span>
</div>
<table id="t"><thead><tr>
<th data-k="title">Title</th><th data-k="kind">Kind</th><th data-k="size" class="n">Size</th>
<th data-k="copies" class="n">Copies</th><th data-k="folders" class="n">Folders</th><th>Preview</th>
</tr></thead><tbody>
${rows.map((r) => {
  const png = r.kind === 'screen' ? r.file.replace(/\.(tap|bin)$/, '.png') : null;
  const clues = [r.rems, r.strings, r.loads ? `LOADs ${r.loads}` : ''].filter(Boolean).join(' &middot; ');
  return `<tr data-s="${esc((r.title + ' ' + r.names + ' ' + r.rems + ' ' + r.strings + ' ' + r.loads).toLowerCase())}" data-kind="${esc(r.kind)}" data-copies="${r.copies}">
<td><a class="title" href="${esc(r.file)}">${esc(r.title)}</a>
<span class="clue">${esc(r.names)}</span>${clues ? `<span class="clue">${clues}</span>` : ''}</td>
<td><span class="badge">${esc(r.kind)}</span></td>
<td class="n">${r.size}</td><td class="n">${r.copies}</td><td class="n">${r.folders}</td>
<td>${png ? `<a href="${esc(png)}"><img src="${esc(png)}" width="128" loading="lazy"></a>` : ''}</td></tr>`;
}).join('\n')}
</tbody></table>
<script>
const rows = [...document.querySelectorAll('#t tbody tr')];
const q = document.getElementById('q'), kind = document.getElementById('kind'),
      dupes = document.getElementById('dupes'), count = document.getElementById('count');
function apply() {
  const t = q.value.toLowerCase().trim(), k = kind.value, d = dupes.value;
  let n = 0;
  for (const r of rows) {
    let ok = (!t || r.dataset.s.includes(t)) && (!k || r.dataset.kind === k);
    if (ok && d === '1') ok = r.dataset.copies === '1';
    if (ok && d === '2') ok = +r.dataset.copies > 1;
    r.hidden = !ok; if (ok) n++;
  }
  count.textContent = n + ' shown';
}
[q, kind, dupes].forEach((el) => el.addEventListener('input', apply));
let asc = {};
document.querySelectorAll('th[data-k]').forEach((th, i) => th.addEventListener('click', () => {
  const k = th.dataset.k; asc[k] = !asc[k];
  const body = document.querySelector('#t tbody');
  [...body.children].sort((a, b) => {
    const av = a.children[i].textContent.trim(), bv = b.children[i].textContent.trim();
    const an = parseFloat(av), bn = parseFloat(bv);
    const c = (!isNaN(an) && !isNaN(bn)) ? an - bn : av.localeCompare(bv);
    return asc[k] ? c : -c;
  }).forEach((r) => body.appendChild(r));
}));
apply();
</script></body></html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);

fs.writeFileSync(path.join(outDir, 'README.md'), `# TS Collection Catalogue

Generated ${new Date().toISOString().slice(0, 10)} from \`${root}\`.

${images.length} images held ${list.reduce((n, p) => n + p.occurrences.length, 0)} program entries,
which de-duplicate to **${rows.length} unique programs** by SHA-256 of their bytes.

| File | What it is |
|---|---|
| \`index.html\` | Start here. Searchable, sortable, with screen thumbnails. |
| \`catalog.csv\` | One row per unique program, sorted by how many copies exist. |
| \`occurrences.csv\` | Every copy: which image and folder it came from. |
| \`variants.csv\` | Names carrying more than one distinct version — these need your eye. |
| \`catalog.json\` | Everything above, machine-readable. |
| \`programs/\` | One extracted copy of each unique program, sharded by kind. |

## Reading the catalogue

**\`title\` is a guess, and \`title_from\` says how good a guess.** \`filename\` means the
disk said so. \`REM\`, \`PRINT\` and \`LOAD\` mean it was mined from the program's own
content because the filename was a convention rather than a name — this collection has
148 different programs called AUTOSTART, so filenames alone identify very little.
\`generic filename\` means nothing better was found and the title should not be trusted.

**\`rems\` and \`strings\`** are what the program says about itself. They are the fastest
way to work out what something is, and they often carry an author and a date.

**\`copies\` and \`folders\`** show how far a program spread. A high count usually means a
loader or a utility that travelled with many disks rather than something rare.

Nothing was written back to the source collection; this directory is entirely derived.
`);

console.log(`catalog.csv        ${rows.length} rows`);
console.log(`occurrences.csv    ${list.reduce((n, p) => n + p.occurrences.length, 0)} rows`);
console.log(`variants.csv       ${variants.length} names with more than one version`);
console.log(`screens rendered   ${rows.filter((r) => r.kind === 'screen').length}`);
console.log(`listings written   ${rows.filter((r) => r.lines !== '').length}`);
console.log(`titles from content ${rows.filter((r) => r.titleSource !== 'filename' && r.titleSource !== 'generic filename').length}`);
console.log(`\nwritten to ${outDir}`);
