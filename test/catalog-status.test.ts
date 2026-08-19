import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { archiveCount, programsAt, setArchived, catalogSummary, statusForIds, markIds } from '../electron/catalog-status';

/**
 * The catalogue records paths relative to the collection root, which the app
 * never learns. These check the suffix matching that bridges the two, and the
 * rule that a mark reaches every copy of a program.
 */

let cat = '';
let collection = '';

const CSV = [
  'id,title,kind,image,folder,format,catalog_index,filed_as',
  'aaa11111,Chess,basic,Disks/Sincus_103/Sincus_103.img,Disks/Sincus_103,larken,0,CHESS',
  'bbb22222,Banner,code,Disks/Sincus_103/Sincus_103.img,Disks/Sincus_103,larken,1,BANNER',
  'aaa11111,Chess,basic,Disks/Sincus_103/chess.tap,Disks/Sincus_103,tap,0,CHESS',
  // The same program on a different disk: a mark must reach it too.
  'aaa11111,Chess,basic,Disks/Other_Disk/Other.img,Disks/Other_Disk,larken,3,CHESS',
  'ccc33333,"Comma, Title",code,Disks/Other_Disk/Other.img,Disks/Other_Disk,larken,4,CT',
].join('\n') + '\n';

beforeEach(() => {
  cat = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-cat-'));
  collection = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-coll-'));
  fs.writeFileSync(path.join(cat, 'occurrences.csv'), CSV);
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

  it('reads a quoted field containing a comma', () => {
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

  it('writes marks.json and leaves the CSV untouched', () => {
    // The CSV is a generated view; a mark stored there would be destroyed the
    // next time the catalogue was rendered.
    const before = fs.readFileSync(path.join(cat, 'occurrences.csv'), 'utf-8');
    setArchived(cat, img('Disks/Sincus_103'), true, true);
    expect(fs.existsSync(path.join(cat, 'marks.json'))).toBe(true);
    expect(fs.readFileSync(path.join(cat, 'occurrences.csv'), 'utf-8')).toBe(before);
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
