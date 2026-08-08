import { describe, it, expect } from 'vitest';
import { emit, resolve } from '../electron/parsers/disasm-emit';
import type { SymbolPack } from '../electron/parsers/disasm-emit';
import { trace, SPECTRUM } from '../electron/parsers/z80-trace';

const ORG = 0x8000;
const rom: SymbolPack = {
  id: 'rom', name: 'Machine ROM', range: [0x0000, 0x3fff], provenance: 'documented',
  symbols: { 0x0010: { name: 'PRINT-A' }, 0x0064: { name: 'FILLER' }, 0x1b7a: { name: 'MAIN-4', approx: true } },
};
const dos: SymbolPack = {
  id: 'dos', name: 'Disk interface', range: [0x0000, 0x00ff], provenance: 'manual',
  symbols: { 0x0064: { name: 'CARTOFF', note: 'turn the cartridge off' } },
};

describe('symbol resolution', () => {
  it('lets a later pack win inside its range', () => {
    // $0064 is filler in the machine ROM but a cartridge control on this board;
    // resolving it against the ROM would be a confident mislabel.
    expect(resolve(0x0064, [rom, dos])?.name).toBe('CARTOFF');
    expect(resolve(0x0064, [rom])?.name).toBe('FILLER');
  });

  it('does not apply a pack outside its range', () => {
    expect(resolve(0x4000, [rom, dos])).toBeNull();
  });

  it('carries the approximate flag through', () => {
    expect(resolve(0x1b7a, [rom])).toMatchObject({ name: 'MAIN-4', approx: true });
  });
});

describe('the .dis text', () => {
  const bytes = Buffer.from([0xcd, 0x10, 0x00, 0xcd, 0x64, 0x00, 0xc9]);
  const run = (packs: SymbolPack[]) => {
    const r = trace(bytes, ORG, [ORG], { machine: SPECTRUM });
    return emit(bytes, r, { title: 'T', origin: ORG, packs, checksum: 'abc123' });
  };

  it('names a call the packs know', () => {
    expect(run([rom, dos])).toContain('CALL $0010                  ; PRINT-A');
  });

  it('marks an approximate name so a reader is not handed false precision', () => {
    const packs = [{ ...rom, symbols: { 0x0010: { name: 'MAYBE', approx: true } } }];
    const text = run(packs);
    expect(text).toContain('; MAYBE?');
    expect(text).toContain('only approximately');
  });

  it('lists the calls leaving the file, with the DOS pack winning', () => {
    const text = run([rom, dos]);
    expect(text).toContain('CARTOFF — turn the cartridge off');
  });

  it('records the checksum and every pack it used', () => {
    const text = run([rom, dos]);
    expect(text).toContain('; sha256 abc123');
    expect(text).toContain('; symbols: Machine ROM — documented');
    expect(text).toContain('; symbols: Disk interface — manual');
  });

  it('accounts for every byte of the input', () => {
    // One unreached byte after the RET must still appear.
    const withTail = Buffer.concat([bytes, Buffer.from([0xff])]);
    const r = trace(withTail, ORG, [ORG], { machine: SPECTRUM });
    const text = emit(withTail, r, { title: 'T', origin: ORG });
    expect(text).toContain('DEFB $FF');
  });

  it('is reproducible — same bytes and packs give an identical file', () => {
    expect(run([rom, dos])).toBe(run([rom, dos]));
  });

  it('contains nothing that varies between runs', () => {
    const text = run([rom, dos]);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);   // no timestamp
    expect(text).not.toMatch(/\/(Users|home|tmp)\//); // no filesystem path
  });
});
