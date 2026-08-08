import { describe, it, expect } from 'vitest';
import { harvestUsrTargets, harvestCodeAddresses } from '../electron/parsers/disasm-entry-points';
import { canDisassemble, disassemble, disassembleForExport } from '../electron/parsers/disasm';
import { isTextData } from '../electron/parsers/utils';
import { isTextData as rendererIsTextData } from '../src/api';
import type { BasicListing } from '../electron/parsers/basic-detokenizer';
import type { FileEntry } from '../electron/parsers/types';

/** A listing of one line per string, as the detokenizer would render it. */
const listing = (...lines: string[]) => ({
  lines: lines.map((text, i) => ({ lineNumber: i + 1, tokens: [{ text }] })),
} as unknown as BasicListing);

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
