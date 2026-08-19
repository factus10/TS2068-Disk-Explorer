/**
 * Fold newly imaged disks into a catalogue from the command line.
 *
 *   npx tsx scripts/update-catalog.mts <root> <catalogDir> [--dry-run]
 *
 * The app does this too, under File → Add New Disks to Catalogue, and both go
 * through the same implementation in electron/catalog-ingest.ts. This wrapper
 * exists for scripting a batch; the app is the place to do it by hand.
 */

import * as path from 'path';
import { surveyCollection, ingestImages, readCatalogFile } from '../electron/catalog-ingest';

const root = process.argv[2];
const outDir = process.argv[3];
const dryRun = process.argv.includes('--dry-run');
if (!root || !outDir) {
  console.error('usage: update-catalog.mts <root> <catalogDir> [--dry-run]');
  process.exit(1);
}

const cat = readCatalogFile(outDir);
if (!cat) {
  console.error(`no catalog.json in ${outDir} — use build-catalog.mts for a first pass`);
  process.exit(1);
}
if (path.resolve(cat.root) !== path.resolve(root)) {
  // Occurrence paths are relative to the recorded root; folding in paths
  // relative to a different one would produce a half-matching catalogue.
  console.error('the catalogue was built from a different collection root:');
  console.error(`  catalogue: ${cat.root}`);
  console.error(`  given    : ${root}`);
  process.exit(1);
}

const survey = surveyCollection(outDir, root)!;
console.log(`catalogue: ${cat.programs.length} programs across ${survey.imagesKnown} images`);
console.log(`collection: ${survey.imagesOnDisk} images on disk`);
console.log(`  new to the catalogue: ${survey.fresh.length}`);
console.log(`  catalogued but not on disk: ${survey.gone.length}${survey.gone.length ? ' (left alone)' : ''}`);

if (survey.fresh.length === 0) {
  console.log('\nnothing to do');
  process.exit(0);
}
if (dryRun) {
  console.log(`\ndry run — would read ${survey.fresh.length} image(s)`);
  process.exit(0);
}

const result = ingestImages(outDir, root, survey.fresh, (done, total) => {
  if (done > 0 && done % 100 === 0) process.stderr.write(`  ${done}/${total}\n`);
})!;

console.log(`\nadded ${result.newPrograms} new program(s), ${result.newOccurrences} occurrence(s)`
  + ` from ${result.imagesAdded} image(s)`);
if (result.unreadable.length > 0) console.log(`${result.unreadable.length} image(s) could not be read`);
console.log(`catalogue now ${result.uniqueCount} programs across ${result.imageCount} images`);
