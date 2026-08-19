/**
 * Record by hand that a program has been archived — or deliberately will not
 * be — alongside what the name matching guessed.
 *
 *   npx tsx scripts/mark-archived.mts <catalogDir> <id...> [options]
 *   ... | npx tsx scripts/mark-archived.mts <catalogDir> -          (ids on stdin)
 *
 *   --status archived | not-archived | skip     default: archived
 *   --note "..."                                why, for your future self
 *   --clear                                     forget the mark instead
 *   --list                                      show what is marked
 *
 * Marks are keyed by the program id, which is the head of the SHA-256 of the
 * program's bytes. That is deliberate: a rebuild of the catalogue produces the
 * same id for the same content, so marks survive re-running the build. Keying
 * by title or by row would lose them.
 *
 * The file is kept separate from catalog.json so a rebuild never overwrites
 * work that only you could have done.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Mark { status: string; note?: string; markedAt: string }
interface Marks { generated: string; marks: Record<string, Mark> }

const VALID = new Set(['archived', 'not-archived', 'skip']);

const argv = process.argv.slice(2);
const dir = argv.shift();
if (!dir) {
  console.error('usage: mark-archived.mts <catalogDir> <id...> [--status archived|not-archived|skip] [--note "..."] [--clear] [--list]');
  process.exit(1);
}

const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : '';
};

const clear = argv.includes('--clear');
const list = argv.includes('--list');
const status = flag('status') || 'archived';
const note = flag('note') || undefined;
const ids = argv.filter((a) => !a.startsWith('--') && a !== '-');

if (!VALID.has(status)) {
  console.error(`--status must be one of: ${[...VALID].join(', ')}`);
  process.exit(1);
}

const marksPath = path.join(dir, 'marks.json');
const store: Marks = fs.existsSync(marksPath)
  ? JSON.parse(fs.readFileSync(marksPath, 'utf-8'))
  : { generated: new Date().toISOString(), marks: {} };

// Titles, so the confirmation names what was marked rather than a bare hash.
const titleById = new Map<string, string>();
const catalogPath = path.join(dir, 'catalog.json');
if (fs.existsSync(catalogPath)) {
  const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  for (const p of cat.programs) titleById.set(p.id, p.title);
}

if (list) {
  const entries = Object.entries(store.marks);
  if (entries.length === 0) { console.log('nothing marked yet'); process.exit(0); }
  console.log(`${entries.length} marked:\n`);
  for (const [id, m] of entries.sort((a, b) => a[1].status.localeCompare(b[1].status))) {
    console.log(`  ${id}  ${m.status.padEnd(13)} ${(titleById.get(id) ?? '?').slice(0, 32).padEnd(32)} ${m.note ?? ''}`);
  }
  process.exit(0);
}

// Ids may come as arguments or on stdin, so a marking pass can be piped
// straight out of todo.csv.
if (argv.includes('-') || ids.length === 0) {
  const stdin = fs.readFileSync(0, 'utf-8');
  for (const line of stdin.split('\n')) {
    const id = line.trim().split(',')[0];
    if (/^[0-9a-f]{8}$/.test(id)) ids.push(id);
  }
}

if (ids.length === 0) {
  console.error('no ids given (pass them as arguments, or pipe them in and use -)');
  process.exit(1);
}

let changed = 0; let unknown = 0;
for (const id of ids) {
  if (titleById.size > 0 && !titleById.has(id)) {
    console.error(`  ! ${id} is not in this catalogue — skipped`);
    unknown++;
    continue;
  }
  if (clear) {
    if (store.marks[id]) { delete store.marks[id]; changed++; }
  } else {
    store.marks[id] = { status, ...(note ? { note } : {}), markedAt: new Date().toISOString() };
    changed++;
  }
}

store.generated = new Date().toISOString();
fs.writeFileSync(marksPath, JSON.stringify(store, null, 2) + '\n');

console.log(clear
  ? `cleared ${changed} mark(s)`
  : `marked ${changed} program(s) as ${status}${note ? ` — "${note}"` : ''}`);
if (unknown) console.log(`${unknown} id(s) were not in the catalogue`);
console.log(`${Object.keys(store.marks).length} marked in total → ${marksPath}`);
console.log('\nRe-render to see it:  npx tsx scripts/render-catalog.mts ' + dir);
