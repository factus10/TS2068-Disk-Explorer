import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkForUpdate, saveUpdate, clearUpdate, countRows } from '../electron/catalog-update';

const LIST = 'id,title,kind,size,copies,archived\naaa11111,Chess,basic,10,1,\nbbb22222,Banner,code,20,2,yes\n';
const BIGGER = LIST + 'ccc33333,New Thing,code,30,1,\n';

let userData = '';
beforeEach(() => { userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-upd-')); });
afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const stubFetch = (status: number, body: string, headers: Record<string, string> = {}) => {
  vi.stubGlobal('fetch', async () => ({
    status, ok: status >= 200 && status < 300,
    text: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  }));
};

describe('checking for a newer program list', () => {
  it('counts rows without the header', () => {
    expect(countRows(LIST)).toBe(2);
  });

  it('offers a list that differs', async () => {
    stubFetch(200, BIGGER, { etag: '"v2"' });
    const r = await checkForUpdate(LIST);
    expect(r).toMatchObject({ available: true, rows: 3, currentRows: 2, etag: '"v2"' });
  });

  it('says nothing is available when the content is the same', async () => {
    // Byte-identical despite a new ETag: there is nothing to offer.
    stubFetch(200, LIST, { etag: '"v9"' });
    expect(await checkForUpdate(LIST)).toMatchObject({ available: false, currentRows: 2 });
  });

  it('treats 304 as unchanged without reading a body', async () => {
    // The point of sending If-None-Match: an unchanged list costs no transfer.
    stubFetch(304, '');
    expect(await checkForUpdate(LIST, '"v1"')).toMatchObject({ available: false, etag: '"v1"' });
  });

  it('refuses a response that is not a program list', async () => {
    // A captive portal or a 404 body served as 200 would otherwise replace
    // good data with rubbish.
    stubFetch(200, '<!doctype html><title>Sign in</title>');
    const r = await checkForUpdate(LIST);
    expect(r.available).toBe(false);
    expect(r.error).toMatch(/not a program list/);
  });

  it('reports an HTTP failure rather than claiming to be up to date', async () => {
    stubFetch(500, 'boom');
    expect((await checkForUpdate(LIST)).error).toBe('HTTP 500');
  });

  it('reports a network failure the same way', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const r = await checkForUpdate(LIST);
    expect(r).toMatchObject({ available: false, error: 'offline' });
  });

  it('handles having no list at all yet', async () => {
    stubFetch(200, LIST, { etag: '"v1"' });
    expect(await checkForUpdate(null)).toMatchObject({ available: true, rows: 2, currentRows: 0 });
  });
});

describe('storing a downloaded list', () => {
  it('writes where the app will prefer it', () => {
    const at = saveUpdate(userData, BIGGER);
    expect(at).toBe(path.join(userData, 'known-programs.csv'));
    expect(fs.readFileSync(at, 'utf-8')).toBe(BIGGER);
  });

  it('clearing falls back to the shipped copy', () => {
    saveUpdate(userData, BIGGER);
    clearUpdate(userData);
    expect(fs.existsSync(path.join(userData, 'known-programs.csv'))).toBe(false);
  });

  it('clearing when nothing was downloaded is not an error', () => {
    expect(() => clearUpdate(userData)).not.toThrow();
  });
});
