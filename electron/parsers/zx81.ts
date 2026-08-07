/**
 * Sinclair ZX81 / TS1000 character set and BASIC detokenizer.
 *
 * The ZX81 has its own 64-glyph character set that is unrelated to ASCII:
 *   0x00        space
 *   0x01-0x0A   block graphics (8 quadrant mosaics + 2 half-tone)
 *   0x0B-0x1B   punctuation
 *   0x1C-0x25   digits 0-9
 *   0x26-0x3F   letters A-Z
 *   0x40-0x42   the functions RND, INKEY$ and PI
 *   0x80-0xBF   inverse video of 0x00-0x3F
 *   0xC0-0xFF   BASIC keyword tokens
 * plus three special codes used inside programs: 0x76 NEWLINE (end of line),
 * 0x7E number marker (followed by a 5-byte float), and 0x7F cursor.
 *
 * A tokenized line is [line number, big-endian 16-bit][length, LE 16-bit]
 * [tokens...][0x76]. Note the big-endian line number — the opposite of the
 * ZX Spectrum, which is otherwise similar.
 */

import type { BasicListing, BasicLine, BasicToken } from './basic-detokenizer';
import { decodeFloat, formatNum } from './basic-variables';
import type { BasicVariable } from './basic-variables';

// Block graphics for codes 0x01-0x0A. Codes 8-10 are half-tone (dithered)
// patterns — full, top half and bottom half — approximated with the same
// shade glyph since Unicode has no partial-height shade blocks.
const GRAPHICS = ['▘', '▝', '▀', '▖', '▌', '▞', '▛', '▒', '▒', '▒'];

const PUNCTUATION = ['"', '£', '$', ':', '?', '(', ')', '>', '<', '=', '+', '-', '*', '/', ';', ',', '.'];

/** Base (non-inverse) glyph for character codes 0x00-0x3F. */
const CHARS: string[] = (() => {
  const t = new Array<string>(64).fill('?');
  t[0] = ' ';
  for (let i = 0; i < GRAPHICS.length; i++) t[1 + i] = GRAPHICS[i];
  for (let i = 0; i < PUNCTUATION.length; i++) t[0x0b + i] = PUNCTUATION[i];
  for (let i = 0; i < 10; i++) t[0x1c + i] = String.fromCharCode(48 + i);
  for (let i = 0; i < 26; i++) t[0x26 + i] = String.fromCharCode(65 + i);
  return t;
})();

/**
 * The three single-byte functions that sit just above the character range.
 * `PI/PI` is the standard ZX81 way of writing the constant 1.
 */
const FUNCTION_CODES: Record<number, string> = { 0x40: 'RND', 0x41: 'INKEY$', 0x42: 'PI' };

/** ZX81 BASIC keyword tokens, 0xC0-0xFF. */
const TOKENS: Record<number, string> = {
  0xc0: '""', 0xc1: 'AT ', 0xc2: 'TAB ', 0xc3: '', 0xc4: 'CODE ',
  0xc5: 'VAL ', 0xc6: 'LEN ', 0xc7: 'SIN ', 0xc8: 'COS ', 0xc9: 'TAN ',
  0xca: 'ASN ', 0xcb: 'ACS ', 0xcc: 'ATN ', 0xcd: 'LN ', 0xce: 'EXP ',
  0xcf: 'INT ', 0xd0: 'SQR ', 0xd1: 'SGN ', 0xd2: 'ABS ', 0xd3: 'PEEK ',
  0xd4: 'USR ', 0xd5: 'STR$ ', 0xd6: 'CHR$ ', 0xd7: 'NOT ', 0xd8: '**',
  0xd9: ' OR ', 0xda: ' AND ', 0xdb: '<=', 0xdc: '>=', 0xdd: '<>',
  0xde: ' THEN ', 0xdf: ' TO ', 0xe0: ' STEP ', 0xe1: 'LPRINT ', 0xe2: 'LLIST ',
  0xe3: 'STOP ', 0xe4: 'SLOW ', 0xe5: 'FAST ', 0xe6: 'NEW ', 0xe7: 'SCROLL ',
  0xe8: 'CONT ', 0xe9: 'DIM ', 0xea: 'REM ', 0xeb: 'FOR ', 0xec: 'GOTO ',
  0xed: 'GOSUB ', 0xee: 'INPUT ', 0xef: 'LOAD ', 0xf0: 'LIST ', 0xf1: 'LET ',
  0xf2: 'PAUSE ', 0xf3: 'NEXT ', 0xf4: 'POKE ', 0xf5: 'PRINT ', 0xf6: 'PLOT ',
  0xf7: 'RUN ', 0xf8: 'SAVE ', 0xf9: 'RAND ', 0xfa: 'IF ', 0xfb: 'CLS ',
  0xfc: 'UNPLOT ', 0xfd: 'CLEAR ', 0xfe: 'RETURN ', 0xff: 'COPY ',
};

const STATEMENT_TOKENS = new Set([
  0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec,
  0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
]);

const OPERATOR_TOKENS = new Set([0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe0]);

/** Decode a run of ZX81 character codes into a printable string. */
export function decodeZX81Text(data: Buffer | Uint8Array): string {
  let out = '';
  for (const b of data) {
    if (b < 0x40) out += CHARS[b];
    else if (b >= 0x80 && b < 0xc0) out += CHARS[b - 0x80];
    else if (b === 0x76) out += '\n';
    else out += ' ';
  }
  return out;
}

/** Character-code range where the ZX81 stores plain (non-inverse) text. */
export function isZX81Text(b: number): boolean {
  return b < 0x40 || (b >= 0x80 && b < 0xc0);
}

function charToken(code: number): BasicToken {
  const inverse = code >= 0x80 && code < 0xc0;
  const base = inverse ? code - 0x80 : code;
  const text = base < 0x40 ? CHARS[base] : '?';
  // Graphics and inverse-video characters get their own token type so the
  // viewer can style them apart from ordinary text.
  const isGraphic = inverse || (base >= 0x01 && base <= 0x0a);
  return { type: isGraphic ? 'graphic' : 'text', text };
}

/**
 * Detokenize a ZX81 BASIC program.
 *
 * @param data      A ZX81 memory image starting at VERSN (0x4009) — i.e. the
 *                  contents of a `.p` file.
 * @param progEnd   Offset of the end of the program area (D_FILE - 0x4009).
 *                  Defaults to the whole buffer.
 */
export function detokenizeZX81(data: Buffer, progEnd?: number): BasicListing {
  const PROG_START = 0x407d - 0x4009; // 0x74: program area follows the system variables
  const end = Math.min(progEnd ?? data.length, data.length);
  const lines: BasicLine[] = [];

  let pos = PROG_START;
  while (pos + 4 <= end) {
    const lineNumber = (data[pos] << 8) | data[pos + 1];
    const lineLength = data[pos + 2] | (data[pos + 3] << 8);
    // ZX81 line numbers run 0-9999; line 0 is common as the first line, where
    // it holds a REM full of machine code. Every line ends with a NEWLINE
    // byte, so a length that doesn't land on one means we have run off the
    // end of the program into the display file.
    if (lineNumber > 9999 || lineLength < 1) break;
    if (pos + 4 + lineLength > end) break;
    if (data[pos + 4 + lineLength - 1] !== 0x76) break;

    const body = data.subarray(pos + 4, pos + 4 + lineLength);
    lines.push({ lineNumber, tokens: tokenizeLine(body) });
    pos += 4 + lineLength;
  }

  return { lines };
}

function tokenizeLine(body: Buffer): BasicToken[] {
  const tokens: BasicToken[] = [];
  let inString = false;
  let inRem = false;
  let text = '';

  const flush = (type: BasicToken['type'] = 'text') => {
    if (text) { tokens.push({ type, text }); text = ''; }
  };

  for (let i = 0; i < body.length; i++) {
    const b = body[i];

    if (b === 0x76) break; // end-of-line marker

    // Inside a REM everything is literal — machine code stashed in a REM can
    // contain any byte value, including token and number-marker codes.
    if (inRem) {
      text += b < 0x40 ? CHARS[b] : (b >= 0x80 && b < 0xc0 ? CHARS[b - 0x80] : (TOKENS[b] ?? '?'));
      continue;
    }

    // Number literals are stored as their digit characters followed by a
    // 0x7E marker and a 5-byte float; the digits are already in the stream,
    // so we just skip the binary form.
    if (b === 0x7e && !inString) { i += 5; continue; }
    if (b === 0x7f) continue; // cursor

    if (FUNCTION_CODES[b] !== undefined) {
      flush();
      tokens.push({ type: 'function', text: FUNCTION_CODES[b] });
      continue;
    }

    if (b >= 0xc0) {
      flush();
      const kw = TOKENS[b] ?? '?';
      const type: BasicToken['type'] = STATEMENT_TOKENS.has(b)
        ? 'statement'
        : OPERATOR_TOKENS.has(b) ? 'operator' : 'function';
      tokens.push({ type, text: kw });
      if (b === 0xea) inRem = true;
      continue;
    }

    if (b === 0x0b) inString = !inString; // quote

    const tok = charToken(b);
    if (tok.type === 'graphic') {
      flush();
      tokens.push(tok);
    } else {
      text += tok.text;
    }
  }

  flush();
  return tokens;
}

/**
 * Decode the ZX81 variables area, which follows the display file in memory.
 *
 * The layout matches the Spectrum's closely enough to share the floating point
 * format, but differs in two ways that matter. Names are ZX81 character codes
 * (0x26-0x3F for A-Z) rather than ASCII, and since every letter has bit 5 set
 * the first byte only carries the low five: the letter is 0x20 | (byte & 0x1F).
 * And the FOR control block is 18 bytes rather than 19 — the ZX81 records the
 * looping line but not the statement within it.
 *
 * Variable type, from the top three bits of the first byte:
 *   010 string          011 number, one letter    100 number array
 *   101 number, longer name                       110 character array
 *   111 FOR control variable
 * A byte of 0x80 ends the area.
 */
export function parseZX81Variables(varsData: Buffer): BasicVariable[] {
  const vars: BasicVariable[] = [];
  const letterOf = (b: number) => CHARS[0x20 | (b & 0x1f)];
  const stringAt = (o: number, len: number) => decodeZX81Text(varsData.subarray(o, o + len));
  let pos = 0;

  while (pos < varsData.length) {
    const first = varsData[pos];
    if (first === 0x80) break; // end marker
    const letter = letterOf(first);

    switch ((first >> 5) & 0x07) {
      case 3: { // number, single-letter name
        if (pos + 6 > varsData.length) return vars;
        vars.push({ name: letter, kind: 'number', value: formatNum(decodeFloat(varsData, pos + 1)) });
        pos += 6;
        break;
      }

      case 5: { // number, longer name — trailing letters are plain character
        let name = letter;         // codes, with bit 7 set on the last one
        pos++;
        while (pos < varsData.length && !(varsData[pos] & 0x80)) {
          name += decodeZX81Text(varsData.subarray(pos, pos + 1));
          pos++;
        }
        if (pos < varsData.length) {
          name += decodeZX81Text(Buffer.from([varsData[pos] & 0x7f]));
          pos++;
        }
        if (pos + 5 > varsData.length) return vars;
        vars.push({ name, kind: 'number', value: formatNum(decodeFloat(varsData, pos)) });
        pos += 5;
        break;
      }

      case 2: { // string
        pos++;
        if (pos + 2 > varsData.length) return vars;
        const len = varsData[pos] | (varsData[pos + 1] << 8);
        pos += 2;
        if (pos + len > varsData.length) return vars;
        vars.push({ name: letter + '$', kind: 'string', value: `"${stringAt(pos, len)}"` });
        pos += len;
        break;
      }

      case 4:
      case 6: {
        const isString = ((first >> 5) & 0x07) === 6;
        pos++;
        if (pos + 2 > varsData.length) return vars;
        const totalLen = varsData[pos] | (varsData[pos + 1] << 8);
        pos += 2;
        const start = pos;
        const end = start + totalLen;
        if (end > varsData.length) { pos = end; break; }
        const numDims = varsData[pos++];
        const dimensions: number[] = [];
        let elements = 1;
        for (let d = 0; d < numDims; d++) {
          const dim = varsData[pos] | (varsData[pos + 1] << 8);
          dimensions.push(dim);
          elements *= dim;
          pos += 2;
        }
        const values: string[] = [];
        if (isString) {
          // The last dimension is the length of each string, not a count.
          const strLen = dimensions.length > 0 ? dimensions[dimensions.length - 1] : 1;
          const count = strLen > 0 ? Math.floor(elements / strLen) : 0;
          for (let i = 0; i < count && pos + strLen <= end; i++) {
            values.push(`"${stringAt(pos, strLen)}"`);
            pos += strLen;
          }
        } else {
          for (let i = 0; i < elements && pos + 5 <= end; i++) {
            values.push(formatNum(decodeFloat(varsData, pos)));
            pos += 5;
          }
        }
        vars.push({
          name: letter + (isString ? '$()' : '()'),
          kind: isString ? 'string-array' : 'number-array',
          dimensions,
          values,
        });
        pos = end;
        break;
      }

      case 7: { // FOR control variable — no statement byte on the ZX81
        if (pos + FOR_BLOCK_SIZE > varsData.length) return vars;
        vars.push({
          name: letter,
          kind: 'for',
          forValue: decodeFloat(varsData, pos + 1),
          forLimit: decodeFloat(varsData, pos + 6),
          forStep: decodeFloat(varsData, pos + 11),
          forLine: varsData[pos + 16] | (varsData[pos + 17] << 8),
        });
        pos += FOR_BLOCK_SIZE;
        break;
      }

      default:
        return vars; // 000/001 are not variable types — the area is corrupt
    }
  }

  return vars;
}

const FOR_BLOCK_SIZE = 18;
