import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  normalise, screenshotBase, stripArchiveSuffix, score, listScreenshots, matchScreenshots,
  AUTOFILL_THRESHOLD, SUGGEST_THRESHOLD,
} from '../electron/screenshot-match';

/**
 * These rules are a port of the CSV importer's WCMI_Matcher, so a screenshot
 * that importer would have attached is the one this offers. The scores below
 * were taken from PHP's own `similar_text` rather than guessed, because the
 * thresholds were chosen against those numbers.
 */

describe('normalising a name', () => {
  it('keeps only letters and digits, lowercased', () => {
    expect(normalise('I Ching.png')).toBe('iching');
    expect(normalise('3D-WORDS')).toBe('3dwords');
    expect(normalise('Tech Draw 2.0')).toBe('techdraw20');
  });

  it('drops the extensions a screenshot or a listing carries', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'txt', 'tap', 'tzx', 'zip']) {
      expect(normalise(`hangman.${ext}`)).toBe('hangman');
    }
  });
});

describe('grouping a multi-shot set', () => {
  it('treats numbered shots of one program as the same set', () => {
    expect(screenshotBase('3d-word-1.png')).toBe('3dword');
    expect(screenshotBase('3d-word-2.png')).toBe('3dword');
    expect(screenshotBase('chess_1.png')).toBe('chess');
    expect(screenshotBase('chess 2.png')).toBe('chess');
  });

  /** A separator before the digits is required, or real names lose their tails. */
  it('leaves a number that is part of the name alone', () => {
    expect(screenshotBase('64column.png')).toBe('64column');
    expect(screenshotBase('textwriter2000.png')).toBe('textwriter2000');
  });
});

describe('the archive suffix', () => {
  it('drops everything from the first bracket', () => {
    expect(stripArchiveSuffix('Hangman (1983)(-)(TS2068)(US)(Program)')).toBe('Hangman');
    expect(stripArchiveSuffix('Plain Name')).toBe('Plain Name');
  });
});

describe('scoring two names', () => {
  /**
   * Taken from PHP's similar_text, which is what the importer grades with.
   * The first two are the pairs its README cites as the reason the tick
   * threshold is 80: both are wrong, and both score in the seventies.
   */
  it('agrees with PHP on the cases the thresholds were chosen for', () => {
    expect(score('invert', 'invaders')).toBe(71);
    expect(score('supercalc', 'supercheck')).toBe(74);
    expect(score('hangman', 'chess')).toBe(17);
    expect(score('3dword', '3dwords')).toBe(92);
  });

  it('is 100 for the same name and 0 for nothing', () => {
    expect(score('iching', 'iching')).toBe(100);
    expect(score('', 'iching')).toBe(0);
    expect(score('iching', '')).toBe(0);
  });

  /**
   * The prefix rule: a truncated disk filename should still reach its
   * screenshot. `iching` against `ichingprogram` scores 63 on similarity
   * alone, which would never be offered.
   */
  it('lifts a prefix match to the tick threshold', () => {
    expect(score('iching', 'ichingprogram')).toBe(80);
    expect(score('banner', 'bannerall')).toBe(80);
  });

  it('does not lift a prefix too short to mean anything', () => {
    // Three characters opening a longer name is a coincidence, not a match.
    expect(score('abc', 'abcdefghij')).toBeLessThan(AUTOFILL_THRESHOLD);
  });
});

describe('matching a program to the folder', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const put = (...names: string[]) => {
    for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
  };

  it('finds the screenshot named after the program', () => {
    put('i ching.png', 'hangman.png', 'unrelated.png');
    const m = matchScreenshots(dir, ['I Ching']);
    expect(m[0].name).toBe('i ching.png');
    expect(m[0].grade).toBe('exact');
  });

  it('offers a whole numbered set together', () => {
    // Matching one of a set and not the others would read as the rest being
    // rejected.
    put('3d-word-1.png', '3d-word-2.png', '3d-word-3.png');
    const m = matchScreenshots(dir, ['3D WORD']);
    expect(m.map((x) => x.name)).toEqual(['3d-word-1.png', '3d-word-2.png', '3d-word-3.png']);
  });

  /** The importer's own example of why the tick threshold is 80. */
  it('offers a near miss without ticking it', () => {
    put('invaders.png');
    const [m] = matchScreenshots(dir, ['invert']);
    expect(m.grade).toBe('check');
    expect(m.score).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
    expect(m.score).toBeLessThan(AUTOFILL_THRESHOLD);
  });

  it('says nothing rather than offering something unrelated', () => {
    put('chess.png');
    expect(matchScreenshots(dir, ['Hangman'])).toEqual([]);
  });

  it('matches on any of the names the program goes by', () => {
    put('hangman.png');
    // The disk calls it something generic; the title being published does not.
    expect(matchScreenshots(dir, ['AUTOSTART', 'Hangman'])).toHaveLength(1);
  });

  it('ignores dotfiles and anything that is not a picture', () => {
    put('.DS_Store', 'notes.txt', 'iching.png');
    expect(listScreenshots(dir).map((f) => f.name)).toEqual(['iching.png']);
  });

  it('has nothing to say about a folder that is not there', () => {
    expect(listScreenshots(path.join(dir, 'nope'))).toEqual([]);
    expect(matchScreenshots(path.join(dir, 'nope'), ['Hangman'])).toEqual([]);
  });
});
