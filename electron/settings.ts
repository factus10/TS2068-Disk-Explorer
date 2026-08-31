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

  /**
   * Which images in a folder have had a full export, so the app can offer to
   * mark the folder once the last one is done. Keyed by folder, holding bare
   * filenames. A folder's record is dropped the moment it is marked, so this
   * only carries folders that are partway through — plus any the reader
   * declined to mark, which are remembered so the offer does not nag.
   */
  exportProgress?: Record<string, { exported: string[]; declined?: boolean }>;

  /**
   * A catalogue built by scripts/build-catalog.mts. When set, the file browser
   * shows how much of each disk is already archived, and can mark it.
   */
  catalogDir?: string;

  /**
   * Whether taking a program out of an image also marks it archived —
   * extracting, a package, or an archive.org bundle alike. On by default,
   * because marking by hand afterwards gets forgotten.
   */
  markArchivedOnExport?: boolean;

  /** What the last check of the published program list saw. */
  catalogUpdate?: { etag?: string; checkedAt?: string; rows?: number };

  /**
   * Check for a newer published program list when the app starts. Off unless
   * asked for: it is a network request the reader did not initiate.
   */
  autoCheckCatalogUpdate?: boolean;

  /**
   * The WordPress site holding the published archive, as a base URL — a local
   * copy of it, usually. With one set, the app can say whether a program is
   * already published, search the archive by name or by a line of its
   * listing, and refresh the catalogue's matches from it.
   *
   * Unset by default: it is a network address the reader has to give, and
   * nothing here should guess at one and start making requests.
   */
  wordpressUrl?: string;

  /**
   * Where hand-taken screenshots live, for attaching to a published record.
   * Defaults to the same folder the CSV importer looks in, since they are the
   * same screenshots.
   */
  screenshotsDir?: string;

  /**
   * The WordPress user whose application password the app publishes with.
   * Only meaningful alongside wordpressPassword.
   */
  wordpressUser?: string;

  /**
   * That application password, encrypted against the OS keychain — see
   * wordpress-credentials.ts. Never the password itself, and never read
   * outside the main process.
   */
  wordpressPassword?: string;

  /**
   * The emulator binary used by Run. Only worth storing when ZEsarUX is
   * somewhere unusual: with nothing set the app looks in the places it
   * installs itself, so most readers never see this setting.
   */
  emulatorPath?: string;
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
    // Like extractionDir, a catalogue that has gone is dropped: showing
    // archive counts from a folder that is no longer there would be a lie.
    if (typeof raw.catalogDir === 'string' && raw.catalogDir) {
      try {
        if (fs.statSync(path.join(raw.catalogDir, 'occurrences.csv')).isFile()) out.catalogDir = raw.catalogDir;
      } catch { /* gone, or not a catalogue; leave it unset */ }
    }
    if (typeof raw.markArchivedOnExport === 'boolean') out.markArchivedOnExport = raw.markArchivedOnExport;
    // An emulator that has been uninstalled is dropped rather than kept, so
    // the app falls back to looking for one instead of reporting a path that
    // cannot run.
    if (typeof raw.emulatorPath === 'string' && raw.emulatorPath) {
      try {
        fs.accessSync(raw.emulatorPath, fs.constants.X_OK);
        out.emulatorPath = raw.emulatorPath;
      } catch { /* gone; leave it unset */ }
    }
    // Only http and https are kept. A stored address is handed to fetch and
    // its host is opened in a browser, so a `file:` or a custom scheme here
    // would be a stored instruction rather than a setting.
    if (typeof raw.wordpressUrl === 'string' && raw.wordpressUrl) {
      try {
        const { protocol } = new URL(raw.wordpressUrl);
        if (protocol === 'http:' || protocol === 'https:') {
          out.wordpressUrl = raw.wordpressUrl.replace(/\/+$/, '');
        }
      } catch { /* not a URL; leave it unset */ }
    }
    // Like the extraction folder, a folder that has gone is dropped rather
    // than kept: offering screenshots from somewhere that no longer exists
    // would be worse than offering none.
    if (typeof raw.screenshotsDir === 'string' && raw.screenshotsDir) {
      try {
        if (fs.statSync(raw.screenshotsDir).isDirectory()) out.screenshotsDir = raw.screenshotsDir;
      } catch { /* gone; leave it unset */ }
    }
    if (typeof raw.wordpressUser === 'string' && raw.wordpressUser) out.wordpressUser = raw.wordpressUser;
    if (typeof raw.wordpressPassword === 'string' && raw.wordpressPassword) {
      out.wordpressPassword = raw.wordpressPassword;
    }
    if (typeof raw.autoCheckCatalogUpdate === 'boolean') out.autoCheckCatalogUpdate = raw.autoCheckCatalogUpdate;
    if (raw.catalogUpdate && typeof raw.catalogUpdate === 'object') {
      const u = raw.catalogUpdate as Record<string, unknown>;
      out.catalogUpdate = {
        ...(typeof u.etag === 'string' ? { etag: u.etag } : {}),
        ...(typeof u.checkedAt === 'string' ? { checkedAt: u.checkedAt } : {}),
        ...(typeof u.rows === 'number' ? { rows: u.rows } : {}),
      };
    }
    if (raw.exportProgress && typeof raw.exportProgress === 'object') {
      const progress: Record<string, { exported: string[]; declined?: boolean }> = {};
      for (const [dir, value] of Object.entries(raw.exportProgress as Record<string, unknown>)) {
        const rec = value as { exported?: unknown; declined?: unknown };
        const exported = Array.isArray(rec?.exported)
          ? rec.exported.filter((n): n is string => typeof n === 'string')
          : [];
        if (exported.length === 0 && rec?.declined !== true) continue;
        progress[dir] = rec?.declined === true ? { exported, declined: true } : { exported };
      }
      if (Object.keys(progress).length > 0) out.exportProgress = progress;
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
