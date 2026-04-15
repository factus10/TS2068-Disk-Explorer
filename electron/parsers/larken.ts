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

// Heuristic type detection when the filename has no recognized extension.
// First look for an embedded BASIC program stream (Larken SAFE/AUTOSTART
// files wrap the program in a system-variable header). Otherwise fall back
// to header-field checks: SCREEN$ size, screen-area load address, or a
// varsOffset that doesn't line up with the file length.
function inferFileType(
  data: Buffer | null,
  raw: { startAddr: number; varsOffset: number; fileLength: number },
): { type: FileType; basicOffset: number } {
  const { startAddr, varsOffset, fileLength } = raw;

  // Substantial BASIC stream found anywhere in the file → BASIC
  if (data) {
    const scan = scanForBasicStream(data);
    if (scan && scan.lines >= 10) return { type: 'basic', basicOffset: scan.offset };
  }

  // Classic SCREEN$ (6912 bytes) — almost certainly CODE
  if (fileLength === 6912) return { type: 'code', basicOffset: 0 };

  // BASIC lives in the user area starting at 23755 (0x5CCB) on Spectrum /
  // TS-2068. If the file targets a memory address clearly outside that area
  // (e.g. screen RAM 0x4000–0x5AFF, or a buffer like 0x5F00), treat as CODE.
  if (startAddr > 0 && startAddr < 23755) return { type: 'code', basicOffset: 0 };

  // varsOffset should be at most a few bytes below fileLength for BASIC.
  if (fileLength > 0 && varsOffset > 0 && varsOffset < fileLength - 2) {
    return { type: 'code', basicOffset: 0 };
  }

  return { type: 'basic', basicOffset: 0 };
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

            // Classify first from the filename extension; fall back to a
            // BASIC-stream scan plus header heuristics when there is no
            // type suffix on the filename.
            const extType = getFileTypeFromName(filename);
            let fileType: FileType;
            let basicOffset = 0;
            if (extType) {
              fileType = extType;
            } else if (fileData) {
              const inferred = inferFileType(fileData.content, fileData);
              fileType = inferred.type;
              basicOffset = inferred.basicOffset;
            } else {
              fileType = 'basic';
            }

            const isMemDump = fileData !== null &&
              fileData.startAddr === MEMORY_START &&
              fileData.fileLength >= MEMORY_DUMP_MIN &&
              fileData.varsOffset === 0;

            // When we've sliced off a header to expose the BASIC stream,
            // adjust varsOffset so it's relative to the sliced buffer.
            const rawVars = fileData?.varsOffset ?? 0;
            const adjustedVars =
              basicOffset > 0 && rawVars > basicOffset ? rawVars - basicOffset : rawVars;
            const adjustedSize =
              basicOffset > 0 && fileData ? fileData.fileLength - basicOffset : (fileData?.fileLength ?? 0);

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
              metadata: {},
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
  // For SAFE/AUTOSTART files where the BASIC program lives behind a
  // system-variables header, return just the BASIC + variables region so
  // the detokenizer sees a conventional [lineNum BE][lineLen LE]... stream.
  const basicOffset = entry.params.basicOffset ?? 0;
  if (entry.type === 'basic' && basicOffset > 0 && basicOffset < raw.content.length) {
    return raw.content.subarray(basicOffset);
  }
  return raw.content;
}
