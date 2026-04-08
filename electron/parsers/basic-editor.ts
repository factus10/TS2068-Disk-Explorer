/**
 * BASIC program editor: rebuilds programs with selectively re-tokenized lines.
 * Unedited lines keep their original binary to avoid re-tokenization ambiguities.
 */

import { tokenizeLine } from './basic-tokenizer';
import { readUint16BE, readUint16LE, writeUint16BE, writeUint16LE } from './utils';
import { buildTapFile } from './tap';
import type { FileEntry } from './types';

/**
 * Parse original BASIC program data into a map of lineNumber → raw bytes.
 * Each buffer includes the 4-byte line header + tokenized content.
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
    if (pos + 4 + lineLen > end) break;

    lines.set(lineNum, Buffer.from(data.subarray(pos, pos + 4 + lineLen)));
    pos += 4 + lineLen;
  }

  return lines;
}

/**
 * Rebuild a BASIC program with edited lines.
 * Lines in editedLines are re-tokenized; all others keep original binary.
 *
 * @param originalData - Original file data (the raw BASIC program bytes)
 * @param editedLines - Map of lineNumber → new text (detokenized text, without line number)
 * @param entry - The FileEntry for metadata (autostart, vars offset)
 * @returns Buffer containing the complete rebuilt TAP file, or null on failure
 */
export function rebuildBasicProgram(
  originalData: Buffer,
  editedLines: Record<number, string>,
  entry: FileEntry,
): Buffer | null {
  const varsOffset = entry.params.varsOffset ?? entry.params.param2 ?? originalData.length;
  const origLines = parseOriginalLines(originalData, varsOffset);

  // Collect all line numbers (original + any new lines from edits)
  const allLineNumbers = new Set<number>();
  for (const ln of origLines.keys()) allLineNumbers.add(ln);
  for (const ln of Object.keys(editedLines)) allLineNumbers.add(Number(ln));

  const sortedLines = [...allLineNumbers].sort((a, b) => a - b);

  // Rebuild each line
  const parts: Buffer[] = [];
  for (const lineNum of sortedLines) {
    if (lineNum in editedLines) {
      // Re-tokenize this line
      const tokenized = tokenizeLine(editedLines[lineNum]);
      const header = Buffer.alloc(4);
      header[0] = (lineNum >> 8) & 0xff; // BE
      header[1] = lineNum & 0xff;
      header[2] = tokenized.length & 0xff; // LE
      header[3] = (tokenized.length >> 8) & 0xff;
      parts.push(Buffer.concat([header, tokenized]));
    } else if (origLines.has(lineNum)) {
      // Keep original binary
      parts.push(origLines.get(lineNum)!);
    }
  }

  const programData = Buffer.concat(parts);

  // Preserve the variables area from the original if it exists
  let varsData = Buffer.alloc(0);
  if (varsOffset > 0 && varsOffset < originalData.length) {
    varsData = Buffer.from(originalData.subarray(varsOffset));
  }

  const fullData = Buffer.concat([programData, varsData]);

  // Build a modified FileEntry with updated sizes for TAP generation
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
