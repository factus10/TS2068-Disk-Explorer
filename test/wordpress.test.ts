import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchArchive, fetchListings, lookupByName, siteInfo, effectiveDownload } from '../electron/wordpress';
import { saveListings, searchListings, searchTitles, listingsStatus, unquote } from '../electron/wordpress-listings';
import { refreshMatches } from '../electron/wordpress-match';

/**
 * The REST API is stood up here rather than reached over the network, so the
 * suite says what the client does with a given answer rather than what one
 * site happened to hold on the day it ran.
 *
 * The shapes are the ones a real `computer_media` site returns, and they are
 * not uniform: ACF hands `programmers` back as bare taxonomy term ids and
 * `producer-company` as whole post objects, and an empty relationship field
 * arrives as `false` on one record and `''` on the next.
 */

const BASE = 'http://wp.test';

interface Route { total?: number; body: unknown }
let routes: Map<string, Route>;
let asked: string[];

/** The query as the client sent it, minus the parts a test does not fix. */
function key(url: string): string {
  const u = new URL(url);
  const q = u.searchParams;
  const parts = ['search', 'include', 'page', 'per_page']
    .filter((k) => q.has(k))
    .map((k) => `${k}=${q.get(k)}`);
  return parts.length ? `${u.pathname}?${parts.join('&')}` : u.pathname;
}

beforeEach(() => {
  routes = new Map();
  asked = [];
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    const route = routes.get(key(url));
    if (!route) {
      return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(route.body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        ...(route.total != null ? { 'x-wp-total': String(route.total) } : {}),
      },
    });
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

/** A record as the REST API serves it, with only the fields under test set. */
function record(id: number, title: string, acf: Record<string, unknown> = {}) {
  return {
    id,
    title: { rendered: title },
    slug: title.toLowerCase().replace(/\W+/g, '-'),
    link: `${BASE}/computer_media/${id}/`,
    modified: '2026-01-01T00:00:00',
    acf: {
      download_url: '', 'media-type': 'Program', media_type_tags: '', mediadate: '',
      spectrum_computing: '', programmers: false, 'producer-company': '', media_contents: '',
      ...acf,
    },
  };
}

describe('reading the archive', () => {
  it('resolves the names a record refers to by number', async () => {
    routes.set('/wp-json/wp/v2/computer_media?page=1&per_page=100', {
      total: 2,
      body: [
        // programmers as term ids, company as whole posts: both really occur.
        record(1, 'Hangman', { programmers: [77], 'producer-company': [{ ID: 9, post_title: 'Campbell Systems' }] }),
        record(2, 'Chess', { media_contents: [50] }),
      ],
    });
    routes.set('/wp-json/wp/v2/indiv?include=77&per_page=100', {
      body: [{ id: 77, name: 'James Dupuy' }],
    });
    routes.set('/wp-json/wp/v2/computer_media?include=50&per_page=100', {
      body: [{ id: 50, title: { rendered: 'Ten Great Games' }, acf: { download_url: 'http://x/tape.zip' } }],
    });

    const [hangman, chess] = await fetchArchive(BASE);

    expect(hangman.programmers).toEqual(['James Dupuy']);
    expect(hangman.company).toEqual(['Campbell Systems']);
    expect(chess.part_of).toEqual([{ id: 50, title: 'Ten Great Games', download_url: 'http://x/tape.zip' }]);
  });

  it('pages until the site runs out of records', async () => {
    const page = (from: number) => Array.from({ length: 100 }, (_, i) => record(from + i, `P${from + i}`));
    routes.set('/wp-json/wp/v2/computer_media?page=1&per_page=100', { total: 150, body: page(1) });
    routes.set('/wp-json/wp/v2/computer_media?page=2&per_page=100', { total: 150, body: page(101).slice(0, 50) });

    const seen: number[] = [];
    const all = await fetchArchive(BASE, (done) => seen.push(done));

    expect(all).toHaveLength(150);
    expect(seen).toEqual([100, 150]);
  });

  it('decodes the entities WordPress puts in a title', async () => {
    routes.set('/wp-json/wp/v2/computer_media?page=1&per_page=100', {
      total: 1, body: [record(1, 'Alf&#8217;s Adventure &amp; Escape')],
    });
    const [only] = await fetchArchive(BASE);
    expect(only.title).toBe('Alf’s Adventure & Escape');
  });

  it('sends a program on a compilation to the tape that holds it', () => {
    const onTape = {
      download_url: '', part_of: [{ id: 50, title: 'Ten Great Games', download_url: 'http://x/tape.zip' }],
    } as any;
    expect(effectiveDownload(onTape)).toEqual({ url: 'http://x/tape.zip', via: 'Ten Great Games' });

    // Its own file wins over the compilation's, when it has one.
    expect(effectiveDownload({ ...onTape, download_url: 'http://x/own.zip' }))
      .toEqual({ url: 'http://x/own.zip', via: '' });

    expect(effectiveDownload({ download_url: '', part_of: [] } as any)).toBeNull();
  });
});

describe('searching the listing', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wplist-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const listing = (id: number, title: string, source: string) => ({
    id, title, url: `${BASE}/${id}`, downloadUrl: '', mediaType: 'Program',
    date: '', company: [], source,
  });

  const put = (...records: ReturnType<typeof listing>[]) => saveListings(dir, BASE, records);

  it('finds a phrase wherever the listing is kept', () => {
    // The second record is the case the site's own search could never reach:
    // its listing lives only in the field, never in the rendered body.
    put(
      listing(1, 'Horserace', '10 GO SUB 9000\n20 STOP'),
      listing(2, 'Glenagleys', '100 LET o=1:GO SUB 9000'),
      listing(3, 'Ledger', '10 GO TO 500\n20 SUB TOTAL\n30 LET x=9000'),
    );

    const r = searchListings(dir, 'GO SUB 9000')!;

    expect(r.hits.map((h) => h.title)).toEqual(['Horserace', 'Glenagleys']);
    // Every listing read, not a narrowed candidate set.
    expect(r.searched).toBe(3);
  });

  it('ignores case on both sides', () => {
    put(listing(1, 'Demo', '10 print at 1,1;"hi"'));
    for (const q of ['PRINT AT', 'print at', 'PrInT aT']) {
      expect(searchListings(dir, q)!.hits).toHaveLength(1);
    }
  });

  /**
   * Quoting used to guarantee an empty result: the quotes were kept and
   * looked for in the listing, where they never appear.
   */
  it('reads quotes around a phrase as meaning the phrase', () => {
    put(listing(1, 'Horserace', '10 GO SUB 9000'));

    const quoted = searchListings(dir, '"GO SUB 9000"')!;
    expect(quoted.hits).toHaveLength(1);
    expect(quoted.phrase).toBe('GO SUB 9000');

    // A quote mark inside the phrase is still just a character to match.
    put(listing(2, 'Printer', '20 PRINT "HELLO"'));
    expect(searchListings(dir, 'PRINT "HELLO"')!.hits.map((h) => h.title)).toEqual(['Printer']);
  });

  it('unquotes only a genuinely wrapped phrase', () => {
    expect(unquote('"GO SUB"')).toBe('GO SUB');
    expect(unquote('  "GO SUB"  ')).toBe('GO SUB');
    expect(unquote('PRINT "HI"')).toBe('PRINT "HI"');
    expect(unquote('"')).toBe('"');
    expect(unquote('GO SUB')).toBe('GO SUB');
  });

  it('shows the lines that earned the match', () => {
    put(listing(1, 'Demo', '10 REM x\n20 PRINT AT 1,1;"hi"\n30 PRINT AT 2,2;"there"'));

    expect(searchListings(dir, 'PRINT AT')!.hits[0].context).toEqual([
      { line: '20 PRINT AT 1,1;"hi"', number: 2 },
      { line: '30 PRINT AT 2,2;"there"', number: 3 },
    ]);
  });

  it('passes over a record that carries no listing', () => {
    put(listing(1, 'Cassette Inlay', ''));
    expect(searchListings(dir, 'anything')!.hits).toEqual([]);
  });

  /**
   * The difference that matters: no copy is not the same answer as nothing
   * found, and reporting the second for the first would say the archive was
   * empty.
   */
  it('says there is no copy rather than reporting nothing found', () => {
    expect(searchListings(dir, 'GO SUB')).toBeNull();
    expect(listingsStatus(dir)).toBeNull();
  });

  it('reports what the copy holds, and replaces it wholesale', () => {
    put(listing(1, 'A', '10 REM a'), listing(2, 'B', ''));
    expect(listingsStatus(dir)).toMatchObject({ records: 2, withSource: 1, site: BASE });

    put(listing(3, 'C', '10 REM c'));
    expect(listingsStatus(dir)).toMatchObject({ records: 1, withSource: 1 });
    expect(searchListings(dir, 'REM a')!.hits).toEqual([]);
  });

  it('survives a copy that was truncated by a failed write', () => {
    put(listing(1, 'A', '10 REM a'));
    const file = path.join(dir, 'wordpress-listings.json');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').slice(0, 40));
    expect(searchListings(dir, 'REM')).toBeNull();
  });
});

describe('searching by name', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpname-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const listing = (id: number, title: string, source = '') => ({
    id, title, url: `${BASE}/${id}`, downloadUrl: '', mediaType: 'Program',
    date: '', company: [], source,
  });

  /**
   * The case that showed the fault: the site matched 80 records on "on",
   * "your" and "mark" appearing anywhere, returned them newest-first, and the
   * record actually called "On Your Mark" was fiftieth — so asking for twenty
   * got twenty wrong answers and not the right one.
   */
  it('finds the record of that name among ones that merely mention it', () => {
    saveListings(dir, BASE, [
      listing(1, 'Household Finance Calculator', '10 REM on your mark'),
      listing(2, 'TEST', '10 PRINT "your mark"'),
      listing(3, 'On Your Mark'),
    ]);

    const r = searchTitles(dir, 'On Your Mark')!;

    expect(r.hits.map((h) => h.title)).toEqual(['On Your Mark']);
    expect(r.searched).toBe(3);
  });

  it('puts the whole name first, then what begins with it, then the rest', () => {
    saveListings(dir, BASE, [
      listing(1, 'Hi-Res Chess'),
      listing(2, 'Chess Player'),
      listing(3, 'Chess'),
      listing(4, 'BBS Chess'),
    ]);

    expect(searchTitles(dir, 'chess')!.hits.map((h) => h.title))
      .toEqual(['Chess', 'Chess Player', 'BBS Chess', 'Hi-Res Chess']);
  });

  it('ignores case, and is not capped at twenty', () => {
    saveListings(dir, BASE, Array.from({ length: 25 }, (_, i) => listing(i + 1, `Chess ${i + 1}`)));
    expect(searchTitles(dir, 'CHESS')!.hits).toHaveLength(25);
  });

  it('says there is no copy rather than reporting nothing found', () => {
    expect(searchTitles(dir, 'Chess')).toBeNull();
  });
});

describe('taking a copy of the listings', () => {
  it('pages the whole archive and keeps the source', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({
      ...record(from + i, `P${from + i}`),
      acf: { ...record(from + i, `P${from + i}`).acf, source_code: `10 REM ${from + i}` },
    }));
    routes.set('/wp-json/wp/v2/computer_media?page=1&per_page=100', { total: 150, body: page(1, 100) });
    routes.set('/wp-json/wp/v2/computer_media?page=2&per_page=100', { total: 150, body: page(101, 50) });

    const seen: number[] = [];
    const all = await fetchListings(BASE, (done) => seen.push(done));

    expect(all).toHaveLength(150);
    expect(all[0].source).toBe('10 REM 1');
    expect(seen).toEqual([100, 150]);
    // The empty context a hit carries has no business in a 15 MB cache.
    expect(all[0]).not.toHaveProperty('context');
  });
});

describe('looking one program up by name, from the site', () => {
  it('keeps only the records that have the name in their title', async () => {
    routes.set('/wp-json/wp/v2/computer_media?search=Hangman&per_page=100', {
      body: [
        record(1, 'Hangman'),
        // Matched on its body, not its name — not an answer to this question.
        record(2, 'Games Compendium'),
      ],
    });

    expect((await lookupByName(BASE, 'Hangman')).map((h) => h.title)).toEqual(['Hangman']);
  });

  /**
   * It used to return the whole pile when nothing matched, which presented
   * unrelated programs as though they were the one being looked for.
   */
  it('answers none rather than offering unrelated records', async () => {
    routes.set('/wp-json/wp/v2/computer_media?search=zzz&per_page=100', {
      body: [record(2, 'Games Compendium')],
    });
    expect(await lookupByName(BASE, 'zzz')).toEqual([]);
  });

  it('asks the site to rank by relevance, not by date', async () => {
    routes.set('/wp-json/wp/v2/computer_media?search=Hangman&per_page=100', { body: [] });
    await lookupByName(BASE, 'Hangman');
    expect(asked[0]).toContain('orderby=relevance');
  });
});

describe('reaching a site that is not one', () => {
  it('says a post type is missing rather than reporting a bare failure', async () => {
    routes.set('/wp-json/', { body: { name: 'A Blog', routes: { '/wp/v2/posts': {} } } });
    await expect(siteInfo(BASE)).rejects.toThrow(/computer_media/);
  });

  it('says what a 404 means for an address that is not a REST root', async () => {
    await expect(siteInfo(BASE)).rejects.toThrow(/404/);
  });
});

describe('matching a catalogue against the archive', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpmatch-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const wp = (id: number, title: string, download = '') => ({
    id, title, slug: '', url: `${BASE}/${id}`, modified: '', download_url: download,
    media_type: 'Program', tags: '', date: '', spectrum_computing: '',
    programmers: [], company: [], part_of: [],
  });

  function catalog(programs: unknown[]) {
    fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ root: '/x', programs }));
  }
  const program = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, title, titleSource: 'filename', type: 'basic', size: 100,
    names: [title], occurrences: [{ image: 'a.img', folder: '.' }], ...extra,
  });

  it('matches a distinctive name and leaves a generic one alone', () => {
    catalog([
      program('a', 'HANGMAN'),
      // Short, and one of the names the collection uses hundreds of times.
      program('b', 'AUTOSTART', { titleSource: 'generic filename' }),
    ]);

    const r = refreshMatches(dir, [wp(1, 'Hangman'), wp(2, 'Autostart')] as any);

    expect(r.matched).toBe(1);
    expect(r.exact).toBe(1);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'matches.json'), 'utf-8'));
    expect(written.matches.map((m: any) => m.programId)).toEqual(['a']);
  });

  it('reads a title out of a TOSEC download name', () => {
    catalog([program('a', 'TICK TACK TOE')]);
    const r = refreshMatches(dir, [
      // The published title says nothing; the file beside it says everything.
      wp(1, 'Untitled Game', 'http://x/Tick%20Tack%20Toe%20(1984)(Weinberg)(TS2068)(US)(Program).zip'),
    ] as any);
    expect(r.matched).toBe(1);
  });

  it('calls a truncated name a guess rather than a match', () => {
    catalog([program('a', 'TECHDRAW')]);
    const r = refreshMatches(dir, [wp(1, 'Techdrawing Suite')] as any);

    expect(r.matched).toBe(1);
    expect(r.exact).toBe(0);
    const [only] = JSON.parse(fs.readFileSync(path.join(dir, 'matches.json'), 'utf-8')).matches;
    expect(only.exact).toBe(false);
  });

  it('flags a truncation that several published titles would fit', () => {
    catalog([program('a', 'ADVENTURE')]);
    const r = refreshMatches(dir, [wp(1, 'Adventureland Two'), wp(2, 'Adventureland One')] as any);

    const [only] = JSON.parse(fs.readFileSync(path.join(dir, 'matches.json'), 'utf-8')).matches;
    expect(only.ambiguous).toBe(true);
    expect(r.exact).toBe(0);
  });

  it('meets a published version number with an unversioned disk name', () => {
    catalog([program('a', 'TECH DRAW')]);
    expect(refreshMatches(dir, [wp(1, 'Tech Draw 2.0')] as any).matched).toBe(1);
  });

  it('keeps the archive beside the matches, and leaves the catalogue alone', () => {
    catalog([program('a', 'HANGMAN')]);
    const before = fs.readFileSync(path.join(dir, 'catalog.json'), 'utf-8');

    refreshMatches(dir, [wp(1, 'Hangman')] as any);

    expect(JSON.parse(fs.readFileSync(path.join(dir, 'wordpress.json'), 'utf-8'))).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf-8')).toBe(before);
  });
});
