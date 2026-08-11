import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The settings fallback reads app.getPath('userData'), Electron-only.
let userData = '';
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const load = async () => {
  vi.resetModules();
  return import('../electron/archive-marker');
};

let collection = '';

/** A folder holding `count` openable images plus one file the app cannot open. */
function makeFolder(count: number): string {
  const dir = fs.mkdtempSync(path.join(collection, 'folder-'));
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(dir, `disk${i}.img`), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a disk');
  return dir;
}

const AT = '2026-03-04T10:00:00.000Z';

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ts2068-marker-settings-'));
  collection = fs.mkdtempSync(path.join(os.tmpdir(), 'ts2068-marker-'));
});
afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(collection, { recursive: true, force: true });
});

describe('marking a folder as archived', () => {
  it('reports nothing for a folder that was never marked', async () => {
    const { getFolderState } = await load();
    expect(getFolderState(makeFolder(3))).toBeNull();
  });

  it('writes the mark into the folder, not into app settings', async () => {
    const { markFolder, MARKER_FILENAME } = await load();
    const dir = makeFolder(3);
    const state = markFolder(dir, AT);

    // The point of the whole design: the mark travels with the folder.
    expect(fs.existsSync(path.join(dir, MARKER_FILENAME))).toBe(true);
    expect(state.external).toBe(false);
    expect(state.markedAt).toBe(AT);
  });

  it('counts only the files the app can actually open', async () => {
    const { markFolder } = await load();
    // The folder also holds notes.txt; counting it would report a phantom
    // "new image" the reader could never open.
    expect(markFolder(makeFolder(3), AT).imageCount).toBe(3);
  });

  it('reads back a mark it wrote', async () => {
    const { markFolder, getFolderState } = await load();
    const dir = makeFolder(2);
    markFolder(dir, AT);

    const state = getFolderState(dir);
    expect(state).toMatchObject({ markedAt: AT, imageCount: 2, currentCount: 2, stale: false });
  });

  it('survives the folder being renamed', async () => {
    // A path-keyed list in app settings would lose the mark here.
    const { markFolder, getFolderState } = await load();
    const dir = makeFolder(2);
    markFolder(dir, AT);

    const moved = path.join(collection, 'renamed');
    fs.renameSync(dir, moved);
    expect(getFolderState(moved)?.markedAt).toBe(AT);
  });

  it('goes stale when images are added after the mark', async () => {
    const { markFolder, getFolderState } = await load();
    const dir = makeFolder(2);
    markFolder(dir, AT);
    fs.writeFileSync(path.join(dir, 'extra.img'), 'x');

    const state = getFolderState(dir);
    expect(state?.stale).toBe(true);
    expect(state?.currentCount).toBe(3);
    expect(state?.imageCount).toBe(2);
  });

  it('does not go stale when a file is removed', async () => {
    // Fewer images than were archived is not a reason to redo the folder.
    const { markFolder, getFolderState } = await load();
    const dir = makeFolder(3);
    markFolder(dir, AT);
    fs.unlinkSync(path.join(dir, 'disk0.img'));

    expect(getFolderState(dir)?.stale).toBe(false);
  });

  it('settles again when the folder is re-marked', async () => {
    const { markFolder, getFolderState } = await load();
    const dir = makeFolder(2);
    markFolder(dir, AT);
    fs.writeFileSync(path.join(dir, 'extra.img'), 'x');
    markFolder(dir, '2026-03-05T10:00:00.000Z');

    expect(getFolderState(dir)).toMatchObject({ stale: false, imageCount: 3 });
  });

  it('unmarks by removing the file', async () => {
    const { markFolder, unmarkFolder, getFolderState, MARKER_FILENAME } = await load();
    const dir = makeFolder(2);
    markFolder(dir, AT);
    unmarkFolder(dir);

    expect(getFolderState(dir)).toBeNull();
    expect(fs.existsSync(path.join(dir, MARKER_FILENAME))).toBe(false);
  });

  it('treats an unreadable marker as absent rather than erroring', async () => {
    const { getFolderState, MARKER_FILENAME } = await load();
    const dir = makeFolder(2);
    fs.writeFileSync(path.join(dir, MARKER_FILENAME), 'not json {{{');

    expect(getFolderState(dir)).toBeNull();
  });
});

describe('offering the mark once a folder is fully exported', () => {
  const img = (dir: string, name: string) => path.join(dir, name);

  it('does not offer while images remain', async () => {
    const { recordImageExported } = await load();
    const dir = makeFolder(3);

    const first = recordImageExported(img(dir, 'disk0.img'));
    expect(first).toMatchObject({ dir, exported: 1, total: 3, offer: false });
    expect(recordImageExported(img(dir, 'disk1.img')).offer).toBe(false);
  });

  it('offers when the last image is exported', async () => {
    const { recordImageExported } = await load();
    const dir = makeFolder(3);

    recordImageExported(img(dir, 'disk0.img'));
    recordImageExported(img(dir, 'disk1.img'));
    expect(recordImageExported(img(dir, 'disk2.img'))).toMatchObject({ exported: 3, total: 3, offer: true });
  });

  it('counts an image exported twice only once', async () => {
    const { recordImageExported } = await load();
    const dir = makeFolder(3);

    recordImageExported(img(dir, 'disk0.img'));
    expect(recordImageExported(img(dir, 'disk0.img'))).toMatchObject({ exported: 1, offer: false });
  });

  it('never offers for a folder holding no images', async () => {
    // "All zero images are exported" is true and useless.
    const { recordImageExported } = await load();
    const empty = fs.mkdtempSync(path.join(collection, 'empty-'));
    expect(recordImageExported(img(empty, 'ghost.img')).offer).toBe(false);
  });

  it('does not offer for a folder already marked', async () => {
    const { recordImageExported, markFolder } = await load();
    const dir = makeFolder(1);
    markFolder(dir, AT);
    expect(recordImageExported(img(dir, 'disk0.img')).offer).toBe(false);
  });

  it('does not offer again once declined', async () => {
    // The reader said no; asking on every later export would be nagging.
    const { recordImageExported, declineFolderOffer } = await load();
    const dir = makeFolder(1);
    expect(recordImageExported(img(dir, 'disk0.img')).offer).toBe(true);

    declineFolderOffer(dir);
    expect(recordImageExported(img(dir, 'disk0.img')).offer).toBe(false);
  });

  it('completes even when an image is deleted mid-pass', async () => {
    // Otherwise a folder whose spare copy was thrown away could never reach
    // its recorded total and would never offer.
    const { recordImageExported } = await load();
    const dir = makeFolder(3);
    recordImageExported(img(dir, 'disk0.img'));
    fs.unlinkSync(path.join(dir, 'disk1.img'));

    expect(recordImageExported(img(dir, 'disk2.img'))).toMatchObject({ total: 2, offer: true });
  });

  it('drops the per-image record once the folder is marked', async () => {
    // The record only exists to time the offer, so it must not outlive it.
    const { recordImageExported, markFolder } = await load();
    const { getSettings } = await import('../electron/settings');
    const dir = makeFolder(1);
    recordImageExported(img(dir, 'disk0.img'));
    expect(getSettings().exportProgress?.[dir]).toBeDefined();

    markFolder(dir, AT);
    expect(getSettings().exportProgress?.[dir]).toBeUndefined();
  });

  it('offers again after a decline is undone by unmarking', async () => {
    const { recordImageExported, declineFolderOffer, unmarkFolder } = await load();
    const dir = makeFolder(1);
    declineFolderOffer(dir);
    expect(recordImageExported(img(dir, 'disk0.img')).offer).toBe(false);

    unmarkFolder(dir);
    expect(recordImageExported(img(dir, 'disk0.img')).offer).toBe(true);
  });
});

describe('a folder that cannot be written', () => {
  const readOnly = (dir: string) => fs.chmodSync(dir, 0o555);

  it('falls back to app settings and says so', async () => {
    const { markFolder, MARKER_FILENAME } = await load();
    const dir = makeFolder(2);
    readOnly(dir);
    try {
      const state = markFolder(dir, AT);
      expect(state.external).toBe(true);
      expect(fs.existsSync(path.join(dir, MARKER_FILENAME))).toBe(false);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  it('reads the fallback mark back', async () => {
    const { markFolder, getFolderState } = await load();
    const dir = makeFolder(2);
    readOnly(dir);
    try {
      markFolder(dir, AT);
      expect(getFolderState(dir)).toMatchObject({ markedAt: AT, imageCount: 2, external: true });
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  it('clears the fallback when the folder becomes writable and is re-marked', async () => {
    // Otherwise unmarking later would have to find two copies to remove.
    const { markFolder, unmarkFolder, getFolderState } = await load();
    const dir = makeFolder(2);
    readOnly(dir);
    markFolder(dir, AT);
    fs.chmodSync(dir, 0o755);

    markFolder(dir, AT);
    expect(getFolderState(dir)?.external).toBe(false);

    unmarkFolder(dir);
    expect(getFolderState(dir)).toBeNull();
  });
});
