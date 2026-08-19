/**
 * Keeping the shipped list of known programs current between app releases.
 *
 * The list travels inside the app, which is enough on the day it is installed
 * and steadily less so afterwards as the collection grows. This fetches the
 * copy on the repository's main branch and, when it differs, keeps it in the
 * app's own data directory — a packaged app cannot write inside its own
 * bundle, and should not try.
 *
 * "Differs" is decided by the ETag the server returns, which is a hash of the
 * content. Sending it back as If-None-Match means an unchanged file costs a
 * 304 and no body at all, so a check is cheap enough to be routine.
 */

import * as fs from 'fs';
import * as path from 'path';

export const CATALOG_URL =
  'https://raw.githubusercontent.com/factus10/TS2068-Disk-Explorer/main/electron/data/known-programs.csv';

export interface UpdateCheck {
  /** A newer list is available and has been fetched into memory. */
  available: boolean;
  /** Programs in the fetched list, for saying what the change amounts to. */
  rows?: number;
  /** Programs in the list currently in use. */
  currentRows?: number;
  etag?: string;
  /** Set when the check could not be made; the caller should say so plainly. */
  error?: string;
  text?: string;
}

/** Rows in a known-programs list, excluding its header. */
export function countRows(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) if (line.trim()) n++;
  return Math.max(0, n - 1);
}

/**
 * Ask whether the published list differs from `currentText`. `etag` is what a
 * previous check saw; passing it lets the server answer 304 without sending
 * the file again.
 */
export async function checkForUpdate(
  currentText: string | null, etag?: string, url = CATALOG_URL,
): Promise<UpdateCheck> {
  const currentRows = currentText ? countRows(currentText) : 0;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'user-agent': 'ts2068-disk-browser',
        ...(etag ? { 'if-none-match': etag } : {}),
      },
    });
  } catch (err: any) {
    return { available: false, currentRows, error: err?.message ?? 'network error' };
  }

  if (res.status === 304) return { available: false, currentRows, etag };
  if (!res.ok) return { available: false, currentRows, error: `HTTP ${res.status}` };

  const text = await res.text();
  if (!text.startsWith('id,')) {
    // Whatever came back is not a program list — a proxy page, or a 404 body
    // served with a 200. Refusing it beats replacing good data with rubbish.
    return { available: false, currentRows, error: 'the downloaded file is not a program list' };
  }

  const newEtag = res.headers.get('etag') ?? undefined;
  if (currentText !== null && text === currentText) {
    return { available: false, currentRows, etag: newEtag };
  }

  return { available: true, rows: countRows(text), currentRows, etag: newEtag, text };
}

/** Store a fetched list where the app will prefer it over its bundled copy. */
export function saveUpdate(userDataDir: string, text: string): string {
  const target = path.join(userDataDir, 'known-programs.csv');
  fs.writeFileSync(target, text);
  return target;
}

/** Forget a downloaded list, falling back to the copy that ships with the app. */
export function clearUpdate(userDataDir: string): void {
  try { fs.unlinkSync(path.join(userDataDir, 'known-programs.csv')); } catch { /* not there */ }
}
