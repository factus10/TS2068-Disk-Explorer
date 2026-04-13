/**
 * BASIC program editor: rebuilds programs with byte-level preservation.
 *
 * Key principle: only re-tokenize the parts of a line the user actually changed.
 * This preserves the original byte representation of unchanged text, avoiding
 * re-tokenization artifacts (e.g., variable names that look like keywords).
 *
 * Approach: build a character→byte position map during detokenization, then
 * use it to copy original bytes for unchanged regions and only re-tokenize
 * the changed portions.
 */

import { tokenizeLine } from './basic-tokenizer';
import { readUint16BE, readUint16LE } from './utils';
import { buildTapFile } from './tap';
import type { FileEntry } from './types';

/** Map from character position in detokenized text to byte range in original data. */
interface CharByteMap {
  text: string;
  /** For each character index: [startByteOffset, endByteOffset) in the line body */
  map: { start: number; end: number }[];
}

// Token table for detokenization (duplicated here to avoid circular imports)
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

function mapCharacter(byte: number): string {
  if (byte === 0x60) return '\u00A3';
  if (byte === 0x7f) return '\u00A9';
  if (byte === 0x5e) return '\u2191';
  if (byte >= 0x20 && byte <= 0x7a) return String.fromCharCode(byte);
  return '';
}

/**
 * Detokenize a line body while building a character→byte position map.
 * This mirrors the detokenizer logic but tracks byte offsets.
 */
function decodeLineWithMap(data: Buffer, start: number, end: number): CharByteMap {
  let text = '';
  const map: { start: number; end: number }[] = [];
  let i = start;
  let inRem = false;
  let prevText = '';

  while (i < end) {
    const byte = data[i];
    if (byte === 0x0d) break;

    if (inRem) {
      if (byte === 0x0e) { i += 6; continue; }
      const ch = mapCharacter(byte);
      if (ch) {
        for (const c of ch) map.push({ start: i, end: i + 1 });
        text += ch;
      }
      i++;
      continue;
    }

    // Embedded float: skip silently (no output characters)
    if (byte === 0x0e) { i += 6; continue; }

    // Control codes: skip silently
    if (byte >= 0x10 && byte <= 0x15) { i += 2; continue; }
    if (byte === 0x16 || byte === 0x17) { i += 3; continue; }
    if (byte < 0x20) { i++; continue; }

    // Keyword token
    if (byte >= 0xa5) {
      let keyword = TOKENS[byte] || '';
      // Add leading space if needed (same logic as detokenizer)
      if (!keyword.startsWith(' ') && text.length > 0) {
        const lastChar = text[text.length - 1];
        if (lastChar && lastChar !== ' ' && lastChar !== '"' && lastChar !== ':' && lastChar !== '(') {
          keyword = ' ' + keyword;
        }
      }
      for (const c of keyword) map.push({ start: i, end: i + 1 });
      text += keyword;
      if (byte === 0xea) inRem = true;
      i++;
      continue;
    }

    // UDG
    if (byte >= 0x90 && byte <= 0xa4) {
      const letter = String.fromCharCode(0x41 + (byte - 0x90));
      const udgText = `[UDG-${letter}]`;
      for (const c of udgText) map.push({ start: i, end: i + 1 });
      text += udgText;
      i++;
      continue;
    }

    // Block graphics
    if (byte >= 0x80 && byte <= 0x8f) {
      const BLOCK_CHARS = [
        ' ', '\u2598', '\u259D', '\u2580', '\u2596', '\u258C', '\u259E', '\u259B',
        '\u2597', '\u259A', '\u2590', '\u259C', '\u2584', '\u2599', '\u259F', '\u2588',
      ];
      const ch = BLOCK_CHARS[byte - 0x80];
      map.push({ start: i, end: i + 1 });
      text += ch;
      i++;
      continue;
    }

    // ZX Spectrum chars 0x7B-0x7F
    if (byte >= 0x7b && byte <= 0x7f) {
      const ch = mapCharacter(byte) || String.fromCharCode(byte);
      map.push({ start: i, end: i + 1 });
      text += ch;
      i++;
      continue;
    }

    // Regular character
    const ch = mapCharacter(byte);
    if (ch) {
      map.push({ start: i, end: i + 1 });
      text += ch;
    }
    i++;
  }

  return { text, map };
}

/**
 * Rebuild an edited line by preserving original bytes for unchanged portions.
 *
 * Strategy: find the longest common prefix and suffix between old and new text.
 * Copy original bytes for the prefix and suffix, re-tokenize only the middle.
 */
function rebuildLineBody(
  originalBody: Buffer,  // original tokenized line body (after the 4-byte header, before 0x0D)
  originalStart: number, // start offset in originalBody
  originalEnd: number,   // end offset in originalBody
  oldText: string,       // detokenized text of original
  newText: string,       // edited text from user
  charMap: CharByteMap,  // character→byte position map
): Buffer {
  // Find longest common prefix
  let prefixLen = 0;
  while (prefixLen < oldText.length && prefixLen < newText.length &&
         oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }

  // Find longest common suffix (from the end, not overlapping prefix)
  let suffixLen = 0;
  while (suffixLen < oldText.length - prefixLen && suffixLen < newText.length - prefixLen &&
         oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]) {
    suffixLen++;
  }

  // If the entire text is unchanged, return original bytes
  if (prefixLen + suffixLen >= oldText.length && oldText.length === newText.length) {
    return Buffer.from(originalBody.subarray(originalStart, originalEnd));
  }

  // Adjust prefix: if the prefix ends in the middle of a multi-character token
  // (multiple chars map to the same byte), back up to the token boundary
  while (prefixLen > 0) {
    const thisMap = charMap.map[prefixLen - 1];
    const nextMap = prefixLen < charMap.map.length ? charMap.map[prefixLen] : null;
    // If the next char maps to the SAME byte as this one, they're from the same token
    // — we can't split here, back up
    if (nextMap && thisMap.start === nextMap.start) {
      prefixLen--;
    } else {
      break;
    }
  }

  // Adjust suffix similarly: if the suffix starts in the middle of a token, extend it
  while (suffixLen > 0) {
    const suffixCharStart = oldText.length - suffixLen;
    if (suffixCharStart < 1 || suffixCharStart >= charMap.map.length) break;
    const thisMap = charMap.map[suffixCharStart];
    const prevMap = charMap.map[suffixCharStart - 1];
    if (thisMap.start === prevMap.start) {
      suffixLen--;
    } else {
      break;
    }
  }

  // Ensure prefix + suffix don't overlap
  if (prefixLen + suffixLen > oldText.length) {
    suffixLen = Math.max(0, oldText.length - prefixLen);
  }
  if (prefixLen + suffixLen > newText.length) {
    suffixLen = Math.max(0, newText.length - prefixLen);
  }

  const parts: Buffer[] = [];

  // Prefix: original bytes up to where the change starts
  if (prefixLen > 0 && prefixLen <= charMap.map.length) {
    const prefixByteEnd = charMap.map[prefixLen - 1].end;
    let byteEnd = prefixByteEnd;
    // Include any hidden bytes (embedded numbers) after the last prefix char
    while (byteEnd < originalEnd && originalBody[byteEnd] === 0x0e) {
      byteEnd += 6;
    }
    parts.push(Buffer.from(originalBody.subarray(originalStart, byteEnd)));
  }

  // Middle: re-tokenize the changed portion
  const changedNewText = newText.substring(prefixLen, newText.length - suffixLen);
  if (changedNewText.length > 0) {
    const tokenized = tokenizeLine(changedNewText);
    // tokenizeLine adds a 0x0D at the end — strip it
    parts.push(Buffer.from(tokenized.subarray(0, tokenized.length - 1)));
  }

  // Suffix: original bytes from where the change ends
  if (suffixLen > 0 && suffixLen <= charMap.map.length) {
    const suffixCharStart = oldText.length - suffixLen;
    if (suffixCharStart < charMap.map.length) {
      const suffixByteStart = charMap.map[suffixCharStart].start;
      parts.push(Buffer.from(originalBody.subarray(suffixByteStart, originalEnd)));
    }
  }

  return Buffer.concat(parts);
}

/**
 * Parse original BASIC program data into a map of lineNumber → raw bytes.
 */
function parseOriginalLines(data: Buffer, varsOffset?: number): Map<number, Buffer> {
  const lines = new Map<number, Buffer>();
  let pos = 0;
  const end = varsOffset && varsOffset > 0 && varsOffset < data.length ? varsOffset : data.length;

  while (pos + 4 <= end) {
    const lineNum = readUint16BE(data, pos);
    const lineLen = readUint16LE(data, pos + 2);
    if (lineNum === 0 && lineLen === 0) break;
    if (lineNum > 9999) break;
    if (pos + 4 + lineLen > end) {
      // Handle off-by-one: check for stray 0x0D
      if (pos + 4 + lineLen === end + 1 && end > 0 && data[end - 1] !== 0x0d) {
        // Include the extra byte
        lines.set(lineNum, Buffer.from(data.subarray(pos, pos + 4 + lineLen)));
      }
      break;
    }

    lines.set(lineNum, Buffer.from(data.subarray(pos, pos + 4 + lineLen)));
    pos += 4 + lineLen;

    // Skip stray 0x0D (same logic as detokenizer)
    if (pos < end && data[pos] === 0x0d && pos + 5 < end) {
      const nextLn = (data[pos + 1] << 8) | data[pos + 2];
      const nextLen = data[pos + 3] | (data[pos + 4] << 8);
      if (nextLn > lineNum && nextLn <= 9999 && nextLen > 0 && nextLen < 5000) {
        pos++;
      }
    }
  }

  return lines;
}

/**
 * Rebuild a BASIC program with edited lines using byte-level preservation.
 *
 * For each edited line:
 * 1. Detokenize the original with a character→byte position map
 * 2. Diff old text vs new text to find unchanged regions
 * 3. Copy original bytes for unchanged regions, re-tokenize only changed parts
 *
 * This preserves the original byte representation of unchanged text, avoiding
 * re-tokenization artifacts (e.g., 'pi' variable staying as ASCII, not becoming PI token).
 */
export function rebuildBasicProgram(
  originalData: Buffer,
  editedLines: Record<number, string>,
  entry: FileEntry,
): Buffer | null {
  const varsOffset = entry.params.varsOffset ?? entry.params.param2 ?? originalData.length;
  const origLines = parseOriginalLines(originalData, varsOffset);

  const allLineNumbers = new Set<number>();
  for (const ln of origLines.keys()) allLineNumbers.add(ln);
  for (const ln of Object.keys(editedLines)) allLineNumbers.add(Number(ln));

  const sortedLines = [...allLineNumbers].sort((a, b) => a - b);

  const parts: Buffer[] = [];
  for (const lineNum of sortedLines) {
    const lineNumKey = lineNum;

    if (lineNumKey in editedLines) {
      const newText = editedLines[lineNumKey];
      const origLineData = origLines.get(lineNum);

      if (origLineData) {
        // We have original bytes — try byte-level preservation
        const lineBodyStart = 4; // skip 4-byte header
        const lineBodyEnd = origLineData.length;
        // Find where the 0x0D terminator is
        let bodyEnd = lineBodyStart;
        while (bodyEnd < lineBodyEnd && origLineData[bodyEnd] !== 0x0d) bodyEnd++;

        const charMap = decodeLineWithMap(origLineData, lineBodyStart, bodyEnd + 1);

        if (charMap.text === newText) {
          // Text unchanged — but rebuild the header to fix any structural issues
          // (e.g., off-by-one line lengths where 0x0D wasn't counted)
          const bodyWithTerm = Buffer.from(origLineData.subarray(lineBodyStart));
          // Ensure it ends with 0x0D
          const hasTerminator = bodyWithTerm[bodyWithTerm.length - 1] === 0x0d;
          const fixedBody = hasTerminator ? bodyWithTerm : Buffer.concat([bodyWithTerm, Buffer.from([0x0d])]);
          const fixedHeader = Buffer.alloc(4);
          fixedHeader[0] = (lineNum >> 8) & 0xff;
          fixedHeader[1] = lineNum & 0xff;
          fixedHeader[2] = fixedBody.length & 0xff;
          fixedHeader[3] = (fixedBody.length >> 8) & 0xff;
          parts.push(Buffer.concat([fixedHeader, fixedBody]));
          continue;
        }

        // Build patched line body
        const patchedBody = rebuildLineBody(
          origLineData, lineBodyStart, bodyEnd,
          charMap.text, newText, charMap,
        );

        // Rebuild with new header
        const newBody = Buffer.concat([patchedBody, Buffer.from([0x0d])]);
        const header = Buffer.alloc(4);
        header[0] = (lineNum >> 8) & 0xff;
        header[1] = lineNum & 0xff;
        header[2] = newBody.length & 0xff;
        header[3] = (newBody.length >> 8) & 0xff;
        parts.push(Buffer.concat([header, newBody]));
      } else {
        // New line (no original) — full tokenization
        const tokenized = tokenizeLine(newText);
        const header = Buffer.alloc(4);
        header[0] = (lineNum >> 8) & 0xff;
        header[1] = lineNum & 0xff;
        header[2] = tokenized.length & 0xff;
        header[3] = (tokenized.length >> 8) & 0xff;
        parts.push(Buffer.concat([header, tokenized]));
      }
    } else if (origLines.has(lineNum)) {
      parts.push(origLines.get(lineNum)!);
    }
  }

  const programData = Buffer.concat(parts);

  let varsData = Buffer.alloc(0);
  if (varsOffset > 0 && varsOffset < originalData.length) {
    varsData = Buffer.from(originalData.subarray(varsOffset));
  }

  const fullData = Buffer.concat([programData, varsData]);

  const modifiedEntry: FileEntry = {
    ...entry,
    size: fullData.length,
    params: {
      ...entry.params,
      varsOffset: programData.length,
      param2: programData.length,
    },
  };

  return buildTapFile(modifiedEntry, fullData);
}
