import { describe, it, expect } from 'vitest';
import { harvestUsrTargets, harvestCodeAddresses, harvestUsrReferences } from '../electron/parsers/disasm-entry-points';
import { canDisassemble, disassemble, disassembleForExport } from '../electron/parsers/disasm';
import { isTextData } from '../electron/parsers/utils';
import { isTextData as rendererIsTextData } from '../src/api';
import type { FileEntry } from '../electron/parsers/types';

import { listing } from './helpers/basic';

describe('harvesting USR entry points', () => {
  it('reads the plain numeric form', () => {
    expect(harvestUsrTargets(listing('RANDOMIZE USR 32768'))).toEqual([32768]);
  });

  it('reads VAL "…", which is how the address is usually written', () => {
    // A number costs five bytes of inline floating point after its digits;
    // VAL "54016" costs none, so BASIC of this era is full of it.
    expect(harvestUsrTargets(listing('IF P$="Y" THEN RANDOMIZE USR VAL "54016"'))).toEqual([54016]);
    expect(harvestUsrTargets(listing('LET x=USR VAL"23760"'))).toEqual([23760]);
  });

  it('finds both forms in one program, without duplicates', () => {
    // The VAL operand must contribute an address of its own, or removing VAL
    // support would still satisfy this.
    expect(harvestUsrTargets(listing('RANDOMIZE USR 100', 'RANDOMIZE USR VAL "100"', 'PRINT USR VAL "40000"')))
      .toEqual([100, 40000]);
  });

  it('leaves alone the forms that cannot be resolved without running the program', () => {
    // Each of these would have to be guessed at, and a wrong seed makes the
    // tracer walk data while reporting instructions.
    for (const src of ['RANDOMIZE USR h', 'RANDOMIZE USR FN a()', 'LET n=USR CODE "n"',
      'RANDOMIZE USR VAL "B+11"', 'RANDOMIZE USR ("a"+G)']) {
      expect(harvestUsrTargets(listing(src)), src).toEqual([]);
    }
  });

  it('rejects an operand too large to be an address', () => {
    expect(harvestUsrTargets(listing('RANDOMIZE USR 70000'))).toEqual([]);
  });

  it('reads a CODE load address in either spelling', () => {
    expect(harvestCodeAddresses(listing('LOAD "pic" CODE 16384,6912')))
      .toEqual([{ filename: 'pic', addr: 16384, length: 6912 }]);
    expect(harvestCodeAddresses(listing('LOAD "pic" CODE VAL "16384", VAL "6912"')))
      .toEqual([{ filename: 'pic', addr: 16384, length: 6912 }]);
  });
});

describe('telling a document from a program', () => {
  const text = Buffer.from('THE CHARTER AND BY-LAWS OF THE SINCLAIR COMPUTER USERS SOCIETY\r\n'.repeat(20));
  const code = Buffer.from(Array.from({ length: 512 }, (_, i) => [0xcd, 0x38, 0x00, 0xf3, 0xdd, 0x21][i % 6]));
  const make = (over: Partial<FileEntry>) => ({
    index: 0, filename: 'X', type: 'code', size: 1024, isDirectory: false, params: {}, ...over,
  } as unknown as FileEntry);

  it('calls prose text and machine code not', () => {
    expect(isTextData(text)).toBe(true);
    expect(isTextData(code)).toBe(false);
    expect(isTextData(Buffer.alloc(0))).toBe(false);
  });

  it('is decided the same way on both sides of the IPC boundary', () => {
    for (const d of [text, code, Buffer.alloc(0), Buffer.from([0x41, 0x42, 0x00, 0x01])]) {
      expect(rendererIsTextData(d), d.subarray(0, 8).toString('latin1')).toBe(isTextData(d));
    }
  });

  it('refuses a disassembly for a document saved as CODE', () => {
    // 264 of the 294 files that reached the disassembler across the sample
    // disks were articles like this one.
    expect(canDisassemble('larken', make({}), text)).toBe(false);
    expect(canDisassemble('larken', make({}), code)).toBe(true);
  });

  it('still decides without the bytes, for the catalog view', () => {
    expect(canDisassemble('larken', make({}))).toBe(true);
    expect(canDisassemble('larken', make({ type: 'basic' }))).toBe(false);
  });

  it('does not apply the text test to a ZX81 memory image', () => {
    // Its character set is not ASCII, so the ratio means nothing there.
    expect(canDisassemble('zx81-aerco', make({}), text)).toBe(true);
  });
});

describe('a listing nothing supports', () => {
  const make = (over: Partial<FileEntry>) => ({
    index: 0, filename: 'F', type: 'code', size: 8, isDirectory: false, params: {}, ...over,
  } as unknown as FileEntry);
  // Bytes that decode cleanly but say nothing: PUSH HL / NOP, which is what
  // the Oliger V1 files on the TIMACHINE disks are made of.
  const data = Buffer.from([0xe5, 0x00, 0xe5, 0x00, 0xe5, 0x00, 0xe5, 0x00]);

  it('is marked speculative when neither the origin nor an entry point is known', () => {
    const r = disassemble({ format: 'oliger-v1', entry: make({}), data, siblings: [] })!;
    expect(r.speculative).toBe(true);
    expect(r.origin).toBe(0);
    expect(r.text).toContain('a guess, not a reading');
    expect(r.sidecar.speculative).toBe(true);
  });

  it('is not speculative once the file header gives a load address', () => {
    const r = disassemble({
      format: 'oliger-v1', entry: make({ params: { startAddr: 0x8000 } as never }), data, siblings: [],
    })!;
    expect(r.speculative).toBe(false);
  });

  it('is not speculative once the reader supplies an origin', () => {
    const r = disassemble({ format: 'oliger-v1', entry: make({}), data, siblings: [], originOverride: 0xf000 })!;
    expect(r.speculative).toBe(false);
  });

  it('is shown in the viewer but never written out', () => {
    // The viewer still gets it, because the origin control is how a reader
    // corrects it; the .dis is an archival record and this is not one.
    expect(disassemble({ format: 'oliger-v1', entry: make({}), data, siblings: [] })).not.toBeNull();
    expect(disassembleForExport({
      format: 'oliger-v1', entry: make({}), data, loaders: [], source: 'd.img',
    })).toBeNull();
  });

  it('is written out once the reader has said where it loads', () => {
    const r = disassembleForExport({
      format: 'oliger-v1', entry: make({}), data, loaders: [], source: 'd.img',
      settings: { origin: 0xf000 },
    });
    expect(r).not.toBeNull();
    expect(r!.origin).toBe(0xf000);
  });
});

describe('numbers written with an exponent', () => {
  it('reads USR 6e4 as 60000, not as address 6', () => {
    // Sinclair BASIC accepts an exponent and this is a real way to write it.
    // 14 operands across the sample disks are written this way; matching only
    // the leading digits turned them into 6, 62 and 4.
    expect(harvestUsrTargets(listing('RANDOMIZE USR 6e4'))).toEqual([60000]);
    expect(harvestUsrTargets(listing('RANDOMIZE USR 62e3'))).toEqual([62000]);
    expect(harvestUsrTargets(listing('RANDOMIZE USR 4E4'))).toEqual([40000]);
    expect(harvestUsrTargets(listing('LET L= USR VAL "3e3"'))).toEqual([3000]);
  });

  it('still rejects one that lands outside the address space', () => {
    expect(harvestUsrTargets(listing('RANDOMIZE USR 7e4'))).toEqual([]);
  });

  it('does not invent a fractional address', () => {
    expect(harvestUsrTargets(listing('RANDOMIZE USR 1e-2'))).toEqual([]);
  });
});

describe('recording which BASIC line calls an entry point', () => {
  it('keeps the caller, the line number and the text', () => {
    const refs = harvestUsrReferences(listing('PRINT ;:LET L= USR VAL "51461"'), 'CREATOR');
    expect(refs).toEqual([
      { addr: 51461, from: 'CREATOR', lineNumber: 1, text: 'PRINT ;:LET L= USR VAL "51461"' },
    ]);
  });

  it('records each distinct address on a line once', () => {
    const refs = harvestUsrReferences(listing('LET l= USR 61704+ USR 61209+ USR 61704'), 'QUICK SCRN');
    expect(refs.map((r) => r.addr)).toEqual([61704, 61209]);
  });

  it('reaches the .dis header and the sidecar', () => {
    const entry = {
      index: 0, filename: 'LIB', type: 'code', size: 4, isDirectory: false,
      params: { startAddr: 0x8000 },
    } as unknown as FileEntry;
    const caller = { index: 1, filename: 'MENU', type: 'basic' } as unknown as FileEntry;
    const r = disassemble({
      format: 'oliger-v2', entry, data: Buffer.from([0xc9, 0, 0, 0]),
      siblings: [{ entry: caller, listing: listing('LET x= USR 32768: REM draw the border') }],
    })!;
    expect(r.text).toContain('entry points, and the BASIC that calls them');
    expect(r.text).toContain('MENU line 1: LET x= USR 32768: REM draw the border');
    expect(r.text).toContain('called from 1 BASIC program(s): MENU');
    expect(r.sidecar.callSites).toEqual([
      { addr: '$8000', from: 'MENU', line: 1, text: 'LET x= USR 32768: REM draw the border' },
    ]);
  });
});

describe('how much of a calling line is kept', () => {
  const short = 'PRINT ;:LET L= USR VAL "51461"';
  // Filler that is not a REM: a USR after a REM is not a call, so padding with
  // one would test the wrong thing.
  const pad = (n: number) => 'POKE 0,0:'.repeat(Math.ceil(n / 9)).slice(0, n);

  it('keeps an ordinary line whole', () => {
    // The median calling line is 47 characters, so nearly all survive intact.
    expect(harvestUsrReferences(listing(short), 'F')[0].text).toBe(short);
  });

  it('keeps the call itself when the line is too long to keep whole', () => {
    // The defect this fixes: a flat cut from the start dropped the call on 231
    // of 2950 call sites, leaving a line that did not contain what it
    // documented. A USR sits as far in as character 2922.
    const line = `${pad(400)}:RANDOMIZE USR 60000:${pad(400)}`;
    const [ref] = harvestUsrReferences(listing(line), 'F');
    expect(ref.addr).toBe(60000);
    expect(ref.text).toContain('USR 60000');
  });

  it('marks where text was dropped, at whichever end it was dropped from', () => {
    const [middle] = harvestUsrReferences(listing(`${pad(400)}:RANDOMIZE USR 60000:${pad(400)}`), 'F');
    expect(middle.text.startsWith('…')).toBe(true);
    expect(middle.text.endsWith('…')).toBe(true);

    const [atStart] = harvestUsrReferences(listing(`RANDOMIZE USR 60000:${pad(400)}`), 'F');
    expect(atStart.text.startsWith('…')).toBe(false);
    expect(atStart.text.endsWith('…')).toBe(true);

    const [atEnd] = harvestUsrReferences(listing(`${pad(400)}:RANDOMIZE USR 60000`), 'F');
    expect(atEnd.text.startsWith('…')).toBe(true);
    expect(atEnd.text.endsWith('…')).toBe(false);
  });

  it('stays short enough to read in a header', () => {
    // A real line runs to 4854 characters; a header full of those is unusable.
    const [ref] = harvestUsrReferences(listing(`${pad(3000)}:RANDOMIZE USR 60000:${pad(3000)}`), 'F');
    expect(ref.text.length).toBeLessThanOrEqual(160);
  });

  it('gives each call on a long line its own window', () => {
    const line = `RANDOMIZE USR 40000:${pad(300)}:RANDOMIZE USR 50000`;
    const refs = harvestUsrReferences(listing(line), 'F');
    expect(refs.map((r) => r.addr)).toEqual([40000, 50000]);
    expect(refs[0].text).toContain('USR 40000');
    expect(refs[1].text).toContain('USR 50000');
  });
});

describe('a USR inside a REM', () => {
  it('is not a call, because REM ends execution for the line', () => {
    // A REM holding machine code is normal on these machines — it is how a
    // program carries a routine, and POKEing its line number to 0 to protect
    // it is normal too. The detokenizer renders those bytes as BASIC keywords,
    // so a $C0 among them comes out spelled `USR`. GRANDPRIX has four such
    // phantoms, each yielding address 0.
    expect(harvestUsrTargets(listing('REM  USR 999'))).toEqual([]);
    expect(harvestUsrTargets(listing('RANDOMIZE USR 32768: REM  USR 999'))).toEqual([32768]);
  });

  it('does not stop the same line contributing its real calls', () => {
    const refs = harvestUsrReferences(listing('LET a= USR 40000: REM  USR 0 USR 0'), 'F');
    expect(refs.map((r) => r.addr)).toEqual([40000]);
  });

  it('is decided by token type, not by looking for the word REM', () => {
    // "REM " inside a string is not a REM. Matching on the spelling would end
    // the line here and lose the call that follows.
    expect(harvestUsrTargets(listing('PRINT "REM ONLY": RANDOMIZE USR 32768')))
      .toEqual([32768]);
  });
});

describe('the shape the detokenizer actually emits', () => {
  /** Tokens exactly as the Spectrum detokenizer produced them for a real line. */
  const raw = (...tokens: [string, string][]) => ({
    lines: [{ lineNumber: 1841, tokens: tokens.map(([type, text]) => ({ type, text })) }],
  } as never);

  it('reads a USR token that carries a leading space', () => {
    // `LET z= USR 59013` comes out with the space attached to the keyword:
    // function:" USR ". Anchoring the operand pattern at the token start
    // without allowing that space silently dropped 141 real call sites, and
    // cost 4 files their entry point.
    const refs = harvestUsrReferences(raw(
      ['statement', 'LET '], ['text', 'z'], ['text', '='],
      ['function', ' USR '], ['text', '5'], ['text', '9'], ['text', '0'],
      ['text', '1'], ['text', '3'],
    ), 'ART 2.27');
    expect(refs.map((r) => r.addr)).toEqual([59013]);
    expect(refs[0].lineNumber).toBe(1841);
  });

  it('reads one without a leading space just the same', () => {
    const refs = harvestUsrReferences(raw(
      ['statement', 'RANDOMIZE '], ['function', 'USR '],
      ['text', '3'], ['text', '2'], ['text', '7'], ['text', '6'], ['text', '8'],
    ), 'F');
    expect(refs.map((r) => r.addr)).toEqual([32768]);
  });
});
