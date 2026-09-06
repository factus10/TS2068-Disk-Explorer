/**
 * ZX Spectrum / TS2068 BASIC detokenizer.
 * Converts tokenized BASIC program data back to readable source code.
 * Token range 0xA5-0xFF maps to 91 BASIC keywords.
 * Bytes 0x7B-0x7F are dual-meaning: ZX Spectrum characters vs TS2068 keywords.
 * Ported from TAP Explorer's basic-detokenizer.js.
 */

import { spectrumEscape, decimalEscape, fixLineEnd } from './zmakebas';

export type Ts2068Mode = 'auto' | 'ts2068' | 'spectrum';

export interface BasicToken {
  type: 'statement' | 'function' | 'operator' | 'text' | 'udg' | 'graphic'
    | 'disk-cmd' | 'ts2068-kw' | 'control';
  text: string;
}

export interface BasicLine {
  lineNumber: number;
  tokens: BasicToken[];
}

export interface BasicListing {
  lines: BasicLine[];
  autostartLine?: number;
}

// Complete ZX Spectrum 48K BASIC token table (0xA5-0xFF)
const TOKENS: Record<number, string> = {
  0xa5: 'RND', 0xa6: 'INKEY$', 0xa7: 'PI', 0xa8: 'FN ', 0xa9: 'POINT ',
  0xaa: 'SCREEN$ ', 0xab: 'ATTR ', 0xac: 'AT ', 0xad: 'TAB ', 0xae: 'VAL$ ',
  0xaf: 'CODE ', 0xb0: 'VAL ', 0xb1: 'LEN ', 0xb2: 'SIN ', 0xb3: 'COS ',
  0xb4: 'TAN ', 0xb5: 'ASN ', 0xb6: 'ACS ', 0xb7: 'ATN ', 0xb8: 'LN ',
  0xb9: 'EXP ', 0xba: 'INT ', 0xbb: 'SQR ', 0xbc: 'SGN ', 0xbd: 'ABS ',
  0xbe: 'PEEK ', 0xbf: 'IN ', 0xc0: 'USR ', 0xc1: 'STR$ ', 0xc2: 'CHR$ ',
  0xc3: 'NOT ', 0xc4: 'BIN ', 0xc5: ' OR ', 0xc6: ' AND ', 0xc7: '<=',
  0xc8: '>=', 0xc9: '<>', 0xca: ' LINE ', 0xcb: ' THEN ', 0xcc: ' TO ',
  0xcd: ' STEP ', 0xce: 'DEF FN ', 0xcf: 'CAT ', 0xd0: 'FORMAT ',
  0xd1: 'MOVE ', 0xd2: 'ERASE ', 0xd3: 'OPEN #', 0xd4: 'CLOSE #',
  0xd5: 'MERGE ', 0xd6: 'VERIFY ', 0xd7: 'BEEP ', 0xd8: 'CIRCLE ',
  0xd9: 'INK ', 0xda: 'PAPER ', 0xdb: 'FLASH ', 0xdc: 'BRIGHT ',
  0xdd: 'INVERSE ', 0xde: 'OVER ', 0xdf: 'OUT ', 0xe0: 'LPRINT ',
  0xe1: 'LLIST ', 0xe2: 'STOP ', 0xe3: 'READ ', 0xe4: 'DATA ',
  0xe5: 'RESTORE ', 0xe6: 'NEW ', 0xe7: 'BORDER ', 0xe8: 'CONTINUE ',
  0xe9: 'DIM ', 0xea: 'REM ', 0xeb: 'FOR ', 0xec: 'GO TO ',
  0xed: 'GO SUB ', 0xee: 'INPUT ', 0xef: 'LOAD ', 0xf0: 'LIST ',
  0xf1: 'LET ', 0xf2: 'PAUSE ', 0xf3: 'NEXT ', 0xf4: 'POKE ',
  0xf5: 'PRINT ', 0xf6: 'PLOT ', 0xf7: 'RUN ', 0xf8: 'SAVE ',
  0xf9: 'RANDOMIZE ', 0xfa: 'IF ', 0xfb: 'CLS ', 0xfc: 'DRAW ',
  0xfd: 'CLEAR ', 0xfe: 'RETURN ', 0xff: 'COPY ',
};

const STATEMENT_KEYWORDS = new Set([
  'BEEP', 'BORDER', 'BRIGHT', 'CAT', 'CIRCLE', 'CLEAR', 'CLOSE #', 'CLS',
  'CONTINUE', 'COPY', 'DATA', 'DEF FN', 'DIM', 'DRAW', 'ERASE', 'FLASH',
  'FOR', 'FORMAT', 'GO SUB', 'GO TO', 'IF', 'INK', 'INPUT', 'INVERSE',
  'LET', 'LIST', 'LLIST', 'LOAD', 'LPRINT', 'MERGE', 'MOVE', 'NEW',
  'NEXT', 'OPEN #', 'OUT', 'OVER', 'PAPER', 'PAUSE', 'PLOT', 'POKE',
  'PRINT', 'RANDOMIZE', 'READ', 'REM', 'RESTORE', 'RETURN', 'RUN',
  'SAVE', 'STOP', 'VERIFY',
]);

const FUNCTION_KEYWORDS = new Set([
  'ABS', 'ACS', 'AND', 'ASN', 'ATN', 'ATTR', 'BIN', 'CHR$', 'CODE',
  'COS', 'EXP', 'FN', 'IN', 'INKEY$', 'INT', 'LEN', 'LINE', 'LN',
  'NOT', 'OR', 'PEEK', 'PI', 'POINT', 'RND', 'SCREEN$', 'SGN', 'SIN',
  'SQR', 'STR$', 'TAN', 'USR', 'VAL', 'VAL$',
]);

// TS2068 extended tokens (0x7B-0x7F)
const TS2068_TOKENS: Record<number, { text: string; isStatement: boolean }> = {
  0x7b: { text: 'ON ERR ', isStatement: true },
  0x7c: { text: 'STICK ', isStatement: false },
  0x7d: { text: 'SOUND ', isStatement: true },
  0x7e: { text: 'FREE', isStatement: false },
  0x7f: { text: 'RESET ', isStatement: true },
};

// ZX Spectrum characters for the same bytes, written the way zmakebas reads
// them: the first four are their own ASCII, © has no ASCII and is `\*`.
const SPECTRUM_CHARS: Record<number, string> = {
  0x7b: '{',
  0x7c: '|',
  0x7d: '}',
  0x7e: '~',
  0x7f: '\\*', // ©
};

// Tokens for LOAD, SAVE, VERIFY, MERGE — disk commands when followed by /
const DISK_CMD_TOKENS = new Set([0xef, 0xf8, 0xd6, 0xd5]);

// Bytes that can follow ON ERR: GO TO, GO SUB, RESET, CONTINUE, STOP
const ON_ERR_FOLLOWERS = new Set([0xec, 0xed, 0x7f, 0xe8, 0xe2]);

// Expression context: bytes after which FREE/STICK make sense
const EXPR_CONTEXT = new Set([
  0x3d, // =
  0x2b, // +
  0x2d, // -
  0x2a, // *
  0x2f, // /
  0x28, // (
  0x3c, // <
  0x3e, // >
  0x3b, // ;
  0x2c, // ,
]);

/** Peek ahead past optional spaces to see if next meaningful byte is '/' (0x2F). */
function peekForSlash(data: Buffer, pos: number, end: number): boolean {
  let p = pos;
  while (p < end && data[p] === 0x20) p++;
  return p < end && data[p] === 0x2f;
}

/** Peek ahead past optional spaces to find the next non-space byte. */
function peekNextByte(data: Buffer, pos: number, end: number): number | null {
  let p = pos;
  while (p < end && data[p] === 0x20) p++;
  return p < end ? data[p] : null;
}

/** Check if a position is at statement start (beginning of line body or right after ':'). */
function isStatementPosition(data: Buffer, pos: number, start: number): boolean {
  if (pos === start) return true;
  // Scan back past spaces to find the previous meaningful byte
  let p = pos - 1;
  while (p >= start && data[p] === 0x20) p--;
  if (p < start) return true;
  return data[p] === 0x3a; // ':'
}

/**
 * Auto-disambiguate a 0x7B-0x7F byte using context heuristics.
 */
function autoDisambiguate(
  byte: number, data: Buffer, pos: number, end: number, start: number,
  tokens: BasicToken[], prevByte: number | null,
): BasicToken {
  const ts = TS2068_TOKENS[byte];
  const specChar = SPECTRUM_CHARS[byte];

  switch (byte) {
    case 0x7b: {
      // ON ERR: at statement position, or followed by GO TO/GO SUB/RESET/CONTINUE/STOP
      if (isStatementPosition(data, pos, start)) {
        return { type: 'ts2068-kw', text: ts.text };
      }
      const next = peekNextByte(data, pos + 1, end);
      if (next !== null && ON_ERR_FOLLOWERS.has(next)) {
        return { type: 'ts2068-kw', text: ts.text };
      }
      return { type: 'text', text: specChar };
    }

    case 0x7f: {
      // RESET: if preceded by ON ERR token → RESET keyword
      if (tokens.length > 0) {
        const prev = tokens[tokens.length - 1];
        if (prev.type === 'ts2068-kw' && prev.text.trim() === 'ON ERR') {
          return { type: 'ts2068-kw', text: ts.text };
        }
      }
      // Otherwise © (copyright symbol is far more common)
      return { type: 'text', text: specChar };
    }

    case 0x7d: {
      // SOUND: at statement position → SOUND keyword
      if (isStatementPosition(data, pos, start)) {
        return { type: 'ts2068-kw', text: ts.text };
      }
      return { type: 'text', text: specChar };
    }

    case 0x7c: {
      // STICK: if followed by '(' → STICK function
      const next = peekNextByte(data, pos + 1, end);
      if (next === 0x28) {
        return { type: 'ts2068-kw', text: ts.text };
      }
      return { type: 'text', text: specChar };
    }

    case 0x7e: {
      // FREE: if in expression context (after =, +, -, *, /, (, <, >, ;, , or statement keyword)
      if (prevByte !== null && EXPR_CONTEXT.has(prevByte)) {
        return { type: 'ts2068-kw', text: ts.text };
      }
      // Also after a statement keyword token (e.g. PRINT FREE, LET x=FREE)
      if (tokens.length > 0) {
        const prev = tokens[tokens.length - 1];
        if (prev.type === 'statement' || prev.type === 'disk-cmd' || prev.type === 'ts2068-kw') {
          return { type: 'ts2068-kw', text: ts.text };
        }
      }
      return { type: 'text', text: specChar };
    }
  }

  return { type: 'text', text: specChar };
}

/**
 * Detokenize a BASIC program buffer into structured lines with token classification.
 */
export function detokenize(data: Buffer, variablesOffset?: number, mode: Ts2068Mode = 'auto'): BasicListing {
  const lines: BasicLine[] = [];
  let pos = 0;

  const programEnd = variablesOffset && variablesOffset > 0 && variablesOffset < data.length
    ? variablesOffset
    : data.length;

  while (pos < programEnd) {
    if (pos + 4 > programEnd) break;

    const lineNumber = (data[pos] << 8) | data[pos + 1]; // big-endian
    const lineLen = data[pos + 2] | (data[pos + 3] << 8); // little-endian

    if (lineNumber === 0 && lineLen === 0) break;
    if (lineNumber > 9999) break;

    const lineStart = pos + 4;
    const lineEnd = Math.min(lineStart + lineLen, programEnd);

    const tokens = decodeLine(data, lineStart, lineEnd, mode);
    markLarkenDiskCmds(tokens);
    // A `\\` left at the end of a line would swallow the newline when the
    // listing is fed back to zmakebas, so respell that last backslash.
    if (tokens.length > 0) {
      const last = tokens[tokens.length - 1];
      const fixed = fixLineEnd(last.text, 0x5c);
      if (fixed !== last.text) tokens[tokens.length - 1] = { ...last, text: fixed };
    }
    lines.push({ lineNumber, tokens });

    pos = lineStart + lineLen;

    // Handle off-by-one line lengths: if we land on a 0x0D and the bytes after
    // it look like a valid next line (line number > current, reasonable length),
    // skip the stray terminator. But don't skip if 0x0D could be the high byte
    // of a valid line number (e.g., line 3328 = 0x0D00).
    if (pos < programEnd && data[pos] === 0x0d && pos + 5 < programEnd) {
      const nextLn = (data[pos + 1] << 8) | data[pos + 2];
      const nextLen = data[pos + 3] | (data[pos + 4] << 8);
      if (nextLn > lineNumber && nextLn <= 9999 && nextLen > 0 && nextLen < 5000) {
        pos++; // skip the stray 0x0D
      }
    }
  }

  return { lines };
}

/** A leading space, unless the previous token already ends at a natural break. */
function leadingSpace(tokens: BasicToken[]): string {
  if (tokens.length === 0) return '';
  const last = tokens[tokens.length - 1].text;
  const c = last[last.length - 1];
  return c && c !== ' ' && c !== '"' && c !== ':' && c !== '(' ? ' ' : '';
}

function decodeLine(data: Buffer, start: number, end: number, mode: Ts2068Mode): BasicToken[] {
  const tokens: BasicToken[] = [];
  let i = start;
  let inRem = false;
  let inQuote = false;
  let prevByte: number | null = null;

  /** A control code and the parameter bytes it takes with it, in decimal. */
  const pushControl = (count: number) => {
    let text = '';
    for (let n = 0; n < count && i + n < end; n++) text += decimalEscape(data[i + n]);
    tokens.push({ type: 'control', text });
    i += count;
  };

  while (i < end) {
    const byte = data[i];

    if (byte === 0x0d) break;

    // Track quote state (but not inside REM)
    if (byte === 0x22 && !inRem) {
      inQuote = !inQuote;
    }

    // After REM, everything is literal — but tokens still need to be rendered.
    // Nothing here is structure: a REM holds no numbers, so $0E is a byte like
    // any other, and every control code is written out rather than obeyed.
    if (inRem) {
      // Render token bytes as their keyword text
      if (byte >= 0xa5 && TOKENS[byte]) {
        tokens.push({ type: 'text', text: TOKENS[byte] });
      } else if (byte >= 0x7b && byte <= 0x7f) {
        tokens.push({ type: 'text', text: SPECTRUM_CHARS[byte] ?? String.fromCharCode(byte) });
      } else if (byte < 0x20) {
        tokens.push({ type: 'control', text: decimalEscape(byte) });
      } else {
        const ch = spectrumEscape(byte) ?? mapCharacter(byte);
        if (ch) tokens.push({ type: 'text', text: ch });
      }
      prevByte = byte;
      i++;
      continue;
    }

    // Embedded floating-point number: 0x0E + 5 bytes. The digits are already
    // in the stream, so this is the only byte run that stays unwritten — put
    // it back and the number would appear twice.
    if (byte === 0x0e) { i += 6; continue; }

    // DELETE (byte 0x0C) is a keyword to zmakebas — `DELETE` compiles straight
    // back to this byte — so outside a string it is written as the keyword,
    // which reads far better than `\{12}` and still round-trips. Inside a
    // string the letters would be literal (and in a REM, handled above,
    // likewise), so there it stays the decimal escape.
    if (byte === 0x0c && !inQuote) {
      tokens.push({ type: 'statement', text: leadingSpace(tokens) + 'DELETE ' });
      prevByte = byte;
      i++;
      continue;
    }

    // Colour control codes (1 parameter byte), AT and TAB (2), and the rest
    // of the control range. None has a named escape, so all are written in
    // decimal — INK 2 inside a string is `\{16}\{2}`.
    if (byte >= 0x10 && byte <= 0x15) { pushControl(2); continue; }
    if (byte === 0x16 || byte === 0x17) { pushControl(3); continue; }
    if (byte < 0x20) { pushControl(1); continue; }

    // TS2068 extended tokens / ZX Spectrum characters (0x7B-0x7F)
    if (byte >= 0x7b && byte <= 0x7f) {
      if (inQuote || mode === 'spectrum') {
        // Always literal character inside quotes or in Spectrum mode
        tokens.push({ type: 'text', text: SPECTRUM_CHARS[byte] });
      } else if (mode === 'ts2068') {
        // Always keyword in forced TS2068 mode
        const ts = TS2068_TOKENS[byte];
        tokens.push({ type: 'ts2068-kw', text: ts.text });
      } else {
        // Auto: apply heuristics
        tokens.push(autoDisambiguate(byte, data, i, end, start, tokens, prevByte));
      }
      prevByte = byte;
      i++;
      continue;
    }

    // BASIC keyword token
    if (byte >= 0xa5) {
      let keyword = TOKENS[byte] || `[?${byte.toString(16)}]`;
      const kw = keyword.trim();

      // Add leading space if keyword would run into previous text
      if (!keyword.startsWith(' ')) keyword = leadingSpace(tokens) + keyword;

      // Detect disk commands: LOAD/, SAVE/, VERIFY/, MERGE/ (Oliger disk syntax)
      const isDiskCmd = DISK_CMD_TOKENS.has(byte) && peekForSlash(data, i + 1, end);
      if (isDiskCmd) {
        tokens.push({ type: 'disk-cmd', text: keyword });
      } else if (STATEMENT_KEYWORDS.has(kw)) {
        tokens.push({ type: 'statement', text: keyword });
      } else if (FUNCTION_KEYWORDS.has(kw)) {
        tokens.push({ type: 'function', text: keyword });
      } else {
        tokens.push({ type: 'operator', text: keyword });
      }
      if (byte === 0xea) inRem = true; // REM
      prevByte = byte;
      i++;
      continue;
    }

    // UDG characters (0x90-0xA4), written `\a` to `\u`
    if (byte >= 0x90 && byte <= 0xa4) {
      tokens.push({ type: 'udg', text: spectrumEscape(byte)! });
      prevByte = byte;
      i++;
      continue;
    }

    // Block graphics (0x80-0x8F), written as a two-character mosaic escape
    if (byte >= 0x80 && byte <= 0x8f) {
      tokens.push({ type: 'graphic', text: spectrumEscape(byte)! });
      prevByte = byte;
      i++;
      continue;
    }

    // Regular printable characters (0x20-0x7A)
    const ch = spectrumEscape(byte) ?? mapCharacter(byte);
    if (ch) tokens.push({ type: 'text', text: ch });
    prevByte = byte;
    i++;
  }

  return tokens;
}

/**
 * Post-process: mark Larken DOS activation patterns and their disk commands.
 * Highlights both the activation call and the command it enables:
 *   1. <stmt> USR 100: LOAD ... (RANDOMIZE USR 100, PRINT USR 100, etc.)
 *   2. PRINT #<n>: LOAD ...  (after OPEN #<n>,"dd" channel init)
 *   3. PRINT #4;"..."  (LKDOS's own channel — the whole statement is DOS)
 *   4. OPEN #<n>,"dd"  (channel setup)
 *   5. OUT 244,<n>  (Oliger DOS ROM paging)
 */
function markLarkenDiskCmds(tokens: BasicToken[]): void {
  // Two-pass approach: first find and mark USR 100 sequences, then PRINT # patterns

  markUsr100Sequences(tokens);
  markPrintChannelCmds(tokens);
  markPrintChannel4(tokens);
  markOpenChannelSetup(tokens);
  markOligerOut244(tokens);
}

/** Mark tokens[from..to] as disk-cmd (preserving their text). */
function markRange(tokens: BasicToken[], from: number, to: number) {
  for (let j = from; j <= to; j++) {
    tokens[j] = { type: 'disk-cmd', text: tokens[j].text };
  }
}

/**
 * Find USR followed by 100/m1/VAL "100" patterns.
 * Mark from the statement start through the colon, plus any following disk command.
 */
function markUsr100Sequences(tokens: BasicToken[]): void {
  const DISK_CMDS = new Set(['LOAD', 'SAVE', 'MERGE', 'VERIFY', 'CAT', 'ERASE']);

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text.trim() !== 'USR') continue;

    // Check if USR is followed by 100, m1, or VAL "100"
    let valueEnd = -1;
    let j = i + 1;
    // Skip spaces
    while (j < tokens.length && tokens[j].text.trim() === '') j++;
    if (j >= tokens.length) continue;

    const nextText = tokens[j].text.trim();
    if (nextText === '100' || nextText === 'm1') {
      valueEnd = j;
      // Skip the embedded number (0x0E + 5 bytes are already stripped, but
      // there may be additional text tokens from the number)
      j++;
    } else if (nextText === 'VAL') {
      // USR VAL "100" — scan through VAL, quotes, digits, closing quote
      let k = j + 1;
      let collected = '';
      while (k < tokens.length && k < j + 6) {
        collected += tokens[k].text;
        if (collected.includes('"100"')) { valueEnd = k; break; }
        k++;
      }
      if (valueEnd < 0) continue;
      j = valueEnd + 1;
    } else {
      continue; // Not a recognized DOS activation value
    }

    // Find the start of this statement (walk back from USR to the preceding : or line start)
    let stmtStart = 0;
    for (let k = i - 1; k >= 0; k--) {
      if (tokens[k].text.trim() === ':') { stmtStart = k + 1; break; }
    }

    // Check if followed by : then a disk command
    let scanIdx = valueEnd + 1;
    while (scanIdx < tokens.length && tokens[scanIdx].text.trim() === '') scanIdx++;

    if (scanIdx < tokens.length && tokens[scanIdx].text.trim() === ':') {
      // Found colon — check what follows
      let cmdIdx = scanIdx + 1;
      while (cmdIdx < tokens.length && tokens[cmdIdx].text.trim() === '') cmdIdx++;

      if (cmdIdx < tokens.length && DISK_CMDS.has(tokens[cmdIdx].text.trim()) && tokens[cmdIdx].type === 'statement') {
        // Mark activation sequence + colon + disk command
        markRange(tokens, stmtStart, scanIdx); // through the colon
        tokens[cmdIdx] = { type: 'disk-cmd', text: tokens[cmdIdx].text };
      } else {
        // Standalone USR 100 (e.g. RANDOMIZE USR 100:GO TO dd)
        markRange(tokens, stmtStart, valueEnd);
      }
    } else {
      // No colon — mark just the USR 100 sequence
      markRange(tokens, stmtStart, valueEnd);
    }
  }
}

/**
 * Mark PRINT #<n>: <disk-cmd> patterns (Larken channel shorthand).
 */
function markPrintChannelCmds(tokens: BasicToken[]): void {
  const DISK_CMDS = new Set(['LOAD', 'SAVE', 'MERGE', 'VERIFY', 'CAT', 'ERASE']);

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text.trim() !== 'PRINT') continue;

    // Look for PRINT #<n> : <disk-cmd>  (not PRINT #<n> ; which is screen output)
    let j = i + 1;
    while (j < tokens.length && tokens[j].text.trim() === '') j++;
    if (j >= tokens.length || !tokens[j].text.trim().startsWith('#')) continue;

    // Check that the next separator is a colon, not a semicolon
    let k = j + 1;
    while (k < tokens.length) {
      const t = tokens[k].text.trim();
      if (t === ';') break; // Screen output — not a disk command pattern
      if (t === ':') {
        // Found colon — check if followed by a disk command
        let cmdIdx = k + 1;
        while (cmdIdx < tokens.length && tokens[cmdIdx].text.trim() === '') cmdIdx++;
        if (cmdIdx < tokens.length && DISK_CMDS.has(tokens[cmdIdx].text.trim()) && tokens[cmdIdx].type === 'statement') {
          markRange(tokens, i, k); // PRINT #<n> :
          tokens[cmdIdx] = { type: 'disk-cmd', text: tokens[cmdIdx].text };
        }
        break;
      }
      k++;
    }
  }
}

/**
 * Mark `PRINT #4;...` — LKDOS's own channel.
 *
 * Larken reserves stream 4 for the DOS, so `PRINT #4;"LOAD prog"` is not
 * printing anything: it is handing a command line to the disk. The command
 * itself is a string, so nothing inside it tokenizes and the earlier passes,
 * which look for a disk keyword after a colon, never see it. The whole
 * statement is disk work, up to the colon that ends it.
 */
function markPrintChannel4(tokens: BasicToken[]): void {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text.trim() !== 'PRINT') continue;

    let j = i + 1;
    while (j < tokens.length && tokens[j].text.trim() === '') j++;
    if (j >= tokens.length || tokens[j].text.trim() !== '#') continue;

    // The channel number, however many digits it was written with.
    let channel = '';
    let k = j + 1;
    while (k < tokens.length && /^\d$/.test(tokens[k].text.trim())) {
      channel += tokens[k].text.trim();
      k++;
    }
    if (channel !== '4') continue;

    // Run to the colon that ends the statement, ignoring one inside the
    // command string — `PRINT #4;"LOAD prog:2"` is all one statement.
    let end = k;
    let inQuote = false;
    for (let m = k; m < tokens.length; m++) {
      const t = tokens[m].text;
      if (t.includes('"')) inQuote = !inQuote;
      if (!inQuote && t.trim() === ':') break;
      end = m;
    }
    markRange(tokens, i, end);
  }
}

/**
 * Mark OPEN #<n>,"dd" sequences as disk-cmd (Larken disk channel initialization).
 */
function markOpenChannelSetup(tokens: BasicToken[]): void {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text.trim() !== 'OPEN #') continue;

    // Look ahead for: <number> , "dd"
    let j = i + 1;
    // Skip channel number and comma
    while (j < tokens.length && tokens[j].text.trim() !== ',') j++;
    if (j >= tokens.length) continue;
    j++; // skip comma
    // Skip spaces
    while (j < tokens.length && tokens[j].text.trim() === '') j++;
    // Check for "dd"
    if (j >= tokens.length) continue;
    // Collect the quoted string by gathering text tokens
    let quoted = '';
    for (let k = j; k < tokens.length && k < j + 5; k++) {
      quoted += tokens[k].text;
    }
    if (quoted.includes('"dd"') || quoted.includes('"DD"')) {
      // Mark the whole OPEN #<n>,"dd" sequence
      const endIdx = Math.min(j + 4, tokens.length - 1);
      // Find where the closing quote is
      let closeIdx = j;
      for (let k = j; k <= endIdx; k++) {
        if (tokens[k].text.includes('"') && k > j) { closeIdx = k; break; }
        closeIdx = k;
      }
      for (let k = i; k <= closeIdx; k++) {
        tokens[k] = { type: 'disk-cmd', text: tokens[k].text };
      }
    }
  }
}

/**
 * Mark OUT 244,<n> sequences as disk-cmd (Oliger DOS ROM paging).
 * OUT 244,1 pages in the disk ROM; OUT 244,0 pages it out.
 */
function markOligerOut244(tokens: BasicToken[]): void {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text.trim() !== 'OUT') continue;

    // Collect the text after OUT to check for "244,<n>"
    let collected = '';
    let endIdx = i;
    for (let j = i + 1; j < tokens.length && j < i + 8; j++) {
      const t = tokens[j].text.trim();
      if (t === ':' || t === '') { if (t === ':') break; continue; }
      collected += t;
      endIdx = j;
      // Check if we've seen "244,<digit>"
      if (/^244,\d+$/.test(collected.replace(/\s/g, ''))) {
        for (let k = i; k <= endIdx; k++) {
          tokens[k] = { type: 'disk-cmd', text: tokens[k].text };
        }
        break;
      }
    }
  }
}

/**
 * A byte that is its own character. £, ↑ and the backslash are not — they go
 * through `spectrumEscape`, which every caller consults first.
 */
function mapCharacter(byte: number): string {
  if (byte >= 0x20 && byte <= 0x7a) return String.fromCharCode(byte);
  return '';
}
