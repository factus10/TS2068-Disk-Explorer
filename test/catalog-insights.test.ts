import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildInsights } from '../electron/catalog-insights';

/**
 * The orderings are the product here, so these check what comes first rather
 * than merely that something came back.
 */

let cat = '';

const prog = (id: string, title: string, folders: string[], extra: Record<string, unknown> = {}) => ({
  id, sha256: id.repeat(8), title, titleSource: 'filename',
  type: 'basic', size: 100, isScreen: false, isFont: false, isUdg: false,
  basic: null,
  occurrences: folders.map((folder, i) => ({ image: `${folder}/f${i}.tap`, folder, format: 'tap', index: i, filename: title })),
  ...extra,
});

beforeEach(() => {
  cat = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ins-'));
  fs.writeFileSync(path.join(cat, 'catalog.json'), JSON.stringify({
    root: '/collection', generated: 'x', imageCount: 5, entryCount: 8, uniqueCount: 4,
    programs: [
      // one folder, one copy — the rarest thing here
      prog('aaa11111', 'Only Once', ['DiskA']),
      // one folder, three copies — rare in place, but not as rare
      prog('bbb22222', 'Thrice Here', ['DiskA', 'DiskA', 'DiskA']),
      // spread across three folders — the least at risk
      prog('ccc33333', 'Everywhere', ['DiskA', 'DiskB', 'DiskC']),
      // unique to another folder
      prog('ddd44444', 'Solo B', ['DiskB']),
    ],
    unreadable: [],
  }));
});
afterEach(() => fs.rmSync(cat, { recursive: true, force: true }));

describe('what still needs archiving', () => {
  it('puts the rarest first: fewest folders, then fewest copies', () => {
    const i = buildInsights(cat)!;
    expect(i.todo.map((t) => t.id)).toEqual(['aaa11111', 'ddd44444', 'bbb22222', 'ccc33333']);
  });

  it('counts folders rather than copies as the measure of rarity', () => {
    // Three copies in one folder is one disk's worth; it disappears together.
    const i = buildInsights(cat)!;
    const thrice = i.todo.find((t) => t.id === 'bbb22222')!;
    expect(thrice).toMatchObject({ folders: 1, copies: 3 });
  });

  it('leaves out anything already archived', () => {
    fs.writeFileSync(path.join(cat, 'marks.json'), JSON.stringify({
      generated: 'x', marks: { aaa11111: { status: 'archived', markedAt: 'y' } },
    }));
    expect(buildInsights(cat)!.todo.map((t) => t.id)).not.toContain('aaa11111');
  });

  it('counts an exact name match as archived too', () => {
    // The same rule the browser badges use, or the two would disagree.
    fs.writeFileSync(path.join(cat, 'matches.json'), JSON.stringify({
      matches: [{ programId: 'ddd44444', exact: true }],
    }));
    const i = buildInsights(cat)!;
    expect(i.todo.map((t) => t.id)).not.toContain('ddd44444');
    expect(i.archived).toBe(1);
  });
});

describe('which folders hold material found nowhere else', () => {
  it('counts programs that exist in no other folder', () => {
    const i = buildInsights(cat)!;
    const a = i.folders.find((f) => f.folder === 'DiskA')!;
    // Only Once and Thrice Here are unique to DiskA; Everywhere is not.
    expect(a).toMatchObject({ onlyHere: 2, programs: 3, entries: 5 });
  });

  it('orders by what would be lost with the folder', () => {
    expect(buildInsights(cat)!.folders.map((f) => f.folder)).toEqual(['DiskA', 'DiskB', 'DiskC']);
  });

  it('a folder holding only widely-copied programs has nothing unique', () => {
    const i = buildInsights(cat)!;
    expect(i.folders.find((f) => f.folder === 'DiskC')!.onlyHere).toBe(0);
  });

  it('reports how much of each folder is archived', () => {
    fs.writeFileSync(path.join(cat, 'marks.json'), JSON.stringify({
      generated: 'x', marks: { aaa11111: { status: 'archived', markedAt: 'y' } },
    }));
    expect(buildInsights(cat)!.folders.find((f) => f.folder === 'DiskA')!.archived).toBe(1);
  });

  it('is null for a folder with no catalogue', () => {
    expect(buildInsights(os.tmpdir())).toBeNull();
  });
});
