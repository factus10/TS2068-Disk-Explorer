/**
 * "I am done archiving this folder", recorded in the folder itself.
 *
 * The mark is a hidden JSON file written into the folder, so it survives
 * everything that would break a path-keyed list held by the app: moving the
 * collection, renaming a folder, restoring a backup, or working from a second
 * machine. The file browser skips dotfiles, and so does Finder by default, so
 * it stays out of the way.
 *
 * A folder that cannot be written — read-only media, a mounted image — falls
 * back to app settings, keyed by path. That copy has all the fragility the
 * marker file avoids, so it is the fallback and never the first choice, and
 * the caller is told which one it got.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSettings, updateSettings } from './settings';
import { isSupportedFile } from './parsers/supported-formats';

export const MARKER_FILENAME = '.ts2068-archived';

/** What gets written into the folder. */
export interface ArchiveMarker {
  version: 1;
  /** ISO 8601, so the file stays readable by a human who finds it. */
  markedAt: string;
  /** Images in the folder at the time it was marked. */
  imageCount: number;
}

export interface FolderArchiveState {
  markedAt: string;
  /** Images counted when the mark was made. */
  imageCount: number;
  /** Images in the folder now. */
  currentCount: number;
  /** Images have been added since the mark — "done" is no longer true. */
  stale: boolean;
  /** The mark lives in app settings because the folder was not writable. */
  external: boolean;
}

/** The openable images sitting directly in a folder, not recursively. */
export function listImages(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((item) => !item.isDirectory() && isSupportedFile(item.name))
      .map((item) => item.name);
  } catch {
    return [];
  }
}

/** Count the openable images sitting directly in a folder, not recursively. */
export function countImages(dir: string): number {
  return listImages(dir).length;
}

function parseMarker(raw: string): ArchiveMarker | null {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (typeof data.markedAt !== 'string' || !data.markedAt) return null;
    const count = typeof data.imageCount === 'number' && data.imageCount >= 0
      ? Math.floor(data.imageCount)
      : 0;
    return { version: 1, markedAt: data.markedAt, imageCount: count };
  } catch {
    // A marker we cannot read is treated as absent rather than as a failure:
    // the folder is still perfectly usable, it just is not flagged.
    return null;
  }
}

function readMarkerFile(dir: string): ArchiveMarker | null {
  try {
    return parseMarker(fs.readFileSync(path.join(dir, MARKER_FILENAME), 'utf-8'));
  } catch {
    return null;
  }
}

function readSettingsMark(dir: string): ArchiveMarker | null {
  const entry = getSettings().archivedFolders?.[dir];
  return entry ? { version: 1, markedAt: entry.markedAt, imageCount: entry.imageCount } : null;
}

/**
 * How a folder stands, or null if it was never marked. The image count is
 * only taken for folders that carry a mark — an unmarked folder costs one
 * failed open rather than a directory scan.
 */
export function getFolderState(dir: string): FolderArchiveState | null {
  const fromFile = readMarkerFile(dir);
  const marker = fromFile ?? readSettingsMark(dir);
  if (!marker) return null;

  const currentCount = countImages(dir);
  return {
    markedAt: marker.markedAt,
    imageCount: marker.imageCount,
    currentCount,
    stale: currentCount > marker.imageCount,
    external: !fromFile,
  };
}

/**
 * Mark a folder, preferring the folder itself. `now` is passed in so the
 * caller owns the clock and a test can pin it.
 */
export function markFolder(dir: string, now: string): FolderArchiveState {
  const imageCount = countImages(dir);
  const marker: ArchiveMarker = { version: 1, markedAt: now, imageCount };

  // The per-image record exists only to decide when to offer the mark. Once
  // the folder is marked it has done its job, which is what keeps the store
  // to folders still in progress.
  forgetProgress(dir);

  try {
    fs.writeFileSync(path.join(dir, MARKER_FILENAME), JSON.stringify(marker, null, 2) + '\n');
    // A previous fallback entry would now shadow nothing, but leaving it
    // behind means unmarking has two places to clear. Drop it.
    forgetSettingsMark(dir);
    return { ...marker, currentCount: imageCount, stale: false, external: false };
  } catch {
    const archivedFolders = { ...getSettings().archivedFolders, [dir]: { markedAt: now, imageCount } };
    updateSettings({ archivedFolders });
    return { ...marker, currentCount: imageCount, stale: false, external: true };
  }
}

/** How far through a folder a run of exports has got. */
export interface FolderProgress {
  dir: string;
  /** Images in the folder that have had a full export. */
  exported: number;
  /** Images in the folder. */
  total: number;
  /** Every image is exported, the folder is not marked, and nobody declined. */
  offer: boolean;
}

function readProgress(dir: string): { exported: string[]; declined?: boolean } {
  return getSettings().exportProgress?.[dir] ?? { exported: [] };
}

function writeProgress(dir: string, value: { exported: string[]; declined?: boolean } | null): void {
  const current = getSettings().exportProgress ?? {};
  const exportProgress = { ...current };
  if (value) exportProgress[dir] = value;
  else delete exportProgress[dir];
  updateSettings({ exportProgress });
}

/**
 * Note that an image has had a full export, and say whether that finishes its
 * folder. Only a whole-disk export counts — extracting a few files says
 * nothing about being done with the disk.
 *
 * An empty folder never offers: "all zero images are exported" is true and
 * useless. Neither does one already marked, nor one whose mark was declined.
 */
export function recordImageExported(imagePath: string): FolderProgress {
  const dir = path.dirname(imagePath);
  const name = path.basename(imagePath);
  const images = listImages(dir);

  const record = readProgress(dir);
  // Keep only names still present, so a deleted image cannot hold a folder
  // permanently short of complete.
  const exported = [...new Set([...record.exported, name])].filter((n) => images.includes(n));
  writeProgress(dir, { exported, ...(record.declined ? { declined: true } : {}) });

  return {
    dir,
    exported: exported.length,
    total: images.length,
    offer: images.length > 0
      && exported.length >= images.length
      && !record.declined
      && getFolderState(dir) === null,
  };
}

/** Remember that the reader said no, so the offer is made once per folder. */
export function declineFolderOffer(dir: string): void {
  writeProgress(dir, { ...readProgress(dir), declined: true });
}

function forgetProgress(dir: string): void {
  if (getSettings().exportProgress?.[dir]) writeProgress(dir, null);
}

function forgetSettingsMark(dir: string): void {
  const current = getSettings().archivedFolders;
  if (!current?.[dir]) return;
  const archivedFolders = { ...current };
  delete archivedFolders[dir];
  updateSettings({ archivedFolders });
}

/** Remove the mark from wherever it lives. */
export function unmarkFolder(dir: string): void {
  try {
    fs.unlinkSync(path.join(dir, MARKER_FILENAME));
  } catch {
    // Not there, or not removable; the settings copy below may still be.
  }
  forgetSettingsMark(dir);
  // Unmarking says the folder wants doing again, so a past decline should not
  // go on suppressing the offer.
  forgetProgress(dir);
}
