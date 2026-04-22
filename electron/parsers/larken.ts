import { readUint16LE } from './utils';
import type { CatalogResult, DiskHeader, FileEntry, FileType } from './types';

// Directory markers
const DIR_START = 0xff;
const BLOCK_LIST_START = 0xfd;
const BLOCK_LIST_END = 0xf9;
const DIR_END = 0xfa;
const UNUSED_ENTRY = 0xfe;

const BLOCK_SIZE = 5120;
const TRACK_MAP_OFFSET = 24;

// Memory dump detection
const MEMORY_START = 0x4000;
const MEMORY_DUMP_MIN = 40960;

// LKDOS filename spec (per Larken Operating Manual L3/L3F, pg. 1):
//   - Program name up to 6 characters, followed by a period and a 2-char extension.
//   - Extension's first letter is the type: A=Array, B=BASIC, C=Code.
//   - Second letter is free (e.g. B1, BB, Cx, Cm, C$). String arrays use "$".
//   - Special case: AUTOSTART (no extension) is an NMI memory snapshot that
//     autoruns at power-up — see NMI_SAVES comment below.
function getFileTypeFromName(filename: string): FileType | null {
  if (!filename.includes('.')) return null;
  const ext = filename.split('.').pop() || '';
  if (!ext) return null;
  const first = ext[0].toUpperCase();
  if (first === 'B') return 'basic';
  if (first === 'C') return 'code';
  if (first === 'A') return ext.length > 1 && ext[1] === '$' ? 'str-array' : 'num-array';
  return null;
}

// Larken NMI (Non-Maskable Interrupt) SAVE files: memory snapshots created
// by the disk interface's push button or by AUTOSTART programs. They store
// memory from the attribute file (0x5800) up to RAMTOP, plus Z80 register
// and stack state embedded in the bottom line of the screen data.
//
//   - AUTOSTART: BASIC/MC program that autoruns at power-up. CLEAR 27579
//     yields exactly 5089 bytes (one block). Manual p.4.
//   - NMI-S1.CM through NMI-S5.CM: snapshots from the NMI push button,
//     labelled 1-5 by which number key was pressed. Manual p.4.
//   - SCREEN.CM: NMI-button screen-only dump (pressed 's'). Manual p.4.
//
// These files are bundled memory dumps — not pure BASIC — so we flag them
// as memory dumps so viewers can handle the register/state prefix before
// the BASIC program data.
function isNmiSaveFile(filename: string): boolean {
  const name = filename.trim();
  if (name === 'AUTOSTART') return true;
  if (/^NMI-S[1-5]\.CM$/i.test(name)) return true;
  if (/^SCREEN\.CM$/i.test(name)) return true;
  return false;
}

// Scan the file content for the longest run of valid Spectrum BASIC lines.
// Returns the start offset and line count of the longest run, or null.
// This catches SAFE/AUTOSTART-style memory dumps that wrap a real BASIC
// program behind a system-variables header.
function scanForBasicStream(data: Buffer): { offset: number; lines: number } | null {
  let best: { offset: number; lines: number } | null = null;
  let o = 0;
  while (o < data.length - 6) {
    const ln = (data[o] << 8) | data[o + 1];
    const ll = data[o + 2] | (data[o + 3] << 8);
    if (ln < 1 || ln > 9999 || ll < 2 || ll > 500 || data[o + 3 + ll] !== 0x0d) {
      o++;
      continue;
    }
    let off = o;
    let last = 0;
    let cnt = 0;
    while (off + 4 < data.length) {
      const l = (data[off] << 8) | data[off + 1];
      const l2 = data[off + 2] | (data[off + 3] << 8);
      if (l < 1 || l > 9999 || l2 < 2 || l2 > 500 || l <= last) break;
      if (data[off + 4 + l2 - 1] !== 0x0d) break;
      cnt++;
      last = l;
      off += 4 + l2;
    }
    if (cnt > 0 && (!best || cnt > best.lines)) best = { offset: o, lines: cnt };
    o = off > o ? off : o + 1;
  }
  return best;
}

// Content-based file-type classifier. The filename extension is only a
// weak hint — Larken disks often contain files where the author renamed
// a CODE file with a .B1 extension or vice versa. We combine extension,
// header fields, and a BASIC-stream content scan to decide.
function classifyFile(
  extType: FileType | null,
  data: Buffer | null,
  raw: { startAddr: number; varsOffset: number; fileLength: number },
): { type: FileType; basicOffset: number } {
  const { startAddr, varsOffset, fileLength } = raw;

  // Classic SCREEN$ (6912 bytes at screen address) — always CODE
  if (fileLength === 6912 && (startAddr === 0x4000 || startAddr === 16384)) {
    return { type: 'code', basicOffset: 0 };
  }

  // Run the content scan — produces strong evidence either way
  const scan = data ? scanForBasicStream(data) : null;

  // Strong BASIC evidence: substantial line stream + varsOffset near size
  const looksLikeBasicHeader = fileLength > 0 && varsOffset > 0 &&
    varsOffset >= fileLength - 20 && varsOffset <= fileLength;

  if (scan && scan.lines >= 10) {
    // Lots of BASIC lines found — definitely BASIC
    return { type: 'basic', basicOffset: scan.offset };
  }
  if (scan && scan.lines >= 3 && looksLikeBasicHeader) {
    // Moderate evidence: short program but header says BASIC
    return { type: 'basic', basicOffset: scan.offset };
  }
  if (scan && scan.lines >= 5 && extType === 'basic') {
    // Extension says BASIC and we found some lines — trust it
    return { type: 'basic', basicOffset: scan.offset };
  }

  // No significant BASIC content — use header fields to decide
  // BASIC files have varsOffset ≈ fileLength (vars area right after program)
  if (looksLikeBasicHeader && extType !== 'code') {
    return { type: 'basic', basicOffset: 0 };
  }

  // Everything else is CODE (or array if extension says so)
  if (extType === 'num-array' || extType === 'str-array') {
    return { type: extType, basicOffset: 0 };
  }

  return { type: 'code', basicOffset: 0 };
}

const TYPE_NAMES: Record<FileType, string> = {
  'basic': 'BASIC',
  'code': 'CODE',
  'num-array': 'Numeric array',
  'str-array': 'String array',
  'module': 'MODULE',
  'data': 'DATA',
  'exec': 'EXEC',
  'rel': 'REL',
  'dir': 'DIR',
  'state': 'State capture',
  'unknown': 'Unknown',
};

function findDirectoryStart(block0: Buffer): number | null {
  let index = TRACK_MAP_OFFSET;
  while (index < block0.length) {
    if (block0[index] === DIR_START) return index;
    index++;
  }
  return null;
}

export function detect(buffer: Buffer): boolean {
  if (buffer.length < 0x200) return false;
  if (buffer[0xbc] !== DIR_START) return false;
  let markers = 0;
  for (let i = 0xbc; i < Math.min(buffer.length, 0x200); i++) {
    if ([DIR_START, BLOCK_LIST_START, BLOCK_LIST_END, DIR_END, UNUSED_ENTRY].includes(buffer[i])) {
      markers++;
    }
  }
  return markers > 3;
}

export function readCatalog(buffer: Buffer): CatalogResult {
  const firstBlock = buffer.subarray(0, Math.min(BLOCK_SIZE, buffer.length));
  if (firstBlock.length < BLOCK_SIZE) {
    throw new Error('Image file too small for Larken format');
  }

  const sides = firstBlock[20];
  const tracks = firstBlock[21];
  const fileSize = buffer.length;
  const divideBlocks = fileSize < 250000 && sides === 1;

  const header: DiskHeader = {
    format: 'larken',
    formatName: 'Larken (LKDOS)',
    diskName: '',
    sides,
    tracks,
    extra: { divideBlocks: divideBlocks ? 1 : 0, fileSize },
  };

  const dirStart = findDirectoryStart(firstBlock);
  if (dirStart === null) {
    return { header, entries: [] };
  }

  const entries: FileEntry[] = [];
  let index = dirStart;
  let entryIdx = 0;

  while (index < firstBlock.length && firstBlock[index] !== DIR_END) {
    if (firstBlock[index] === DIR_START) {
      index++;

      if (index < firstBlock.length && firstBlock[index] !== UNUSED_ENTRY) {
        // Read filename
        let filename = '';
        while (index < firstBlock.length && firstBlock[index] !== BLOCK_LIST_START) {
          filename += String.fromCharCode(firstBlock[index]);
          index++;
        }

        if (index < firstBlock.length && firstBlock[index] === BLOCK_LIST_START) {
          index++;

          // Read block list
          const blocks: number[] = [];
          while (index < firstBlock.length && firstBlock[index] !== BLOCK_LIST_END) {
            const blockNum = divideBlocks ? Math.floor(firstBlock[index] / 2) : firstBlock[index];
            blocks.push(blockNum);
            index++;
          }

          if (blocks.length > 0) {
            // Read file data to get header info for catalog display
            const fileData = readFileDataInternal(buffer, blocks);

            // Content-based classification: the filename extension is only
            // a hint. Larken disks often contain files where the author
            // renamed a CODE file with a .B1 extension or vice versa, so we
            // verify the claimed type against the actual file content.
            const extType = getFileTypeFromName(filename);
            let fileType: FileType;
            let basicOffset = 0;
            if (fileData) {
              // Only scan within the declared file length so we don't pick
              // up "BASIC-looking" bytes from adjacent blocks.
              const trimmed = fileData.content.subarray(0, fileData.fileLength);
              const scanData = { ...fileData, content: trimmed };
              const inferred = classifyFile(extType, trimmed, scanData);
              fileType = inferred.type;
              basicOffset = inferred.basicOffset;
              // Safety: if basicOffset lands past the end, ignore it.
              if (basicOffset >= fileData.fileLength) basicOffset = 0;
            } else {
              fileType = extType ?? 'code';
            }

            // AUTOSTART and NMI SAVE files are snapshots of RAM from the
            // attribute file (0x5800) upward — always treated as memory
            // dumps regardless of declared type. See isNmiSaveFile comment.
            const isNmiSave = isNmiSaveFile(filename);
            const isMemDump = isNmiSave || (fileData !== null &&
              fileData.startAddr === MEMORY_START &&
              fileData.fileLength >= MEMORY_DUMP_MIN &&
              fileData.varsOffset === 0);

            // When we've sliced off a header to expose the BASIC stream,
            // adjust varsOffset so it's relative to the sliced buffer.
            const rawVars = fileData?.varsOffset ?? 0;
            const adjustedVars =
              basicOffset > 0 && rawVars > basicOffset ? rawVars - basicOffset : rawVars;

            // Clamp declared file length against what the allocated blocks
            // can physically hold. Each block has 24 bytes of header and
            // 5096 bytes of data; some authors seem to have shared blocks
            // between multiple directory entries, leaving bogus fileLength.
            const BLOCK_PAYLOAD = BLOCK_SIZE - 24;
            const capacity = blocks.length * BLOCK_PAYLOAD;
            const declaredSize = fileData?.fileLength ?? 0;
            const clampedSize = declaredSize > capacity ? capacity : Math.max(0, declaredSize);
            const adjustedSize = basicOffset > 0 && basicOffset < clampedSize
              ? clampedSize - basicOffset
              : clampedSize;

            // Flag files whose first block is unwritten/erased (no 0xFF
            // marker) — these are valid directory entries but their data
            // region has been zeroed out or never written.
            const firstBlockOffset = blocks[0] * BLOCK_SIZE;
            const firstBlockUnwritten =
              firstBlockOffset + 1 <= buffer.length &&
              buffer[firstBlockOffset] !== 0xff;

            // Flag files whose blocks extend beyond the image so users can
            // see why they show zero bytes (the image is truncated).
            const maxBlockInImage = Math.floor(buffer.length / BLOCK_SIZE);
            const outOfRange = blocks.some((b) => b >= maxBlockInImage);
            const metadata: Record<string, string> = {};
            if (isNmiSave) {
              if (filename.trim() === 'AUTOSTART') {
                metadata['Notes'] = 'NMI autorun snapshot: memory dump from 0x5800 (attributes) to RAMTOP, including Z80 registers in the bottom screen line. Runs automatically at power-up.';
              } else if (/^NMI-S/i.test(filename)) {
                metadata['Notes'] = 'NMI push-button snapshot: program memory saved by pressing the disk interface button. Contains RAM from 0x5800 to RAMTOP plus Z80 register state.';
              } else {
                metadata['Notes'] = 'NMI screen snapshot: display file dump (pressed "s" on the NMI push button).';
              }
            }
            if (outOfRange) {
              metadata['Status'] = `Truncated (blocks beyond image: image has ${maxBlockInImage}, entry references up to ${Math.max(...blocks)})`;
            } else if (firstBlockUnwritten) {
              metadata['Status'] = `Empty (first block at offset ${firstBlockOffset} is unwritten / erased — no valid file data)`;
            } else if (fileData && fileData.nameBytes.length > 0) {
              // Compare the block header's embedded filename against the
              // directory entry's filename. A mismatch indicates the
              // directory points at blocks owned by a different file.
              // The block name is a fixed-width 10-byte field padded with
              // spaces/commas/nulls, so trim at the first such separator.
              const blockName = fileData.nameBytes.toString('ascii')
                .split(/[\x00 ,]/)[0];
              const entryName = filename.trim();
              if (blockName && entryName && blockName !== entryName) {
                metadata['Status'] = `Block header mismatch (directory says "${entryName}", blocks contain "${blockName}")`;
              } else if (declaredSize > capacity) {
                metadata['Status'] = `Declared size (${declaredSize}) exceeds allocated blocks (${capacity}); showing clamped content`;
              }
            }

            entries.push({
              index: entryIdx++,
              filename,
              type: fileType,
              typeName: TYPE_NAMES[fileType],
              size: adjustedSize,
              params: {
                startAddr: fileData?.startAddr ?? 0,
                autostartLine: fileData?.autostartLine ?? 0,
                varsOffset: adjustedVars,
                param1: fileType === 'code' ? (fileData?.startAddr ?? 0) : (fileData?.autostartLine ?? 0),
                param2: fileType === 'code' ? 32768 : adjustedVars,
                basicOffset,
              },
              blocks,
              isMemoryDump: isMemDump,
              isDirectory: false,
              metadata,
            });
          }
        }
      } else {
        // Skip unused entry
        while (index < firstBlock.length) {
          if (firstBlock[index] === DIR_END || firstBlock[index] === DIR_START) {
            index--;
            break;
          }
          index++;
        }
      }
    }
    index++;
  }

  return { header, entries };
}

interface RawFileData {
  startAddr: number;
  autostartLine: number;
  varsOffset: number;
  fileLength: number;
  content: Buffer;
  nameBytes: Buffer;
}

function readFileDataInternal(buffer: Buffer, blocks: number[]): RawFileData | null {
  if (blocks.length === 0) return null;

  const content: number[] = [];
  let startAddr = 0;
  let autostartLine = 0;
  let varsOffset = 0;
  let fileLength = 0;
  let nameBytes = Buffer.alloc(10);

  const firstBlock = blocks[0];

  for (const blockNum of blocks) {
    const offset = blockNum * BLOCK_SIZE;
    if (offset + BLOCK_SIZE > buffer.length) continue;

    const block = buffer.subarray(offset, offset + BLOCK_SIZE);

    if (block[0] !== 0xff) continue;

    if (blockNum === firstBlock) {
      nameBytes = Buffer.from(block.subarray(2, 12));
      startAddr = readUint16LE(block, 12);
      autostartLine = readUint16LE(block, 17);
      varsOffset = readUint16LE(block, 20);
      fileLength = readUint16LE(block, 22);
    }

    const dataSize = readUint16LE(block, 14);
    for (let i = 24; i < 24 + dataSize && i < BLOCK_SIZE; i++) {
      content.push(block[i]);
    }
  }

  return {
    startAddr,
    autostartLine,
    varsOffset,
    fileLength,
    content: Buffer.from(content),
    nameBytes,
  };
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  const raw = readFileDataInternal(buffer, entry.blocks);
  if (!raw) return null;

  // Clamp to the entry's clamped size (set by readCatalog) so we don't
  // expose more data than the allocated blocks actually hold when the
  // declared fileLength is bogus.
  const maxSize = entry.size > 0 ? entry.size : raw.content.length;
  const clamped = raw.content.length > maxSize + (entry.params.basicOffset ?? 0)
    ? raw.content.subarray(0, maxSize + (entry.params.basicOffset ?? 0))
    : raw.content;

  // For SAFE/AUTOSTART files where the BASIC program lives behind a
  // system-variables header, return just the BASIC + variables region so
  // the detokenizer sees a conventional [lineNum BE][lineLen LE]... stream.
  const basicOffset = entry.params.basicOffset ?? 0;
  if (entry.type === 'basic' && basicOffset > 0 && basicOffset < clamped.length) {
    return clamped.subarray(basicOffset);
  }
  return clamped;
}
