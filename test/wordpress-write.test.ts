import { describe, it, expect } from 'vitest';
import { slashForWordPress, WpWriter } from '../electron/wordpress-write';
import { keywordsUsed, matchVocabulary, deriveModel, deriveTags, UDG_TERM } from '../electron/wordpress-derive';
import type { BasicListing } from '../electron/parsers/basic-detokenizer';
import type { DiskFormat } from '../electron/parsers/types';

/**
 * The rules here were established by running each case against a real site,
 * because the answers are not what the documentation implies. These lock in
 * what was measured, so a later change cannot quietly undo it.
 */

describe('slashing a listing on the way to WordPress', () => {
  /**
   * WordPress strips one level of backslashes on write. Doubling them first
   * is what the CSV importer's wp_slash() does, and what makes a listing come
   * back as the zmakebas source it went in as.
   */
  it('doubles every backslash', () => {
    expect(slashForWordPress('10 REM \\a\\b\\c')).toBe('10 REM \\\\a\\\\b\\\\c');
    expect(slashForWordPress('\\{16}\\{2}')).toBe('\\\\{16}\\\\{2}');
  });

  it('doubles a backslash that is itself escaped', () => {
    // `\\` in a listing is a literal backslash; unslashed it would become one
    // backslash, so it has to leave here as four.
    expect(slashForWordPress('a literal backslash: \\\\')).toBe('a literal backslash: \\\\\\\\');
  });

  it('leaves a listing with no escapes alone', () => {
    expect(slashForWordPress('10 PRINT "HELLO"')).toBe('10 PRINT "HELLO"');
  });

  /** What the site does on the way in, so the round trip can be asserted. */
  const unslash = (s: string) => s.replace(/\\(.)/g, '$1');

  it('round-trips every escape the archive uses', () => {
    const listing = [
      '  10 REM \\a\\b\\c UDGs',
      '  20 PRINT "\\{16}\\{2}red \\{22}\\{10}\\{5}at 10,5"',
      "  30 PRINT \"\\' \\ . \\: \\  mosaics\"",
      '  40 REM a literal backslash: \\\\',
      '  50 PRINT "\\*1984 \\{92}"',
    ].join('\n');

    expect(unslash(slashForWordPress(listing))).toBe(listing);
  });
});

describe('putting the describer\'s answer on the record', () => {
  /**
   * The describer returns three things and they are not interchangeable:
   * a factual paragraph, a one-sentence teaser, and the technical analysis in
   * HTML — which is the substance. Writing only the paragraph, as this first
   * did, threw the analysis away and left a record with one paragraph where
   * the reading of the program should be.
   */
  const bodySentTo = async (
    description: string, teaser: string, analysis: string,
  ): Promise<{ content?: string; excerpt?: string } | null> => {
    let sent: any = null;
    const w = new WpWriter('http://wp.test', { user: 'u', password: 'p' });
    (globalThis as any).fetch = async (_url: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await w.applyDescription(1, description, teaser, analysis);
    return sent;
  };

  it('puts the analysis in the body, under the summary', async () => {
    const sent = await bodySentTo('A chess program.', 'Plays chess.', '<p>It uses <code>DEF FN</code>.</p>');
    expect(sent!.content).toContain('<p>A chess program.</p>');
    expect(sent!.content).toContain('<hr />');
    expect(sent!.content).toContain('<code>DEF FN</code>');
    // The order matters: summary first, then the analysis under a rule.
    expect(sent!.content!.indexOf('A chess program')).toBeLessThan(sent!.content!.indexOf('DEF FN'));
    expect(sent!.excerpt).toBe('Plays chess.');
  });

  it('writes what it has when the describer returns only some of it', async () => {
    const sent = await bodySentTo('', 'Plays chess.', '<p>Analysis.</p>');
    expect(sent!.content).toBe('<p>Analysis.</p>');
    expect(sent!.excerpt).toBe('Plays chess.');
  });

  it('asks for nothing when there is nothing to say', async () => {
    expect(await bodySentTo('', '', '')).toBeNull();
  });
});

describe('reading the BASIC keywords off a program', () => {
  const listing = (...tokens: { type: string; text: string }[]): BasicListing =>
    ({ lines: [{ lineNumber: 10, tokens: tokens as any }] });

  it('names keywords the way the vocabulary spells them', () => {
    // The detokenizer carries a trailing space on most keywords and none on
    // others; neither is part of the keyword's name.
    const used = keywordsUsed(listing(
      { type: 'function', text: 'SCREEN$ ' },
      { type: 'statement', text: 'OPEN #' },
      { type: 'function', text: 'VAL$ ' },
    ));
    expect(used).toEqual(['OPEN #', 'SCREEN$', 'VAL$']);
  });

  it('ignores the reader\'s own text', () => {
    const used = keywordsUsed(listing(
      { type: 'statement', text: 'PRINT ' },
      { type: 'text', text: 'RANDOMIZE is not a keyword here' },
    ));
    expect(used).toEqual(['PRINT']);
  });

  it('notices a program that carries its own characters', () => {
    const used = keywordsUsed(listing(
      { type: 'statement', text: 'PRINT ' },
      { type: 'udg', text: '\\a' },
    ));
    expect(used).toContain(UDG_TERM);
  });

  it('reports each keyword once however often it is used', () => {
    const used = keywordsUsed({
      lines: [
        { lineNumber: 10, tokens: [{ type: 'statement', text: 'PRINT ' }] as any },
        { lineNumber: 20, tokens: [{ type: 'statement', text: 'PRINT ' }] as any },
      ],
    });
    expect(used).toEqual(['PRINT']);
  });
});

describe('matching keywords against the site vocabulary', () => {
  const vocab = [
    { id: 7752, name: 'DEF FN' },
    { id: 7760, name: 'VAL$' },
    { id: 7765, name: UDG_TERM },
  ];

  it('matches on name, ignoring case', () => {
    const { matched } = matchVocabulary(['def fn', 'VAL$'], vocab);
    expect(matched.map((t) => t.id)).toEqual([7752, 7760]);
  });

  /**
   * A keyword the archive has never filed is reported, never created. The
   * vocabulary is small and deliberate; growing it is a decision.
   */
  it('reports a keyword the vocabulary has never heard of', () => {
    const { matched, unmatched } = matchVocabulary(['DEF FN', 'CIRCLE'], vocab);
    expect(matched.map((t) => t.name)).toEqual(['DEF FN']);
    expect(unmatched).toEqual(['CIRCLE']);
  });
});

describe('the machine a disk speaks for', () => {
  it('offers the badge that was on most American ZX81s, and says what else it could be', () => {
    const m = deriveModel('zx81-aerco')!;
    expect(m.name).toBe('Timex/Sinclair 1000');
    expect(m.alternatives).toContain('Sinclair ZX81');
  });

  it('reads a TS2068 disk as a TS2068', () => {
    const ts2068: DiskFormat[] = ['larken', 'oliger-v1', 'oliger-v2', 'aerco-dos64', 'tap', 'tzx'];
    for (const f of ts2068) expect(deriveModel(f)!.name).toBe('Timex/Sinclair 2068');
  });

  it('reads both ZX81 carriers the same way', () => {
    for (const f of ['zx81-aerco', 'zx81-tzx'] as DiskFormat[]) {
      expect(deriveModel(f)!.name).toBe('Timex/Sinclair 1000');
    }
  });

  it('reads a QL disk as a QL', () => {
    expect(deriveModel('ql')!.name).toBe('Sinclair QL');
  });

  it('has nothing to say about an operating system\'s files', () => {
    // Aerco RP/M and Zebra are CP/M: data for an OS, not a machine's programs.
    for (const f of ['aerco-rpm', 'zebra-cpm', 'zebra-dirscp'] as DiskFormat[]) {
      expect(deriveModel(f)).toBeNull();
    }
  });
});

describe('the tags that follow from what is already known', () => {
  it('tags the machine and the year', () => {
    expect(deriveTags('Timex/Sinclair 2068', '1984')).toEqual(['TS 2068', '1984']);
    expect(deriveTags('Timex/Sinclair 1000', '1983')).toEqual(['TS 1000', '1983']);
  });

  /** `198x` is a useful thing to record and a useless thing to tag with. */
  it('does not tag a year that is not one', () => {
    expect(deriveTags('Timex/Sinclair 2068', '198x')).toEqual(['TS 2068']);
    expect(deriveTags('Timex/Sinclair 2068', '')).toEqual(['TS 2068']);
  });

  it('says nothing about a machine it could not name', () => {
    expect(deriveTags(null, '1984')).toEqual(['1984']);
  });
});
