import { describe, it, expect } from 'vitest';
import { findJpTables, findOffsetTables, findTables } from '../electron/parsers/z80-tables';
import { decodeRange } from '../electron/parsers/z80-disasm';
import { trace, SPECTRUM } from '../electron/parsers/z80-trace';

const ORG = 0x8000;
const ordered = (data: Buffer, from: number, to: number) => decodeRange(data, from, to, ORG);

describe('tables of JP instructions', () => {
  it('recovers the targets of a run of JPs', () => {
    const t = Buffer.alloc(64, 0);
    // Five JP entries, three bytes apart — the shape LKDOS documents.
    [0x8020, 0x8024, 0x8028, 0x802c, 0x8030].forEach((target, i) => {
      t[i * 3] = 0xc3; t.writeUInt16LE(target, i * 3 + 1);
    });
    const found = findJpTables(t, ORG);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'jp-table', base: ORG, entries: 5 });
    expect(found[0].targets).toEqual([0x8020, 0x8024, 0x8028, 0x802c, 0x8030]);
  });

  it('ignores a run too short to be a table', () => {
    const t = Buffer.alloc(32, 0);
    [0x8010, 0x8014].forEach((target, i) => { t[i * 3] = 0xc3; t.writeUInt16LE(target, i * 3 + 1); });
    expect(findJpTables(t, ORG)).toEqual([]);
  });

  it('stops at an entry pointing outside the image', () => {
    const t = Buffer.alloc(64, 0);
    [0x8010, 0x8014, 0x8018, 0x801c, 0xf000].forEach((target, i) => {
      t[i * 3] = 0xc3; t.writeUInt16LE(target, i * 3 + 1);
    });
    expect(findJpTables(t, ORG)[0].entries).toBe(4);   // the $F000 entry is out of range
  });
});

describe('tables of one-byte offsets', () => {
  /**
   * The dispatch the TS2068 and Spectrum ROMs use:
   *   LD HL,base / LD E,(HL) / ADD HL,DE / JP (HL)
   * where the entry at base+k sends control to base+k+table[k].
   */
  function buildDispatch(base: number, offsets: number[]): Buffer {
    const d = Buffer.alloc(0x100, 0);
    d[0] = 0x21; d.writeUInt16LE(base, 1);   // LD HL,base
    d[3] = 0x5e;                             // LD E,(HL)
    d[4] = 0x19;                             // ADD HL,DE
    d[5] = 0xe9;                             // JP (HL)
    offsets.forEach((o, i) => { d[base - ORG + i] = o; });
    return d;
  }

  it('computes each target from the address its offset was read from', () => {
    const base = ORG + 0x40;
    const d = buildDispatch(base, [0x10, 0x20, 0x30]);
    const found = findOffsetTables(d, ORG, ordered(d, 0, 6));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'offset-table', base, entries: 3, from: ORG + 5 });
    // base+0+$10, base+1+$20, base+2+$30
    expect(found[0].targets).toEqual([base + 0x10, base + 1 + 0x20, base + 2 + 0x30]);
  });

  it('treats a zero offset as the end of the table', () => {
    const base = ORG + 0x40;
    const d = buildDispatch(base, [0x10, 0x20, 0x00, 0x30]);
    expect(findOffsetTables(d, ORG, ordered(d, 0, 6))[0].entries).toBe(2);
  });

  it('infers nothing when the base is not visible before the dispatch', () => {
    // Same read-and-jump, but HL comes from somewhere unknowable. The leading
    // NOPs matter: without them the dispatch sits below the index the scan
    // starts at, and the test would pass without the signature being checked.
    const d = Buffer.alloc(0x100, 0);
    d[0] = 0x00; d[1] = 0x00;                // NOP / NOP
    d[2] = 0x5e; d[3] = 0x19; d[4] = 0xe9;   // LD E,(HL) / ADD HL,DE / JP (HL)
    const ins = ordered(d, 0, 5);
    expect(ins[ins.length - 1].text).toBe('JP (HL)');
    expect(findOffsetTables(d, ORG, ins)).toEqual([]);
  });

  it('requires the read-and-add signature, not merely a base and a JP (HL)', () => {
    // LD HL,base sits far enough back for the scan to find it, but the two
    // instructions before the jump are not the offset read. Without the
    // signature check this would invent a table out of unrelated code.
    const d = Buffer.alloc(0x100, 0);
    d[0] = 0x00; d[1] = 0x00;                     // NOP / NOP
    d[2] = 0x21; d.writeUInt16LE(ORG + 0x40, 3);  // LD HL,base
    d[5] = 0x00; d[6] = 0x00;                     // NOP / NOP — not LD/ADD
    d[7] = 0xe9;                                  // JP (HL)
    d[0x40] = 0x10; d[0x41] = 0x20;               // bytes that would look like offsets
    const ins = ordered(d, 0, 8);
    expect(ins[ins.length - 1].text).toBe('JP (HL)');
    expect(findOffsetTables(d, ORG, ins)).toEqual([]);
  });

  it('infers nothing from a bare JP (HL) with no read-and-add before it', () => {
    const d = Buffer.alloc(0x100, 0);
    d[0] = 0x00; d[1] = 0x00;                       // padding, as above
    d[2] = 0x21; d.writeUInt16LE(ORG + 0x40, 3);    // LD HL,base
    d[5] = 0xe9;                                    // JP (HL) — no offset read
    d[0x40] = 0x10;                                 // a plausible offset, were one read
    const ins = ordered(d, 0, 6);
    expect(ins[ins.length - 1].text).toBe('JP (HL)');
    expect(findOffsetTables(d, ORG, ins)).toEqual([]);
  });
});

describe('tracing through a recovered table', () => {
  it('reaches code that a run would otherwise stop short of', () => {
    const d = Buffer.alloc(0x40, 0);
    // JP table at $8000 with four entries, and a RET at each target.
    [0x8020, 0x8021, 0x8022, 0x8023].forEach((t, i) => {
      d[i * 3] = 0xc3; d.writeUInt16LE(t, i * 3 + 1);
    });
    for (const off of [0x20, 0x21, 0x22, 0x23]) d[off] = 0xc9;   // RET

    const without = trace(d, ORG, [ORG], { machine: SPECTRUM });
    const withT = trace(d, ORG, [ORG], { machine: SPECTRUM, detectTables: true });
    expect(without.tables).toEqual([]);
    expect(withT.tables).toHaveLength(1);
    // Seeded at the table base, the first entry is an ordinary JP and is
    // followed; it is the entries after it that nothing branches to.
    expect(without.code.has(0x20)).toBe(true);
    for (const off of [0x21, 0x22, 0x23]) expect(without.code.has(off)).toBe(false);
    // With the table recovered, every target is reached.
    for (const off of [0x20, 0x21, 0x22, 0x23]) expect(withT.code.has(off)).toBe(true);
  });

  it('is off unless asked for, so a caller gets only what the bytes plainly say', () => {
    const d = Buffer.alloc(0x40, 0);
    [0x8020, 0x8024, 0x8028, 0x802c].forEach((t, i) => {
      d[i * 3] = 0xc3; d.writeUInt16LE(t, i * 3 + 1);
    });
    expect(trace(d, ORG, [ORG], { machine: SPECTRUM }).tables).toEqual([]);
  });
});

describe('findTables', () => {
  it('deduplicates by table base', () => {
    const d = Buffer.alloc(0x40, 0);
    [0x8020, 0x8024, 0x8028, 0x802c].forEach((t, i) => {
      d[i * 3] = 0xc3; d.writeUInt16LE(t, i * 3 + 1);
    });
    const all = findTables(d, ORG, ordered(d, 0, 12));
    expect(new Set(all.map((t) => t.base)).size).toBe(all.length);
  });
});
