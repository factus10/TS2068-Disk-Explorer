/**
 * User settings, stored as JSON in app userData.
 *
 * Follows the same shape as recent-files.ts rather than pulling in a settings
 * library: there is one setting, the file is small, and a read that fails for
 * any reason should leave the app working with defaults rather than stop it
 * opening a disk.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface Settings {
  /**
   * Where extractions go by default.
   *
   * Extraction writes a `.dis` beside each file it describes, so this is
   * also where a narrative pass will look — which is the reason to have it
   * settled once rather than chosen fresh each time.
   */
  extractionDir?: string;

  /**
   * Folders marked as archived that could not hold their own marker file,
   * keyed by absolute path. See archive-marker.ts: this is the fallback for
   * read-only media, not the normal home for the mark.
   */
  archivedFolders?: Record<string, { markedAt: string; imageCount: number }>;
}

function getFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(getFilePath(), 'utf-8'));
    if (!raw || typeof raw !== 'object') return {};
    const out: Settings = {};
    // Only accept a directory that is still there. A saved path can outlive
    // the folder it names — an unplugged drive, a cleared Downloads — and
    // silently writing an extraction somewhere else, or failing at the point
    // of use, are both worse than falling back to asking.
    if (typeof raw.extractionDir === 'string' && raw.extractionDir) {
      try {
        if (fs.statSync(raw.extractionDir).isDirectory()) out.extractionDir = raw.extractionDir;
      } catch { /* gone; leave it unset */ }
    }
    // Unlike the extraction folder, a missing folder is not pruned here. An
    // unplugged drive would otherwise lose every mark it carried the moment
    // the app read its settings while the drive was away.
    if (raw.archivedFolders && typeof raw.archivedFolders === 'object') {
      const marks: Record<string, { markedAt: string; imageCount: number }> = {};
      for (const [dir, value] of Object.entries(raw.archivedFolders as Record<string, unknown>)) {
        const mark = value as { markedAt?: unknown; imageCount?: unknown };
        if (typeof mark?.markedAt !== 'string' || !mark.markedAt) continue;
        marks[dir] = {
          markedAt: mark.markedAt,
          imageCount: typeof mark.imageCount === 'number' && mark.imageCount >= 0
            ? Math.floor(mark.imageCount)
            : 0,
        };
      }
      if (Object.keys(marks).length > 0) out.archivedFolders = marks;
    }
    return out;
  } catch {
    return {};
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  // An explicit undefined clears the setting rather than storing a null.
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    if (patch[key] === undefined) delete next[key];
  }
  try {
    fs.writeFileSync(getFilePath(), JSON.stringify(next, null, 2));
  } catch {
    // A settings write that fails must not stop the extraction it came from.
  }
  return next;
}
