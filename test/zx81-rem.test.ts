import { describe, it, expect } from 'vitest';
import { detokenizeZX81 } from '../electron/parsers/zx81';
import { zx81RemCodeRegions, zx81RemCodeStarts } from '../electron/parsers/disasm-entry-points';

/**
 * Build a ZX81 file image: system variables from $4009, program area at $407D.
 * A line is [number hi][number lo][length lo][length hi][body][$76].
 */
const image = (...lines: [number, number[]][]) => {
  const parts = [Buffer.alloc(0x74)];
  for (const [n, body] of lines) {
    const withNewline = [...body, 0x76];
    parts.push(Buffer.from([n >> 8, n & 0xff, withNewline.length & 0xff, withNewline.length >> 8, ...withNewline]));
  }
  return Buffer.concat(parts);
};

const REM = 0xea;
// LD A,1 / HALT / LD HL,$4000 / RET. The HALT is $76 — a NEWLINE byte sitting
// in the middle of a routine, which is exactly the case the editor warns about
// and which programs contain anyway.
const CODE = [0x3e, 0x01, 0x76, 0x21, 0x00, 0x40, 0xc9];

describe('a REM holding machine code', () => {
  it('is bounded by the line length, not by scanning for a NEWLINE', () => {
    // The length field is authoritative. Scanning for $76 would stop at the
    // HALT and report a 2-byte routine.
    const regions = zx81RemCodeRegions(image([0, [REM, ...CODE]]), 1000);
    expect(regions).toEqual([{ start: 0x79, length: CODE.length, lineNumber: 0 }]);
  });

  it('puts the first line-0 REM at $4082, where the ZX81 always puts it', () => {
    const [r] = zx81RemCodeRegions(image([0, [REM, ...CODE]]), 1000);
    expect(0x4009 + r.start).toBe(0x4082);
    expect(zx81RemCodeStarts(image([0, [REM, ...CODE]]), 1000)).toEqual([r.start]);
  });

  it('measures each REM independently when there are several', () => {
    const long = new Array(40).fill(0x00);
    const regions = zx81RemCodeRegions(image([0, [REM, ...CODE]], [1, [REM, ...long]]), 2000);
    expect(regions.map((r) => r.length)).toEqual([CODE.length, long.length]);
    expect(regions.map((r) => r.lineNumber)).toEqual([0, 1]);
  });

  it('does not truncate the listing at a NEWLINE byte inside the REM', () => {
    // The rendering is keyword soup either way — these are code bytes, not
    // text — but stopping early silently drops the tail of the routine.
    const l = detokenizeZX81(image([0, [REM, ...CODE]]), 1000);
    const text = l.lines[0].tokens.map((t) => t.text).join('');
    expect(l.lines).toHaveLength(1);
    // Two characters would mean it stopped at the HALT.
    expect(text.length).toBeGreaterThan('REM '.length + 2);
  });

  it('still reads the lines after one that contains a NEWLINE byte', () => {
    const l = detokenizeZX81(image([0, [REM, ...CODE]], [10, [0xf9]]), 1000);
    expect(l.lines.map((x) => x.lineNumber)).toEqual([0, 10]);
  });

  it('ignores a REM too short to hold a routine', () => {
    expect(zx81RemCodeRegions(image([1, [REM, 0x26, 0x27]]), 1000)).toEqual([]);
  });
});

describe('showing a REM as bytes', () => {
  const line = image([0, [REM, ...CODE]]);
  const render = (style?: 'characters' | 'hex') =>
    detokenizeZX81(line, 1000, style).lines[0].tokens.map((t) => t.text).join('');

  it('writes each byte as two digits and an h', () => {
    // A REM holding machine code has no reading as text; the bytes are the
    // only honest rendering, and the format is the one the machine's own
    // documentation uses.
    expect(render('hex')).toBe('REM 3Eh 01h 76h 21h 00h 40h C9h ');
  });

  it('includes the NEWLINE byte that sits inside the routine', () => {
    // $76 is HALT here. Showing the bytes and omitting that one would be a
    // different kind of lie from truncating at it.
    expect(render('hex')).toContain('76h');
  });

  it('does not render the line-terminating NEWLINE', () => {
    // The last byte closes the line and is not part of the routine.
    expect(render('hex').trim().endsWith('C9h')).toBe(true);
  });

  it('leaves the characters rendering as the default', () => {
    expect(render()).toBe(render('characters'));
    expect(render('characters')).not.toContain('h ');
  });

  it('only changes the REM body, not the rest of the program', () => {
    const two = image([0, [REM, ...CODE]], [10, [0xf9]]);   // line 10: RAND
    const asHex = detokenizeZX81(two, 1000, 'hex').lines[1].tokens.map((t) => t.text).join('');
    const asChars = detokenizeZX81(two, 1000, 'characters').lines[1].tokens.map((t) => t.text).join('');
    expect(asHex).toBe(asChars);
    expect(asHex.trim()).toBe('RAND');
  });
});
