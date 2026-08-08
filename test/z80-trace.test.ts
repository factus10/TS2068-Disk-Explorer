import { describe, it, expect } from 'vitest';
import { trace, ZX81, SPECTRUM } from '../electron/parsers/z80-trace';
import type { Machine } from '../electron/parsers/z80-trace';

const ORG = 0x8000;
const noRules: Machine = { id: 'none', name: 'none', rst: {}, printable: () => null };
const texts = (r: ReturnType<typeof trace>) =>
  [...r.code.entries()].sort((a, b) => a[0] - b[0]).map(([, i]) => i.text);

describe('RST instructions that take their argument inline', () => {
  it('consumes the error byte after RST $08 and stops, because it does not return', () => {
    //            RST $08  err   LD HL,$1234   RET
    const bytes = [0xcf, 0x0e, 0x21, 0x34, 0x12, 0xc9];
    const r = trace(Buffer.from(bytes), ORG, [ORG], { machine: ZX81 });
    expect(texts(r)).toEqual(['RST $08']);
    expect(r.inline).toEqual([{ start: 1, length: 1, from: ORG, note: 'error code' }]);
    // Everything past the error byte was never reached.
    expect(r.data).toEqual([{ start: 2, end: 6, kind: 'bytes' }]);
  });

  it('consumes ZX81 calculator literals up to end-calc $34, then carries on', () => {
    const r = trace(Buffer.from([0xef, 0x01, 0x02, 0x34, 0xc9]), ORG, [ORG], { machine: ZX81 });
    expect(texts(r)).toEqual(['RST $28', 'RET']);
    expect(r.inline[0]).toMatchObject({ start: 1, length: 3 });
    expect(r.stats.dataBytes).toBe(0);
  });

  it('uses $38 on the Spectrum, so a $34 in the stream is just a literal', () => {
    const r = trace(Buffer.from([0xef, 0x01, 0x34, 0x02, 0x38, 0xc9]), ORG, [ORG], { machine: SPECTRUM });
    expect(texts(r)).toEqual(['RST $28', 'RET']);
    expect(r.inline[0]).toMatchObject({ length: 4 });
  });

  it('desynchronises without the conventions — the reason they exist', () => {
    const r = trace(Buffer.from([0xef, 0x01, 0x02, 0x34, 0xc9]), ORG, [ORG], { machine: noRules });
    expect(texts(r)).toEqual(['RST $28', 'LD BC,$3402', 'RET']);
    expect(r.inline).toEqual([]);
  });
});

describe('following control flow', () => {
  it('takes both arms of a conditional and both sides of a call', () => {
    //        CALL $8006 ; RET ; (pad) ; RET
    const bytes = [0xcd, 0x06, 0x80, 0xc9, 0x00, 0x00, 0xc9];
    const r = trace(Buffer.from(bytes), ORG, [ORG], { machine: SPECTRUM });
    // The call target and the instruction after the call are both reached.
    expect(r.code.has(0)).toBe(true);
    expect(r.code.has(3)).toBe(true);
    expect(r.code.has(6)).toBe(true);
    expect(r.labels.get(0x8006)).toBe('L_8006');
  });

  it('stops a run at an unconditional jump and records an out-of-range target', () => {
    const r = trace(Buffer.from([0xc3, 0x00, 0x00, 0xc9]), ORG, [ORG], { machine: SPECTRUM });
    expect(texts(r)).toEqual(['JP $0000']);
    expect([...r.external.keys()]).toEqual([0x0000]);
    expect(r.external.get(0x0000)).toEqual([ORG]);
  });

  it('reports a branch into the middle of a decoded instruction instead of decoding it twice', () => {
    // JR NZ,+1 falls through first, so the LD at offset 2 is decoded and covers
    // offsets 2-4. The branch target, offset 3, then lands inside it.
    const bytes = Buffer.from([0x20, 0x01, 0x21, 0x00, 0x41, 0xc9]);
    const r = trace(bytes, ORG, [ORG], { machine: SPECTRUM });
    expect(r.code.get(2)?.text).toBe('LD HL,$4100');
    expect(r.conflicts).toEqual([{ target: ORG + 3, from: -1 }]);
    // The contradictory second reading is not emitted.
    expect(r.code.has(3)).toBe(false);
  });
});

describe('accounting', () => {
  it('never reports more code than the input holds', () => {
    const bytes = Buffer.from([0x18, 0x01, 0x21, 0x00, 0x41, 0xc9]);
    const r = trace(bytes, ORG, [ORG], { machine: SPECTRUM });
    expect(r.stats.codeBytes + r.stats.inlineBytes + r.stats.dataBytes).toBe(bytes.length);
    expect(r.stats.codeBytes).toBeLessThanOrEqual(bytes.length);
  });

  it('ignores a seed that falls outside the buffer, and says so', () => {
    const r = trace(Buffer.from([0xc9]), ORG, [ORG, 0x1234], { machine: SPECTRUM });
    expect(r.seeds).toEqual([ORG]);
    expect(r.seedsOutside).toEqual([0x1234]);
  });
});

describe('data runs', () => {
  it('reads a string out of unreached bytes', () => {
    const s = 'HELLO';
    const bytes = [0xc9, ...[...s].map((c) => c.charCodeAt(0))];
    const r = trace(Buffer.from(bytes), ORG, [ORG], { machine: SPECTRUM });
    expect(r.data.find((d) => d.kind === 'text')?.text).toBe(s);
  });

  it('does not call a run of blank memory text', () => {
    // On the ZX81 $00 renders as a space; a stretch of zeros is not a string.
    const r = trace(Buffer.from([0xc9, 0, 0, 0, 0, 0, 0, 0, 0]), ORG, [ORG], { machine: ZX81 });
    expect(r.data.every((d) => d.kind === 'bytes')).toBe(true);
  });
});
