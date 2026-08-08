import { describe, it, expect } from 'vitest';
import { canDisassemble } from '../electron/parsers/disasm';
import { isScreenEntry, SCREEN_SIZE } from '../electron/parsers/screen-decoder';
import { isScreenEntry as rendererIsScreenEntry } from '../src/api';
import type { FileEntry } from '../electron/parsers/types';

const make = (over: Partial<FileEntry>) => ({
  index: 0, filename: 'X', type: 'code', size: 1024, isDirectory: false, params: {},
  ...over,
} as unknown as FileEntry);

describe('telling a SCREEN$ from a program', () => {
  it('is exactly 6912 bytes of CODE', () => {
    expect(isScreenEntry(make({ type: 'code', size: SCREEN_SIZE }))).toBe(true);
    expect(isScreenEntry(make({ type: 'code', size: SCREEN_SIZE - 1 }))).toBe(false);
    expect(isScreenEntry(make({ type: 'code', size: SCREEN_SIZE + 1 }))).toBe(false);
    expect(isScreenEntry(make({ type: 'basic', size: SCREEN_SIZE }))).toBe(false);
  });

  it('does not depend on the load address', () => {
    // The tempting refinement. 13 of the 44 screens on the sample disks record
    // $5F00 rather than $4000 — the same ones the catalog flags as damaged —
    // so requiring $4000 would send them all back to the disassembler.
    for (const startAddr of [0x4000, 0x5f00, undefined]) {
      expect(isScreenEntry(make({ type: 'code', size: SCREEN_SIZE, params: { startAddr } as never })))
        .toBe(true);
    }
  });

  it('is decided the same way on both sides of the IPC boundary', () => {
    // The renderer cannot import the main process's copy, so this is the only
    // thing stopping the two drifting apart.
    for (const e of [
      { type: 'code', size: SCREEN_SIZE }, { type: 'code', size: 1024 },
      { type: 'basic', size: SCREEN_SIZE }, { type: 'module', size: SCREEN_SIZE },
      { type: 'code', size: 0 },
    ]) {
      expect(rendererIsScreenEntry(e), JSON.stringify(e)).toBe(isScreenEntry(e));
    }
  });
});

describe('what gets offered a disassembly', () => {
  it('refuses a SCREEN$, whose pixels would trace as confident nonsense', () => {
    expect(canDisassemble('larken', make({ type: 'code', size: SCREEN_SIZE }))).toBe(false);
  });

  it('still accepts ordinary code and modules', () => {
    expect(canDisassemble('larken', make({ type: 'code', size: 1024 }))).toBe(true);
    expect(canDisassemble('larken', make({ type: 'module', size: 1024 }))).toBe(true);
    // A module that happens to be screen-sized is not a screen: screens are
    // saved as CODE.
    expect(canDisassemble('larken', make({ type: 'module', size: SCREEN_SIZE }))).toBe(true);
  });

  it('keeps refusing directories and empty files', () => {
    expect(canDisassemble('larken', make({ isDirectory: true }))).toBe(false);
    expect(canDisassemble('larken', make({ size: 0 }))).toBe(false);
  });

  it('leaves the ZX81 alone, which has no 6912-byte screen', () => {
    // Its display file is a variable-length collapsed bitmap, and a .p file of
    // 6912 bytes is just a program that size.
    expect(canDisassemble('zx81-aerco', make({ type: 'code', size: SCREEN_SIZE }))).toBe(true);
  });
});
