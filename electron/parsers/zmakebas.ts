/**
 * zmakebas source conventions — the one place that says how a byte of a
 * Sinclair character set is written in plain text.
 *
 * zmakebas (Russell Marks) compiles a BASIC program written as a text file
 * into a TAP or a `.p`. Writing listings its way means a listing is source:
 * paste it into a file, run zmakebas over it, and you have the program back.
 * That only works if every byte that has no ASCII spelling — the block
 * graphics, the UDGs, the inverse video, © and £, and the control codes that
 * carry colour and position inside a string — is written the way zmakebas
 * reads it.
 *
 * Every mapping below was checked against zmakebas 1.8.6 rather than taken
 * from a reference sheet, because the two machines disagree in ways that are
 * easy to get backwards. A block graphic is written as two characters, one
 * per column, where `'` is the top half of that column, `.` the bottom, `:`
 * both and a space neither — but the ZX81 numbers its mosaics from the
 * top-left and the Spectrum from the top-right, so the same escape means a
 * different code on each machine. The tables here are indexed by code, so
 * that difference is recorded once and never reasoned about again.
 */

/**
 * Spectrum block graphics, `$80`-`$8F`, in code order.
 *
 * The Spectrum's low bit is the *top-right* quadrant, so `\ '` is $81 and
 * `\' ` is $82 — the mirror of the ZX81's order below.
 */
const SPECTRUM_BLOCKS = [
  '\\  ', '\\ \'', '\\\' ', '\\\'\'', '\\ .', '\\ :', '\\\'.', '\\\':',
  '\\. ', '\\.\'', '\\: ', '\\:\'', '\\..', '\\.:', '\\:.', '\\::',
];

/** ZX81 mosaics, codes 1-10. Codes 8-10 are the half-tone shades. */
const ZX81_BLOCKS = [
  '\\\' ', '\\ \'', '\\\'\'', '\\. ', '\\: ', '\\.\'', '\\:\'',
  '\\!:', '\\!.', '\\!\'',
];

/** ZX81 inverse mosaics and shades, codes 128-138. */
const ZX81_INVERSE_BLOCKS = [
  '\\::', '\\.:', '\\:.', '\\..', '\\\':', '\\ :', '\\\'.', '\\ .',
  '\\|:', '\\|.', '\\|\'',
];

/** A backslash written `\\` at the end of a line — see `fixLineEnd`. */
export const SPECTRUM_BACKSLASH = '\\\\';
/** The ZX81's £ is also written `\\`, and carries the same hazard. */
export const ZX81_POUND = '\\\\';

/**
 * How a ZX Spectrum / TS2068 byte is written, or null when the byte is its
 * own ASCII character and needs no escape.
 *
 * `$7F` is © here. On a TS2068 the same byte can be the RESET keyword, and
 * the detokenizer decides which before asking.
 */
export function spectrumEscape(byte: number): string | null {
  if (byte === 0x5c) return SPECTRUM_BACKSLASH;
  if (byte === 0x5e) return '^';           // ↑, the exponent operator
  if (byte === 0x60) return '`';           // £
  if (byte === 0x7f) return '\\*';         // ©
  if (byte >= 0x80 && byte <= 0x8f) return SPECTRUM_BLOCKS[byte - 0x80];
  if (byte >= 0x90 && byte <= 0xa4) return '\\' + String.fromCharCode(0x61 + byte - 0x90);
  return null;
}

/**
 * How a ZX81 / TS1000 character code is written, or null when the plain glyph
 * will do.
 *
 * Inverse video is `\` followed by the un-inverted character, except that
 * inverse letters are written as lowercase (the ZX81 has no lowercase, so
 * zmakebas spends the letters on graphics mode) and inverse `.` and `:` are
 * written as decimal codes. Those two would otherwise be read as the first
 * half of a mosaic escape whenever the next character happened to be one of
 * ` ' . :` — zmakebas resolves that greedily in favour of the mosaic, so the
 * unambiguous spelling is the only safe one.
 */
export function zx81Escape(code: number, glyph: string): string | null {
  if (code >= 1 && code <= 10) return ZX81_BLOCKS[code - 1];
  if (code === 0x0c) return ZX81_POUND;
  if (code >= 0x80 && code <= 0x8a) return ZX81_INVERSE_BLOCKS[code - 0x80];
  if (code > 0x8a && code < 0xc0) {
    const base = code - 0x80;
    if (base >= 0x26 && base <= 0x3f) return String.fromCharCode(0x61 + base - 0x26);
    if (base === 0x0c) return '\\@';       // inverse £
    if (base === 0x0e || base === 0x1b) return `\\{${code}}`;  // inverse : and .
    return '\\' + glyph;
  }
  return null;
}

/**
 * The decimal spelling of a byte, for the bytes with no named escape at all —
 * the embedded control codes — and for the two places where a named escape
 * would be misread.
 */
export function decimalEscape(byte: number): string {
  return `\\{${byte}}`;
}

/**
 * Respell a `\\` that would fall at the end of a line.
 *
 * zmakebas reads the character after a `\\` before it notices the line has
 * ended, so it swallows the newline and runs the next line onto this one —
 * `10 REM \\` followed by `20 REM B` compiles to the single line
 * `10 REM 20 REM B`. The last byte of such a line has to be spelled in
 * decimal instead. `byte` is what the `\\` stood for: $5C on the Spectrum,
 * the £ at $0C on the ZX81.
 */
export function fixLineEnd(text: string, byte: number): string {
  return text.endsWith('\\\\') ? text.slice(0, -2) + decimalEscape(byte) : text;
}

/**
 * Read one zmakebas escape out of `text` at `pos`, going the other way: this
 * is what turns a hand-edited line back into bytes. Returns null when there
 * is no escape there.
 */
export function readSpectrumEscape(
  text: string, pos: number,
): { byte: number; length: number } | null {
  if (text[pos] !== '\\') return null;
  const next = text[pos + 1];
  if (next === undefined) return null;

  if (next === '\\') return { byte: 0x5c, length: 2 };
  if (next === '*') return { byte: 0x7f, length: 2 };

  if (next === '{') {
    const close = text.indexOf('}', pos + 2);
    if (close > 0) {
      const n = Number(text.slice(pos + 2, close));
      if (Number.isInteger(n) && n >= 0 && n <= 255) {
        return { byte: n, length: close - pos + 1 };
      }
    }
    return null;
  }

  if (next >= 'a' && next <= 'u') {
    return { byte: 0x90 + next.charCodeAt(0) - 0x61, length: 2 };
  }

  const pair = text.slice(pos, pos + 3);
  const block = SPECTRUM_BLOCKS.indexOf(pair);
  if (block >= 0) return { byte: 0x80 + block, length: 3 };

  return null;
}
