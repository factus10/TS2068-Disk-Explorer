/**
 * Export the shareable half of a catalogue: which programs are known to the
 * collection, and which of them have been published.
 *
 *   npx tsx scripts/export-shared-catalog.mts <catalogDir> [outFile]
 *
 * Default output is electron/data/known-programs.csv, which ships inside the
 * app — so someone with no catalogue of their own still opens a freshly imaged
 * disk and is told whether its contents are new.
 *
 * Deliberately not occurrences.csv. That file is keyed by one person's folder
 * layout, which cannot match a disk somebody else has just imaged, and it
 * rewrites wholesale on every rebuild. What travels well is the identity of a
 * program and nothing about where it happens to live.
 */

import * as fs from 'fs';
import * as path from 'path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: export-shared-catalog.mts <catalogDir> [outFile]');
  process.exit(1);
}
const out = process.argv[3] ?? path.join('electron', 'data', 'known-programs.csv');

interface Program {
  id: string; title: string; type: string; size: number;
  isScreen: boolean; isFont: boolean; isUdg: boolean;
  basic: null | { loads: string[] };
  occurrences: unknown[];
}

const cat = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf-8')) as {
  generated: string; programs: Program[];
};

const marks: Record<string, { status: string }> = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'marks.json'), 'utf-8')).marks ?? {}; }
  catch { return {}; }
})();

const exact = new Set<string>((() => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(dir, 'matches.json'), 'utf-8')).matches ?? [])
      .filter((m: { exact: boolean }) => m.exact)
      .map((m: { programId: string }) => m.programId);
  } catch { return []; }
})());

const kindOf = (p: Program) =>
  p.isScreen ? 'screen' : p.isFont ? 'font' : p.isUdg ? 'UDG'
    : p.basic?.loads.length ? 'loader' : p.type;

const csv = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Sorted by id so a refresh produces a minimal diff rather than reshuffling
// 7,000 lines every time the catalogue is rebuilt.
const rows = [...cat.programs].sort((a, b) => a.id.localeCompare(b.id));

const lines = ['id,title,kind,size,copies,archived'];
for (const p of rows) {
  const archived = marks[p.id]?.status === 'archived' ? 'yes'
    : exact.has(p.id) ? 'matched' : '';
  lines.push([p.id, p.title, kindOf(p), p.size, p.occurrences.length, archived].map(csv).join(','));
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');

const archived = rows.filter((p) => marks[p.id]?.status === 'archived').length;
const matched = rows.filter((p) => !marks[p.id] && exact.has(p.id)).length;
console.log(`${rows.length} programs -> ${out}`);
console.log(`  ${archived} marked archived, ${matched} matched by name, ${rows.length - archived - matched} neither`);
console.log(`  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
