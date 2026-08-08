import { describe, it, expect } from 'vitest';
import { decodeOne, decodeRange } from '../electron/parsers/z80-disasm';
import fixture from './fixtures/z80-opcodes.json';

/**
 * The fixture is the golden table: every opcode on every prefix page, with the
 * length, rendering and flow this decoder produces. It was generated with
 * z80dasm and z80asm cross-checking each entry — see
 * scripts/gen-opcode-fixture.ts — because those are native tools that will not
 * exist on a CI runner. Regenerate after a decoder change and read the diff.
 */
describe('decoder against the golden opcode table', () => {
  const parseBytes = (s: string) => s.split(' ').map((b) => parseInt(b, 16));

  it('covers all seven prefix pages', () => {
    expect(fixture.entries).toHaveLength(1792);
  });

  it('records a prefix handed back when the next byte is also a prefix', () => {
    // DD DD consumes only the first DD; the second starts a fresh instruction.
    const rewound = fixture.entries.filter((e) => e.probe.split(' ').length > e.bytes.split(' ').length);
    expect(rewound.length).toBe(6);   // DD/FD followed by DD, ED or FD
    for (const e of rewound) expect(e.bytes).toMatch(/^(dd|fd)$/);
  });

  it('decodes every opcode to the recorded length, text and flow', () => {
    const wrong: string[] = [];
    for (const e of fixture.entries) {
      const insn = decodeOne(Buffer.from([...parseBytes(e.probe), 0, 0, 0, 0]), 0, fixture.probeOrigin);
      const got = insn.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
      if (insn.length !== e.length || insn.text !== e.text || insn.flow !== e.flow || got !== e.bytes) {
        wrong.push(`probe ${e.probe}: got ${insn.length}B [${got}] "${insn.text}" ${insn.flow}`
          + ` — expected ${e.length}B [${e.bytes}] "${e.text}" ${e.flow}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('records the same branch targets and flags', () => {
    for (const e of fixture.entries) {
      const insn = decodeOne(Buffer.from([...parseBytes(e.probe), 0, 0, 0, 0]), 0, fixture.probeOrigin);
      expect({ t: insn.target, u: !!insn.undocumented, i: !!insn.invalid })
        .toEqual({ t: (e as { target?: number }).target, u: !!(e as { undocumented?: boolean }).undocumented, i: !!(e as { invalid?: boolean }).invalid });
    }
  });

  it('was cross-checked against z80dasm with every length disagreement accounted for', () => {
    const x = fixture.crossChecked.z80dasm;
    expect(typeof x).toBe('object');
    // Disagreements are expected — z80dasm declines to decode a prefix it
    // considers illegal — but every one must fall into a known bucket.
    expect((x as { disagreement: { unexplained: string[] } }).disagreement.unexplained).toEqual([]);
  });
});

describe('relative branches', () => {
  it('computes JR forward from the following instruction', () => {
    // 18 43 at $000E targets $0053: $000E + 2 + $43
    const i = decodeOne(Buffer.from([0x18, 0x43]), 0, 0x000e);
    expect(i.target).toBe(0x0053);
    expect(i.flow).toBe('jump');
  });

  it('handles a negative displacement', () => {
    const i = decodeOne(Buffer.from([0x18, 0xfe]), 0, 0x8000);  // JR to itself
    expect(i.target).toBe(0x8000);
  });

  it('keeps DJNZ conditional so the fall-through stays live', () => {
    const i = decodeOne(Buffer.from([0x10, 0x05]), 0, 0x8000);
    expect(i).toMatchObject({ flow: 'cond', target: 0x8007, length: 2 });
  });
});

describe('index-prefixed forms', () => {
  it('reads the displacement before the immediate in LD (IX+d),n', () => {
    const i = decodeOne(Buffer.from([0xdd, 0x36, 0x05, 0x7f]), 0, 0);
    expect(i).toMatchObject({ text: 'LD (IX+5),$7F', length: 4 });
  });

  it('leaves H alone when the other operand is indexed', () => {
    // DD 66 d is LD H,(IX+d) — not LD IXH,(IX+d)
    expect(decodeOne(Buffer.from([0xdd, 0x66, 0x02]), 0, 0).text).toBe('LD H,(IX+2)');
    // DD 60 with no index operand does use the register half
    expect(decodeOne(Buffer.from([0xdd, 0x60]), 0, 0).text).toBe('LD IXH,B');
  });

  it('decodes the DD CB displacement form, which puts d before the opcode', () => {
    const i = decodeOne(Buffer.from([0xdd, 0xcb, 0xfe, 0x06]), 0, 0);
    expect(i).toMatchObject({ text: 'RLC (IX-2)', length: 4 });
  });

  it('flags a prefix the following opcode ignores', () => {
    // FD before DEC SP: the prefix is consumed, the instruction runs unprefixed
    expect(decodeOne(Buffer.from([0xfd, 0x3b]), 0, 0))
      .toMatchObject({ text: 'DEC SP', length: 2, undocumented: true });
  });
});

describe('the ED page', () => {
  it('always consumes a second byte, even when the pair is invalid', () => {
    expect(decodeOne(Buffer.from([0xed, 0x11]), 0, 0)).toMatchObject({ length: 2, invalid: true });
  });

  it('decodes the undocumented RETN mirrors and flags them', () => {
    expect(decodeOne(Buffer.from([0xed, 0x45]), 0, 0)).toMatchObject({ text: 'RETN', flow: 'ret' });
    expect(decodeOne(Buffer.from([0xed, 0x65]), 0, 0))
      .toMatchObject({ text: 'RETN', flow: 'ret', undocumented: true });
    expect(decodeOne(Buffer.from([0xed, 0x4d]), 0, 0)).toMatchObject({ text: 'RETI' });
  });
});

describe('decodeRange', () => {
  it('accounts for every byte it walks', () => {
    const bytes = Buffer.from([0x21, 0x00, 0x41, 0x11, 0x00, 0x20, 0xed, 0xb0, 0xc9]);
    const insns = decodeRange(bytes, 0, bytes.length, 0x4082);
    expect(insns.map((i) => i.text))
      .toEqual(['LD HL,$4100', 'LD DE,$2000', 'LDIR', 'RET']);
    expect(insns.reduce((n, i) => n + i.length, 0)).toBe(bytes.length);
  });
});
