import { describe, it, expect } from 'vitest';
import {
  harvestUsrTargets, harvestCodeAddresses, zx81RemCodeStarts, planDisassembly,
} from '../electron/parsers/disasm-entry-points';
import type { FileEntry } from '../electron/parsers/types';

import { numberedListing as listing } from './helpers/basic';

const entry = (over: Partial<FileEntry> = {}): FileEntry => ({
  index: 0, filename: 'TEST', type: 'code', typeName: 'CODE', size: 16,
  params: {}, blocks: [], isMemoryDump: false, isDirectory: false, metadata: {}, ...over,
});

describe('harvesting USR targets', () => {
  it('picks up the operands a program calls', () => {
    expect(harvestUsrTargets(listing([1, 'RAND USR 16514'], [500, 'RAND USR 17116'])))
      .toEqual([16514, 17116]);
  });

  it('deduplicates and sorts', () => {
    expect(harvestUsrTargets(listing([1, 'RAND USR 100'], [2, 'PRINT USR 100'], [3, 'LET X=USR 50'])))
      .toEqual([50, 100]);
  });

  it('rejects an operand that cannot be an address', () => {
    expect(harvestUsrTargets(listing([1, 'RAND USR 70000']))).toEqual([]);
  });
});

describe('harvesting a CODE file load address', () => {
  it('reads the ORG out of a SAVE line', () => {
    // The real line from cale27.B1 on larken.img.
    expect(harvestCodeAddresses(listing([9991, 'PRINT USR 100:SAVE "cale27.C1"CODE 63064,2464'])))
      .toEqual([{ filename: 'cale27.C1', addr: 63064, length: 2464 }]);
  });

  it('reads one from a LOAD line, where no length is given', () => {
    expect(harvestCodeAddresses(listing([9980, 'LOAD "x.C1"CODE 32768'])))
      .toEqual([{ filename: 'x.C1', addr: 32768 }]);
  });
});

describe('ZX81 REM code starts', () => {
  it('finds the machine code five bytes into a line-0 REM', () => {
    // Program area starts at offset $74. Line 0, length 12, first token REM.
    const data = Buffer.alloc(0x74 + 4 + 12);
    data[0x74] = 0; data[0x75] = 0;          // line number 0, big-endian
    data[0x76] = 12; data[0x77] = 0;         // length, little-endian
    data[0x78] = 0xea;                       // REM
    expect(zx81RemCodeStarts(data, data.length)).toEqual([0x79]);
    // $4009 + $79 = $4082 — the address BBDOS's own line 1 calls.
    expect(0x4009 + 0x79).toBe(16514);
  });

  it('ignores a REM too short to hold code', () => {
    const data = Buffer.alloc(0x74 + 4 + 2);
    data[0x76] = 2; data[0x78] = 0xea;
    expect(zx81RemCodeStarts(data, data.length)).toEqual([]);
  });
});

describe('planning a disassembly', () => {
  it('puts a ZX81 file at VERSN and seeds it from the BASIC', () => {
    const data = Buffer.alloc(0x200);
    const plan = planDisassembly({
      format: 'zx81-aerco',
      entry: entry({ type: 'basic', params: { progEnd: 0x200 } }),
      data,
      listing: listing([1, 'RAND USR 16514'], [2, 'RAND USR 11000']),
    })!;
    expect(plan.origin).toBe(0x4009);
    expect(plan.machine.id).toBe('zx81');
    expect(plan.seeds).toEqual([16514]);       // inside the file
    expect(plan.external).toEqual([11000]);    // the Aerco board, outside it
  });

  it('takes a TS2068 CODE file origin from whichever loader names it', () => {
    const loader = entry({ index: 1, filename: 'cale27.B1', type: 'basic' });
    const plan = planDisassembly({
      format: 'larken',
      entry: entry({ filename: 'cale27.C1', size: 2464 }),
      data: Buffer.alloc(2464),
      siblings: [{ entry: loader, listing: listing([9991, 'SAVE "cale27.C1"CODE 63064,2464']) }],
    })!;
    expect(plan.origin).toBe(63064);
    expect(plan.notes.join(' ')).toContain('cale27.B1');
  });

  it('falls back to the first byte when nothing points into the file', () => {
    const plan = planDisassembly({
      format: 'larken', entry: entry({ params: { startAddr: 0x8000 } }), data: Buffer.alloc(16),
    })!;
    expect(plan.seeds).toEqual([0x8000]);
    expect(plan.notes.join(' ')).toContain('first byte');
  });
});
