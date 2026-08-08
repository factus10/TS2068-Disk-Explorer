import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { disassemble } from '../electron/parsers/disasm';
import type { FileEntry } from '../electron/parsers/types';

const DIR = path.join(__dirname, '..', 'electron', 'data', 'symbols');
const pack = (id: string) => JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
const nameAt = (p: { symbols: Record<string, { name: string }> }, addr: number) =>
  p.symbols[String(addr)]?.name ?? null;

describe('the TS2068 EXROM pack', () => {
  const exrom = pack('ts2068-exrom');
  const home = pack('ts2068-home');

  it('covers the whole EXROM and nothing outside it', () => {
    expect(exrom.range).toEqual([0x0000, 0x1fff]);
    for (const a of Object.keys(exrom.symbols)) {
      expect(Number(a), `${a} is outside the EXROM`).toBeLessThanOrEqual(0x1fff);
    }
    expect(Object.keys(exrom.symbols).length).toBeGreaterThan(100);
  });

  it('places the restart vectors where the entry-point tables independently put them', () => {
    // The listing this pack is walked from names these; the entry-point
    // markdown, written separately, gives the same addresses.
    expect(nameAt(exrom, 0x0000)).toBe('XRST0');
    expect(nameAt(exrom, 0x0008)).toBe('XRST8');
    expect(nameAt(exrom, 0x0038)).toBe('XRST38');
  });

  it('disagrees with the HOME ROM wherever both name an address', () => {
    // The point of a separate pack. These are two different ROMs at the same
    // addresses, so a shared address holding the same name would mean one of
    // them had been contaminated by the other.
    const shared = Object.keys(exrom.symbols)
      .filter((a) => home.symbols[a])
      .filter((a) => exrom.symbols[a].name === home.symbols[a].name);
    expect(shared, `these names appear in both packs: ${shared.join(', ')}`).toEqual([]);
  });

  it('keeps $0605 apart, which is BEEPER in one ROM and LD-ALL in the other', () => {
    // A heading reading "Tape Routines (HOME ROM remnants; most are in EXROM)"
    // was matched as EXROM, which dropped these two rows from the HOME pack and
    // gave BEEPER an EXROM address it does not have.
    expect(nameAt(home, 0x0605)).toBe('BEEPER');
    expect(nameAt(home, 0x0507)).toBe('BEEP');
    expect(nameAt(exrom, 0x0605)).toBe('LD-ALL');
  });
});

describe('choosing packs for a disk', () => {
  const entry = {
    index: 0, filename: 'CODE', type: 'code', size: 16, isDirectory: false,
    params: { startAddr: 0x8000 },
  } as unknown as FileEntry;
  // RST $38 / RST $00 — two addresses the two ROMs name differently.
  const data = Buffer.from([0xcd, 0x38, 0x00, 0xcd, 0x00, 0x00, 0xc9]);
  const run = (exrom: boolean) =>
    disassemble({ format: 'larken', entry, data, siblings: [], exrom });

  it('leaves the EXROM out unless it is asked for', () => {
    const ids = run(false)!.sidecar.symbolPacks.map((p) => p.id);
    expect(ids).not.toContain('ts2068-exrom');
    expect(ids).toContain('ts2068-home');
  });

  it('adds it when asked, and records that it did', () => {
    const ids = run(true)!.sidecar.symbolPacks.map((p) => p.id);
    expect(ids).toContain('ts2068-exrom');
    // The header lists every pack, so a reader can tell which ROM the names came from.
    expect(run(true)!.text).toContain('TS2068 EXROM');
    expect(run(false)!.text).not.toContain('TS2068 EXROM');
  });

  it('lets the EXROM win the addresses it shares with the HOME ROM', () => {
    expect(run(true)!.text).toContain('XRST38');
    expect(run(false)!.text).not.toContain('XRST38');
  });

  it('never offers the EXROM on a ZX81 disk, which has no such ROM', () => {
    // A line-0 REM holding machine code — the ZX81's usual home for it, and
    // what seeds the trace when no USR target is in the BASIC. The line must
    // be long enough to be worth tracing or nothing is disassembled at all.
    const code = [0xea, ...Array(10).fill(0x00), 0xc9];   // REM, NOPs, RET
    const line = [0x00, 0x00, code.length + 1, 0x00, ...code, 0x76];
    const zx81 = disassemble({
      format: 'zx81-aerco',
      entry: { ...entry, params: { progEnd: 0x74 + line.length } } as unknown as FileEntry,
      data: Buffer.concat([Buffer.alloc(0x74), Buffer.from(line)]),
      siblings: [], exrom: true,
    });
    expect(zx81, 'the ZX81 case must actually disassemble, or this proves nothing').not.toBeNull();
    const ids = zx81!.sidecar.symbolPacks.map((p) => p.id);
    expect(ids).not.toContain('ts2068-exrom');
    expect(ids).toContain('zx81');
  });
});
