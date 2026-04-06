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

function getFileTypeFromName(filename: string): FileType {
  if (!filename.includes('.')) return 'basic';
  const ext = filename.split('.').pop() || '';
  if (!ext) return 'basic';
  const first = ext[0].toUpperCase();
  if (first === 'B') return 'basic';
  if (first === 'C') return 'code';
  if (first === 'A') return ext.length > 1 && ext[1] === '$' ? 'str-array' : 'num-array';
  return 'basic';
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
            const fileType = getFileTypeFromName(filename);

            // Read file data to get header info for catalog display
            const fileData = readFileDataInternal(buffer, blocks);

            const isMemDump = fileData !== null &&
              fileData.startAddr === MEMORY_START &&
              fileData.fileLength >= MEMORY_DUMP_MIN &&
              fileData.varsOffset === 0;

            entries.push({
              index: entryIdx++,
              filename,
              type: fileType,
              typeName: TYPE_NAMES[fileType],
              size: fileData?.fileLength ?? 0,
              params: {
                startAddr: fileData?.startAddr ?? 0,
                autostartLine: fileData?.autostartLine ?? 0,
                varsOffset: fileData?.varsOffset ?? 0,
                param1: fileType === 'code' ? (fileData?.startAddr ?? 0) : (fileData?.autostartLine ?? 0),
                param2: fileType === 'code' ? 32768 : (fileData?.varsOffset ?? 0),
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
  return raw.content;
}
