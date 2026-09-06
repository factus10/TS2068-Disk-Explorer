/**
 * ZX Spectrum BASIC tokenizer.
 * Converts plain-text BASIC lines back into tokenized binary format.
 * Ported from TAP Explorer's basic-tokenizer.js (zmakebas algorithm).
 *
 * Approach:
 *  1. Create a lowercase copy with quoted strings blanked out
 *  2. Scan for keywords longest-first, only matching at non-alpha boundaries
 *  3. Context pass: revert keywords that are variable names
 *  4. Output pass: emit token bytes, handle numbers, escapes, special chars
 *
 * Text comes in the way the listing shows it, which is zmakebas source: the
 * graphics and UDGs are backslash escapes rather than characters. Those are
 * blanked before keyword matching, so that `\at` is a UDG followed by a `t`
 * and never the keyword AT.
 */

import { readSpectrumEscape } from './zmakebas';

// Reverse token map: keyword → byte value
const KEYWORD_TO_BYTE: Record<string, number> = {
  'RND': 0xa5, 'INKEY$': 0xa6, 'PI': 0xa7, 'FN': 0xa8, 'POINT': 0xa9,
  'SCREEN$': 0xaa, 'ATTR': 0xab, 'AT': 0xac, 'TAB': 0xad, 'VAL$': 0xae,
  'CODE': 0xaf, 'VAL': 0xb0, 'LEN': 0xb1, 'SIN': 0xb2, 'COS': 0xb3,
  'TAN': 0xb4, 'ASN': 0xb5, 'ACS': 0xb6, 'ATN': 0xb7, 'LN': 0xb8,
  'EXP': 0xb9, 'INT': 0xba, 'SQR': 0xbb, 'SGN': 0xbc, 'ABS': 0xbd,
  'PEEK': 0xbe, 'IN': 0xbf, 'USR': 0xc0, 'STR$': 0xc1, 'CHR$': 0xc2,
  'NOT': 0xc3, 'BIN': 0xc4, 'OR': 0xc5, 'AND': 0xc6, '<=': 0xc7,
  '>=': 0xc8, '<>': 0xc9, 'LINE': 0xca, 'THEN': 0xcb, 'TO': 0xcc,
  'STEP': 0xcd, 'DEF FN': 0xce, 'CAT': 0xcf, 'FORMAT': 0xd0, 'MOVE': 0xd1,
  'ERASE': 0xd2, 'OPEN #': 0xd3, 'CLOSE #': 0xd4, 'MERGE': 0xd5,
  'VERIFY': 0xd6, 'BEEP': 0xd7, 'CIRCLE': 0xd8, 'INK': 0xd9, 'PAPER': 0xda,
  'FLASH': 0xdb, 'BRIGHT': 0xdc, 'INVERSE': 0xdd, 'OVER': 0xde, 'OUT': 0xdf,
  'LPRINT': 0xe0, 'LLIST': 0xe1, 'STOP': 0xe2, 'READ': 0xe3, 'DATA': 0xe4,
  'RESTORE': 0xe5, 'NEW': 0xe6, 'BORDER': 0xe7, 'CONTINUE': 0xe8, 'DIM': 0xe9,
  'REM': 0xea, 'FOR': 0xeb, 'GO TO': 0xec, 'GO SUB': 0xed, 'INPUT': 0xee,
  'LOAD': 0xef, 'LIST': 0xf0, 'LET': 0xf1, 'PAUSE': 0xf2, 'NEXT': 0xf3,
  'POKE': 0xf4, 'PRINT': 0xf5, 'PLOT': 0xf6, 'RUN': 0xf7, 'SAVE': 0xf8,
  'RANDOMIZE': 0xf9, 'IF': 0xfa, 'CLS': 0xfb, 'DRAW': 0xfc, 'CLEAR': 0xfd,
  'RETURN': 0xfe, 'COPY': 0xff,
  // DELETE is a keyword to zmakebas, compiling to the control byte 0x0C — the
  // detokenizer writes it as `DELETE` outside strings, so an edited line must
  // read it back the same way. Strings are blanked before matching, so a
  // literal "DELETE" in a string stays its letters, exactly as zmakebas does.
  'DELETE': 0x0c,
};

const BYTE_TO_KEYWORD: Record<number, string> = {};
for (const [kw, byte] of Object.entries(KEYWORD_TO_BYTE)) {
  BYTE_TO_KEYWORD[byte] = kw;
}

const SORTED_KEYWORDS = Object.keys(KEYWORD_TO_BYTE).sort((a, b) => b.length - a.length);
const INFIX_KEYWORDS = new Set(['OR', 'AND', 'THEN', 'TO', 'STEP', 'LINE']);

// Zero-argument keywords that are always keywords, never variable names.
// These can appear before : or end-of-line without being reverted.
const ALWAYS_KEYWORD = new Set(['PI', 'RND', 'INKEY$']);

function isAlpha(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}

/**
 * One escape at `pos`, or null. `[UDG-A]` is the notation earlier versions
 * used; edits saved against those listings are still read.
 */
function readEscape(text: string, pos: number): { byte: number; length: number } | null {
  const escape = readSpectrumEscape(text, pos);
  if (escape) return escape;
  const legacy = text.slice(pos, pos + 8).match(/^\[UDG-([A-U])\]/);
  if (legacy) return { byte: 0x90 + legacy[1].charCodeAt(0) - 0x41, length: legacy[0].length };
  return null;
}

/**
 * Tokenize a single line of BASIC text (without line number).
 */
export function tokenizeLine(text: string): Buffer {
  // Phase 1: working copy
  const padded = ' ' + text;
  const chars = Array.from(padded);
  const work = Array.from(padded.toLowerCase());

  // Blank out string contents
  let inStr = false;
  for (let i = 1; i < work.length; i++) {
    if (work[i] === '"') {
      inStr = !inStr;
    } else if (inStr) {
      work[i] = ' ';
    }
  }

  // Blank out escapes, so no keyword can be found inside one
  for (let i = 1; i < work.length; i++) {
    const escape = readEscape(padded, i);
    if (!escape) continue;
    for (let j = i; j < i + escape.length && j < work.length; j++) work[j] = '\x01';
    i += escape.length - 1;
  }

  // Find REM and blank out everything after
  for (let i = 1; i < work.length - 2; i++) {
    if (work[i] === 'r' && work[i + 1] === 'e' && work[i + 2] === 'm' &&
        !isAlpha(work[i - 1]) && (i + 3 >= work.length || !isAlpha(work[i + 3]))) {
      for (let j = i + 3; j < work.length; j++) work[j] = ' ';
      break;
    }
  }

  // Phase 2: keyword matching
  const tokenMap = new Array(padded.length).fill(0);
  const consumed = new Array(padded.length).fill(false);

  for (const kw of SORTED_KEYWORDS) {
    const kwLower = kw.toLowerCase();
    const kwLen = kw.length;
    const isOperator = kw === '<=' || kw === '>=' || kw === '<>';

    let searchFrom = 1;
    while (searchFrom < work.length) {
      const pos = work.join('').indexOf(kwLower, searchFrom);
      if (pos < 1) break;

      let alreadyConsumed = false;
      for (let j = pos; j < pos + kwLen; j++) {
        if (consumed[j]) { alreadyConsumed = true; break; }
      }
      if (alreadyConsumed) { searchFrom = pos + 1; continue; }

      const charBefore = work[pos - 1];
      const charAfter = pos + kwLen < work.length ? work[pos + kwLen] : '';

      let match = false;
      if (isOperator) {
        match = true;
      } else {
        match = !isAlpha(charBefore) && !isAlpha(charAfter);
      }

      const endsWithDollar = kw.endsWith('$');
      const isAlwaysKeyword = ALWAYS_KEYWORD.has(kw);
      if (match && !isOperator && !endsWithDollar && !isAlwaysKeyword) {
        const realCharAfter = pos + kwLen < padded.length ? padded[pos + kwLen] : '';
        if (realCharAfter === '=' && (pos + kwLen + 1 >= padded.length || (padded[pos + kwLen + 1] !== '>' && padded[pos + kwLen + 1] !== '<'))) {
          match = false;
        }
        if (match && /[-+*/;)<>:]/.test(realCharAfter)) {
          match = false;
        }
        if (match && INFIX_KEYWORDS.has(kw)) {
          if (/[(*><=]/.test(charBefore) || /[)*><=+\-,;]/.test(realCharAfter)) {
            match = false;
          }
        }
      }

      if (match) {
        tokenMap[pos] = KEYWORD_TO_BYTE[kw];
        consumed[pos] = true;
        for (let j = pos + 1; j < pos + kwLen; j++) {
          consumed[j] = true;
          work[j] = '\x01';
        }
        work[pos] = '\x01';
        searchFrom = pos + kwLen;
      } else {
        searchFrom = pos + 1;
      }
    }
  }

  // Phase 2b: context pass — revert keywords that are variable names
  for (let pos = 1; pos < tokenMap.length; pos++) {
    if (!tokenMap[pos]) continue;
    const tokenByte = tokenMap[pos];
    if (tokenByte === 0xc7 || tokenByte === 0xc8 || tokenByte === 0xc9) continue;

    const kw = BYTE_TO_KEYWORD[tokenByte];
    if (!kw) continue;
    if (kw.endsWith('$')) continue;
    const kwLen = kw.length;

    // After LET/FOR/READ/DIM → variable name
    let inLetContext = false;
    for (let j = pos - 1; j >= 1; j--) {
      if (tokenMap[j]) {
        if (tokenMap[j] === 0xf1 || tokenMap[j] === 0xeb ||
            tokenMap[j] === 0xe3 || tokenMap[j] === 0xe9) {
          inLetContext = true;
        }
        break;
      }
      if (padded[j] === ' ') continue;
      break;
    }
    if (inLetContext) {
      tokenMap[pos] = 0;
      consumed[pos] = false;
      for (let j = pos + 1; j < pos + kwLen && j < work.length; j++) consumed[j] = false;
      continue;
    }

    // Keyword used as value (but not zero-arg functions like PI, RND)
    const realCharAfter = pos + kwLen < padded.length ? padded[pos + kwLen] : '';
    if (!ALWAYS_KEYWORD.has(kw) && (realCharAfter === '' || realCharAfter === ':' || realCharAfter === '\n')) {
      let revert = false;
      for (let j = pos - 1; j >= 1; j--) {
        if (padded[j] === ' ') continue;
        if (consumed[j]) {
          if (tokenMap[j]) {
            if (tokenMap[j] === 0xc0 || tokenMap[j] === 0xbe) revert = true;
            break;
          }
          continue;
        }
        if (/[=+\-*/,(]/.test(padded[j])) revert = true;
        break;
      }
      if (revert) {
        tokenMap[pos] = 0;
        consumed[pos] = false;
        for (let k = pos + 1; k < pos + kwLen && k < work.length; k++) consumed[k] = false;
      }
    }
  }

  // Phase 3: output pass
  const bytes: number[] = [];
  let i = 1;

  while (i < chars.length) {
    // Graphics, UDGs and the rest of what a backslash stands for
    const escape = readEscape(padded, i);
    if (escape) {
      bytes.push(escape.byte);
      i += escape.length;
      continue;
    }

    // Token
    if (tokenMap[i]) {
      const tokenByte = tokenMap[i];
      const kw = BYTE_TO_KEYWORD[tokenByte];
      const kwLen = kw ? kw.length : 1;
      const isInfix = kw && INFIX_KEYWORDS.has(kw);

      if (isInfix && bytes.length > 0 && bytes[bytes.length - 1] === 0x20) {
        bytes.pop();
      }

      bytes.push(tokenByte);
      i += kwLen;

      if (i < chars.length && chars[i] === ' ') i++;

      // After REM, everything is literal
      if (tokenByte === 0xea) {
        while (i < chars.length) {
          const remEscape = readEscape(padded, i);
          if (remEscape) {
            bytes.push(remEscape.byte);
            i += remEscape.length;
          } else {
            bytes.push(mapCharToByte(chars[i]));
            i++;
          }
        }
      }
      continue;
    }

    if (consumed[i]) { i++; continue; }

    const ch = chars[i];

    // Quoted string
    if (ch === '"') {
      bytes.push(0x22);
      i++;
      while (i < chars.length) {
        const strEscape = readEscape(padded, i);
        if (strEscape) {
          bytes.push(strEscape.byte);
          i += strEscape.length;
          continue;
        }
        bytes.push(mapCharToByte(chars[i]));
        if (chars[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }

    // Number literal
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < chars.length && /[0-9]/.test(chars[i + 1]))) {
      const prevCh = i > 1 ? chars[i - 1] : '';
      if (isAlpha(prevCh) || prevCh === '$') {
        bytes.push(mapCharToByte(ch));
        i++;
        continue;
      }

      let numStr = '';
      const numStart = i;
      while (i < chars.length && /[0-9.eE+\-]/.test(chars[i])) {
        if ((chars[i] === '+' || chars[i] === '-') && i > numStart &&
            chars[i - 1] !== 'e' && chars[i - 1] !== 'E') break;
        numStr += chars[i];
        i++;
      }

      for (const c of numStr) bytes.push(c.charCodeAt(0));

      const numVal = parseFloat(numStr);
      if (!isNaN(numVal)) {
        bytes.push(0x0e);
        bytes.push(...encodeZxFloat(numVal));
      }
      continue;
    }

    bytes.push(mapCharToByte(ch));
    i++;
  }

  bytes.push(0x0d); // line terminator
  return Buffer.from(bytes);
}

function mapCharToByte(ch: string): number {
  if (ch === '`') return 0x60;       // £, as zmakebas writes it
  if (ch === '^') return 0x5e;       // ↑
  if (ch === '\u00A3') return 0x60; // £, as older listings wrote it
  if (ch === '\u00A9') return 0x7f; // ©
  if (ch === '\u2191') return 0x5e; // ↑
  const code = ch.charCodeAt(0);
  if (code >= 0x20 && code <= 0x7f) return code;
  return 0x20;
}

/**
 * Encode a number into ZX Spectrum 5-byte floating point format.
 */
export function encodeZxFloat(num: number): number[] {
  if (num === 0) return [0x00, 0x00, 0x00, 0x00, 0x00];

  if (Number.isInteger(num) && num >= -65535 && num <= 65535) {
    const sign = num < 0 ? 0xff : 0x00;
    const absVal = Math.abs(num);
    return [0x00, sign, absVal & 0xff, (absVal >> 8) & 0xff, 0x00];
  }

  const sign = num < 0 ? 1 : 0;
  let absNum = Math.abs(num);
  let exp = 0;

  if (absNum >= 1) {
    while (absNum >= 1) { absNum /= 2; exp++; }
  } else {
    while (absNum < 0.5) { absNum *= 2; exp--; }
  }

  const expByte = exp + 128;
  if (expByte < 0 || expByte > 255) return [0x00, 0x00, 0x00, 0x00, 0x00];

  let m = absNum * 256;
  const m1 = Math.floor(m);
  m = (m - m1) * 256;
  const m2 = Math.floor(m);
  m = (m - m2) * 256;
  const m3 = Math.floor(m);
  m = (m - m3) * 256;
  const m4 = Math.floor(m + 0.5);

  const byte1 = (m1 & 0x7f) | (sign ? 0x80 : 0x00);
  return [expByte, byte1, m2, m3, m4];
}
