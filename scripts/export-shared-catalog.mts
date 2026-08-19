/**
 * Write the shareable half of a catalogue — which programs are known, and
 * which are published — for shipping inside the app.
 *
 *   npx tsx scripts/export-shared-catalog.mts <catalogDir> [outFile]
 *
 * The app has the same command under File, and both come through
 * buildKnownProgramsCsv so the two cannot drift apart.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildKnownProgramsCsv } from '../electron/catalog-status';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: export-shared-catalog.mts <catalogDir> [outFile]');
  process.exit(1);
}
const out = process.argv[3] ?? path.join('electron', 'data', 'known-programs.csv');

const built = buildKnownProgramsCsv(dir);
if (!built) {
  console.error(`no catalog.csv in ${dir}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, built.text);

console.log(`${built.rows} programs -> ${out}`);
console.log(`  ${built.archived} marked archived, ${built.matched} matched by name,`
  + ` ${built.rows - built.archived - built.matched} neither`);
console.log(`  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
