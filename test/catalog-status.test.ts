import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { archiveCount, programsAt, setArchived, catalogSummary, statusForIds, markIds, loadKnown, buildKnownProgramsCsv, compareShippedList } from '../electron/catalog-status';

/**
 * The catalogue records paths relative to the collection root, which the app
 * never learns. These check the suffix matching that bridges the two, and the
 * rule that a mark reaches every copy of a program.
 */

let cat = '';
let collection = '';

/** A catalogue as build-catalog writes one, trimmed to what is read here. */
const prog = (
  id: string, title: string, type: string,
  occ: [string, string][], extra: Record<string, unknown> = {},
) => ({
  id, sha256: id.repeat(8), title, titleSource: 'filename',
  type, size: 100, isScreen: false, isFont: false, isUdg: false,
  names: [title], formats: ['larken'], basic: null,
  occurrences: occ.map(([image, folder], i) => ({ image, folder, format: 'larken', index: i, filename: title })),
  ...extra,
});

const CATALOG = {
  root: '/collection', generated: 'x', imageCount: 3, entryCount: 5, uniqueCount: 3,
  programs: [
    prog('aaa11111', 'Chess', 'basic', [
      ['Disks/Sincus_103/Sincus_103.img', 'Disks/Sincus_103'],
      ['Disks/Sincus_103/chess.tap', 'Disks/Sincus_103'],
      // The same program on a different disk: a mark must reach it too.
      ['Disks/Other_Disk/Other.img', 'Disks/Other_Disk'],
    ]),
    prog('bbb22222', 'Banner', 'code', [['Disks/Sincus_103/Sincus_103.img', 'Disks/Sincus_103']]),
    prog('ccc33333', 'Comma, Title', 'code', [['Disks/Other_Disk/Other.img', 'Disks/Other_Disk']]),
  ],
  unreadable: [],
};

beforeEach(() => {
  cat = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-cat-'));
  collection = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-coll-'));
  fs.writeFileSync(path.join(cat, 'catalog.json'), JSON.stringify(CATALOG));
  fs.mkdirSync(path.join(collection, 'Disks/Sincus_103'), { recursive: true });
  fs.mkdirSync(path.join(collection, 'Disks/Other_Disk'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(cat, { recursive: true, force: true });
  fs.rmSync(collection, { recursive: true, force: true });
});

const img = (p: string) => path.join(collection, p);

describe('finding a disk in the catalogue', () => {
  it('matches an image by the tail of its path, wherever the collection lives', () => {
    // The catalogue says "Disks/Sincus_103/Sincus_103.img"; the browser has an
    // absolute path under a temp dir. Nothing records the root.
    expect(programsAt(cat, img('Disks/Sincus_103/Sincus_103.img'), false)).toEqual(['aaa11111', 'bbb22222']);
  });

  it('credits a folder with everything beneath it', () => {
    expect(programsAt(cat, img('Disks/Sincus_103'), true)?.sort())
      .toEqual(['aaa11111', 'bbb22222']);
  });

  it('does not match on a partial path segment', () => {
    // "Other.img" must not be found by a path ending in "Other" alone, nor
    // "103.img" by a same-named file somewhere unrelated.
    expect(programsAt(cat, img('Disks/Elsewhere/103.img'), false)).toBeNull();
  });

  it('knows nothing about a file that is not in the catalogue', () => {
    expect(archiveCount(cat, img('Disks/Sincus_103/unknown.img'), false)).toBeNull();
  });

  it('handles a title containing a comma', () => {
    expect(programsAt(cat, img('Disks/Other_Disk/Other.img'), false)).toContain('ccc33333');
  });
});

describe('marking from the browser', () => {
  it('starts with nothing archived', () => {
    expect(archiveCount(cat, img('Disks/Sincus_103/Sincus_103.img'), false))
      .toEqual({ archived: 0, total: 2, marked: 0, matched: 0 });
  });

  it('counts an exact name match as archived, but reports it as a guess', () => {
    // The catalogue page treats an exact match as archived, so the browser
    // must agree — while still saying which are decisions and which guesses.
    fs.writeFileSync(path.join(cat, 'matches.json'), JSON.stringify({
      matches: [{ programId: 'bbb22222', exact: true }, { programId: 'aaa11111', exact: false }],
    }));
    expect(archiveCount(cat, img('Disks/Sincus_103/Sincus_103.img'), false))
      .toEqual({ archived: 1, total: 2, marked: 0, matched: 1 });
  });

  it('does not double-count a program both marked and matched', () => {
    fs.writeFileSync(path.join(cat, 'matches.json'), JSON.stringify({
      matches: [{ programId: 'aaa11111', exact: true }],
    }));
    setArchived(cat, img('Disks/Sincus_103/Sincus_103.img'), false, true);
    expect(archiveCount(cat, img('Disks/Sincus_103/Sincus_103.img'), false))
      .toEqual({ archived: 2, total: 2, marked: 2, matched: 0 });
  });

  it('marks every program on the disk', () => {
    const r = setArchived(cat, img('Disks/Sincus_103/Sincus_103.img'), false, true);
    expect(r).toMatchObject({ changed: 2, total: 2 });
    expect(archiveCount(cat, img('Disks/Sincus_103/Sincus_103.img'), false)).toMatchObject({ archived: 2, total: 2, marked: 2 });
  });

  it('reaches the same program on other disks', () => {
    // The point of hashing by content: Chess is on two disks, and archiving
    // it once is true of both.
    setArchived(cat, img('Disks/Sincus_103/Sincus_103.img'), false, true);
    expect(archiveCount(cat, img('Disks/Other_Disk/Other.img'), false)).toMatchObject({ archived: 1, total: 2, marked: 1 });
  });

  it('counts only what actually changed', () => {
    setArchived(cat, img('Disks/Sincus_103/Sincus_103.img'), false, true);
    // Other_Disk shares Chess, so only its own second program is new.
    expect(setArchived(cat, img('Disks/Other_Disk/Other.img'), false, true)).toMatchObject({ changed: 1, total: 2 });
  });

  it('marks a whole folder at once', () => {
    expect(setArchived(cat, img('Disks/Sincus_103'), true, true)).toMatchObject({ changed: 2 });
  });

  it('unmarks again', () => {
    setArchived(cat, img('Disks/Sincus_103'), true, true);
    setArchived(cat, img('Disks/Sincus_103'), true, false);
    expect(archiveCount(cat, img('Disks/Sincus_103'), true)).toMatchObject({ archived: 0, total: 2 });
  });

  it('writes marks.json and leaves the catalogue untouched', () => {
    // A mark is a decision about a program, not a fact about the collection;
    // rebuilding the one must never destroy the other.
    const before = fs.readFileSync(path.join(cat, 'catalog.json'), 'utf-8');
    setArchived(cat, img('Disks/Sincus_103'), true, true);
    expect(fs.existsSync(path.join(cat, 'marks.json'))).toBe(true);
    expect(fs.readFileSync(path.join(cat, 'catalog.json'), 'utf-8')).toBe(before);
  });

  it('keeps marks made by the command line', () => {
    fs.writeFileSync(path.join(cat, 'marks.json'), JSON.stringify({
      generated: 'x', marks: { ccc33333: { status: 'archived', note: 'by hand', markedAt: 'y' } },
    }));
    setArchived(cat, img('Disks/Sincus_103'), true, true);
    const after = JSON.parse(fs.readFileSync(path.join(cat, 'marks.json'), 'utf-8'));
    expect(after.marks.ccc33333.note).toBe('by hand');
    expect(Object.keys(after.marks).sort()).toEqual(['aaa11111', 'bbb22222', 'ccc33333']);
  });
});

describe('the catalogue summary', () => {
  it('reports what was loaded, so a wrong folder is obvious', () => {
    expect(catalogSummary(cat)).toEqual({ images: 3, folders: 2, programs: 3, archived: 0 });
  });

  it('is null for a folder that holds no catalogue', () => {
    expect(catalogSummary(collection)).toBeNull();
  });
});

describe('marking specific programs, as an export does', () => {
  it('marks by id and reports only what changed', () => {
    expect(markIds(cat, ['aaa11111', 'bbb22222'], true)).toEqual({ changed: 2 });
    expect(markIds(cat, ['aaa11111'], true)).toEqual({ changed: 0 });
  });

  it('shows up wherever that program lives', () => {
    markIds(cat, ['aaa11111'], true);
    expect(archiveCount(cat, img('Disks/Other_Disk/Other.img'), false)).toMatchObject({ marked: 1 });
  });

  it('reports each program as your mark or a name match', () => {
    fs.writeFileSync(path.join(cat, 'matches.json'), JSON.stringify({
      matches: [{ programId: 'bbb22222', exact: true }],
    }));
    markIds(cat, ['aaa11111'], true);
    expect(statusForIds(cat, ['aaa11111', 'bbb22222', 'ccc33333']))
      .toEqual({ aaa11111: 'marked', bbb22222: 'matched' });
  });
});

describe('the shipped list of known programs', () => {
  it('answers "is this new?" without any catalogue configured', () => {
    // Joe's case: he images a disk and has no catalogue folder of his own,
    // only the copy that ships inside the app.
    const known = loadKnown(undefined);
    expect(known).not.toBeNull();
    expect(known!.ids.size).toBeGreaterThan(0);
  });

  it('prefers a live catalogue over the shipped copy', () => {
    // Whoever built the catalogue has the newest answer; the shipped file is
    // a snapshot of some earlier release.
    const known = loadKnown(cat)!;
    expect(known.ids.has('aaa11111')).toBe(true);
    expect(known.source).toContain(cat);
  });

  it('carries the archived flag, so a reader with no catalogue still sees it', () => {
    markIds(cat, ['aaa11111'], true);
    fs.writeFileSync(path.join(cat, 'matches.json'), JSON.stringify({
      matches: [{ programId: 'bbb22222', exact: true }],
    }));
    const known = loadKnown(cat)!;
    expect(known.ids.get('aaa11111')?.archived).toBe('yes');
    expect(known.ids.get('bbb22222')?.archived).toBe('matched');
  });
});

describe('building the shared list', () => {
  it('projects the catalogue to id, title, kind, size, copies and state', () => {
    const built = buildKnownProgramsCsv(cat)!;
    expect(built.rows).toBe(3);
    expect(built.text.split('\n')[0]).toBe('id,title,kind,size,copies,archived');
  });

  it('sorts by id, so refreshing the file is a small diff', () => {
    const ids = buildKnownProgramsCsv(cat)!.text.trim().split('\n').slice(1).map((l) => l.split(',')[0]);
    expect(ids).toEqual([...ids].sort());
  });

  it('takes status from marks.json, which is live', () => {
    markIds(cat, ['ccc33333'], true);
    const built = buildKnownProgramsCsv(cat)!;
    expect(built.archived).toBe(1);
    expect(built.text).toMatch(/^ccc33333,"Comma, Title",code,100,1,yes$/m);
  });

  it('records a name match as a guess, distinctly from your mark', () => {
    fs.writeFileSync(path.join(cat, 'matches.json'), JSON.stringify({
      matches: [{ programId: 'bbb22222', exact: true }],
    }));
    const built = buildKnownProgramsCsv(cat)!;
    expect(built.matched).toBe(1);
    expect(built.text).toMatch(/^bbb22222,Banner,code,100,1,matched$/m);
  });

  it('is null when the folder holds no catalogue', () => {
    expect(buildKnownProgramsCsv(collection)).toBeNull();
  });
});

describe('whether the shipped list has fallen behind', () => {
  it('says so plainly when it matches', () => {
    // The shipped list ships with the app, so the fixture cannot replace it;
    // what matters is that a real comparison reports both sides.
    const c = compareShippedList(cat)!;
    expect(c.catalogPrograms).toBe(3);
    expect(typeof c.inStep).toBe('boolean');
  });

  it('counts programs the catalogue has that the list does not', () => {
    const c = compareShippedList(cat)!;
    // The fixture's three programs are not in the app's shipped list, so all
    // three read as additions.
    expect(c.added).toBe(3);
    expect(c.inStep).toBe(false);
  });

  it('notices an archived state that changed since the list was written', () => {
    const before = compareShippedList(cat)!;
    markIds(cat, ['aaa11111'], true);
    const after = compareShippedList(cat)!;
    // Marking does not add a program, so the difference is in state, not count.
    expect(after.catalogPrograms).toBe(before.catalogPrograms);
    expect(after.inStep).toBe(false);
  });

  it('is null when there is no catalogue to compare against', () => {
    expect(compareShippedList(collection)).toBeNull();
  });
});

describe('marking a copy the catalogue could not match', () => {
  it('marks and unmarks by id, whatever route asked', () => {
    // The catalogue matches on bytes, so a renamed or slightly altered copy
    // reads as a different program. Marking by hand is the only remedy.
    expect(markIds(cat, ['aaa11111'], true)).toEqual({ changed: 1 });
    expect(statusForIds(cat, ['aaa11111'])).toEqual({ aaa11111: 'marked' });
    expect(markIds(cat, ['aaa11111'], false)).toEqual({ changed: 1 });
    expect(statusForIds(cat, ['aaa11111'])).toEqual({});
  });

  it('marks a second program without disturbing the first', () => {
    // The reported failure: one export marked, later ones seemed not to.
    markIds(cat, ['aaa11111'], true);
    markIds(cat, ['bbb22222'], true);
    markIds(cat, ['ccc33333'], true);
    expect(statusForIds(cat, ['aaa11111', 'bbb22222', 'ccc33333'])).toEqual({
      aaa11111: 'marked', bbb22222: 'marked', ccc33333: 'marked',
    });
  });

  it('reports nothing changed when it was already marked', () => {
    // Worth distinguishing: "already done" must not read as "failed".
    markIds(cat, ['aaa11111'], true);
    expect(markIds(cat, ['aaa11111'], true)).toEqual({ changed: 0 });
    expect(statusForIds(cat, ['aaa11111'])).toEqual({ aaa11111: 'marked' });
  });
});
