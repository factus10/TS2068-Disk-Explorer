/**
 * ZX81 disks written through an Aerco disk interface.
 *
 * The programs on these disks say so themselves: BBDOS's line 4 reads
 * `REM BBDOS 4.0 AERCO/DS/40/4K COPYRIGHT 1986 BILL BELL`, its help text calls
 * it "a fully automatic, BASIC transparent operating system for AERCO disk
 * users on ZX81/TS1000", and gives the memory map as `3000-37FFH AERCO BOARD`.
 * (Disk images of these are sometimes filed as "Larken" — they are not. A
 * Larken ZX81 interface answers at 14336/$3800 and 16374/$3FF6, per Larken's
 * own LFCM manual, which is a different range entirely.)
 *
 * Geometry: 40 cylinders x 2 sides x 10 sectors x 512 bytes = 409600 bytes.
 * The image stores cylinders interleaved by side — cyl0/side0, cyl0/side1,
 * cyl1/side0, ... — so a whole track is 5120 bytes and side N occupies every
 * other track (even tracks = side 0, odd tracks = side 1).
 *
 * Each side is carved into ten fixed 4-cylinder slots, twenty in all. There is
 * no allocation map and no per-file sector list: the slot number alone gives
 * the location, and a file simply runs on from its slot start until it ends.
 * These slots are Aerco's memory "pages" — BBDOS describes itself as retaining
 * "the AERCO methods of 16K and 64K pages", which is why SADOS+ numbers them
 * page 1 to page 20, and why its 64K build offers only six.
 *
 *   slot 0-9   side 0, starting at cylinders 0, 4, 8, ... 36
 *   slot 10-19 side 1, same cylinders
 *
 * Files are plain ZX81 memory images starting at VERSN (0x4009) — byte for byte
 * the `.p` tape format. Their length comes from the E_LINE system variable in
 * the image itself, and a file larger than its 20480-byte slot spills into the
 * following slots, which are then left marked free.
 *
 * Two DOSes are known to use this layout, and they name files differently:
 *
 * BBDOS 4.0 keeps a real directory at cylinder 3 / side 0 (offset 0x7800), one
 * 512-byte sector with an identical backup copy in the sector after it:
 *
 *   0x000  32 bytes  "DIRECTORY  DISK NO. nnn" padded with spaces/nulls
 *   0x020  20 x 24   one entry per slot, in slot order
 *
 * Each entry is 9 bytes of fixed per-slot template data (byte-identical across
 * every BBDOS disk examined, so it carries no per-file information) followed by
 * a 15-character name in the ZX81 character set. An all-null name means the
 * slot is free.
 *
 * SADOS+ writes no directory at all. It is a BASIC menu program that holds the
 * user's names for each slot in a `Q$` array among its own variables, and loads
 * a slot by number ("page 1" through "page 20"). Such disks are read by looking
 * for a ZX81 system-variable block at each slot start.
 */

import { readUint16LE } from './utils';
import { decodeZX81Text, detokenizeZX81 } from './zx81';
import type { CatalogResult, DiskHeader, FileEntry, FileType } from './types';

const IMAGE_SIZE = 409600;
const TRACK_SIZE = 5120;          // 10 sectors x 512 bytes
const CYLINDER_SIZE = TRACK_SIZE * 2;
const SLOTS = 20;
const SLOTS_PER_SIDE = 10;
const CYLINDERS_PER_SLOT = 4;

const DIR_OFFSET = 0x7800;        // cylinder 3, side 0
const DIR_SIZE = 512;
const DIR_HEADER_SIZE = 32;
const DIR_ENTRY_SIZE = 24;
const DIR_NAME_OFFSET = 9;
const DIR_NAME_LENGTH = 15;

// "DIRECTORY" in ZX81 character codes.
const DIR_MAGIC = [0x29, 0x2e, 0x37, 0x2a, 0x28, 0x39, 0x34, 0x37, 0x3e];

// ZX81 system variables, as offsets into a file (which begins at VERSN, 0x4009).
const SYS_D_FILE = 3;
const SYS_VARS = 7;
const SYS_E_LINE = 11;
const SYS_MEM = 22;
const SYS_DF_SZ = 25;
const PROG_BASE = 0x407d;         // start of the BASIC program area
const SYS_BASE = 0x4009;
const MEMBOT = 0x405d;            // value MEM always points at

/** Byte offset of the first track of a slot's data. */
function slotOffset(slot: number): number {
  const side = slot < SLOTS_PER_SIDE ? 0 : 1;
  const cylinder = (slot % SLOTS_PER_SIDE) * CYLINDERS_PER_SLOT;
  return cylinder * CYLINDER_SIZE + side * TRACK_SIZE;
}

/**
 * Linear track numbers holding `length` bytes from `slot`. Consecutive chunks
 * sit two tracks apart because the file stays on one side of the disk.
 */
function slotTracks(slot: number, length: number): number[] {
  const first = slotOffset(slot) / TRACK_SIZE;
  const count = Math.max(1, Math.ceil(length / TRACK_SIZE));
  const tracks: number[] = [];
  for (let i = 0; i < count; i++) tracks.push(first + i * 2);
  return tracks;
}

/** Does this offset hold a plausible ZX81 system-variable block? */
function hasSysVars(buffer: Buffer, offset: number): boolean {
  if (offset + 32 > buffer.length) return false;
  if (readUint16LE(buffer, offset + SYS_MEM) !== MEMBOT) return false;
  if (buffer[offset + SYS_DF_SZ] !== 0x02) return false;
  const dfile = readUint16LE(buffer, offset + SYS_D_FILE);
  const vars = readUint16LE(buffer, offset + SYS_VARS);
  const eline = readUint16LE(buffer, offset + SYS_E_LINE);
  return dfile >= PROG_BASE && vars >= dfile && eline >= vars;
}

function hasBbdosDirectory(buffer: Buffer): boolean {
  if (buffer.length < DIR_OFFSET + DIR_SIZE * 2) return false;
  for (let i = 0; i < DIR_MAGIC.length; i++) {
    if (buffer[DIR_OFFSET + i] !== DIR_MAGIC[i]) return false;
  }
  // The backup copy in the next sector must match, which rules out a chance
  // occurrence of the word "DIRECTORY" in program text.
  const primary = buffer.subarray(DIR_OFFSET, DIR_OFFSET + DIR_SIZE);
  const backup = buffer.subarray(DIR_OFFSET + DIR_SIZE, DIR_OFFSET + DIR_SIZE * 2);
  return primary.equals(backup);
}

function occupiedSlots(buffer: Buffer): number {
  let n = 0;
  for (let slot = 0; slot < SLOTS; slot++) if (hasSysVars(buffer, slotOffset(slot))) n++;
  return n;
}

export function detect(buffer: Buffer): boolean {
  if (buffer.length !== IMAGE_SIZE) return false;
  if (hasBbdosDirectory(buffer)) return true;
  // Without a directory the only evidence is the disk layout itself, so
  // require more than one slot to start with a ZX81 memory image before
  // claiming an image that another parser might want.
  return occupiedSlots(buffer) >= 2;
}

function readDirName(dir: Buffer, slot: number): { name: string; blank: boolean } {
  const off = DIR_HEADER_SIZE + slot * DIR_ENTRY_SIZE + DIR_NAME_OFFSET;
  const raw = dir.subarray(off, off + DIR_NAME_LENGTH);
  const blank = raw.every((b) => b === 0x00);
  return { name: decodeZX81Text(raw).replace(/\s+$/, ''), blank };
}

/**
 * How much room a slot has before the next one in use on the same side.
 * A file that outgrows its own slot runs into the following ones, which are
 * then left marked free.
 */
function slotCapacity(slot: number, inUse: (slot: number) => boolean): number {
  const side = slot < SLOTS_PER_SIDE ? 0 : 1;
  const lastOfSide = side * SLOTS_PER_SIDE + SLOTS_PER_SIDE - 1;
  let end = slot;
  while (end < lastOfSide && !inUse(end + 1)) end++;
  let cylinders = (end - slot + 1) * CYLINDERS_PER_SLOT;
  // Slot 0 stops a cylinder short on BBDOS disks: cylinder 3 of side 0 holds
  // the directory. Reserving it costs nothing on disks that have no directory.
  if (slot === 0) cylinders -= 1;
  return cylinders * TRACK_SIZE; // the file only uses its own side of each cylinder
}

/** Gather a file's tracks into one contiguous buffer. */
function readSlotData(buffer: Buffer, slot: number, length: number): Buffer {
  const out = Buffer.alloc(length);
  let written = 0;
  for (const track of slotTracks(slot, length)) {
    const src = track * TRACK_SIZE;
    if (src >= buffer.length) break;
    written += buffer.copy(out, written, src, Math.min(src + TRACK_SIZE, buffer.length));
    if (written >= length) break;
  }
  return out;
}

export function readCatalog(buffer: Buffer): CatalogResult {
  const hasDirectory = hasBbdosDirectory(buffer);
  const dir = buffer.subarray(DIR_OFFSET, DIR_OFFSET + DIR_SIZE);

  // With a BBDOS directory the names decide which slots are in use; without
  // one, a slot counts as used when it starts with a ZX81 memory image.
  const inUse = hasDirectory
    ? (slot: number) => !readDirName(dir, slot).blank
    : (slot: number) => hasSysVars(buffer, slotOffset(slot));

  const header: DiskHeader = {
    format: 'zx81-aerco',
    formatName: hasDirectory ? 'ZX81 Aerco (BBDOS)' : 'ZX81 Aerco (no directory)',
    diskName: hasDirectory ? decodeZX81Text(dir.subarray(0, DIR_HEADER_SIZE)).trim() : '',
    sides: 2,
    tracks: 40,
    extra: { slots: SLOTS, sectorsPerTrack: 10, sectorSize: 512 },
  };

  const entries: FileEntry[] = [];

  for (let slot = 0; slot < SLOTS; slot++) {
    if (!inUse(slot)) continue;

    const offset = slotOffset(slot);
    const capacity = slotCapacity(slot, inUse);
    const side = slot < SLOTS_PER_SIDE ? 0 : 1;
    const metadata: Record<string, string> = {
      Slot: `${slot} (side ${side}, cylinder ${(slot % SLOTS_PER_SIDE) * CYLINDERS_PER_SLOT})`,
    };
    if (!hasDirectory) {
      metadata['Notes'] = 'This disk has no on-disk directory. SADOS+ and similar menu programs '
        + 'keep their file names in a BASIC array of their own, and load a slot by page number.';
    }

    let type: FileType = 'unknown';
    let size = 0;
    let dfile = 0;
    let vars = 0;

    if (hasSysVars(buffer, offset)) {
      dfile = readUint16LE(buffer, offset + SYS_D_FILE);
      vars = readUint16LE(buffer, offset + SYS_VARS);
      const eline = readUint16LE(buffer, offset + SYS_E_LINE);
      size = Math.min(eline - SYS_BASE, capacity);

      // D_FILE marks the end of the BASIC program area. When it sits right at
      // the program base there are no BASIC lines — a pure machine-code or
      // data save.
      type = dfile > PROG_BASE ? 'basic' : 'code';
      metadata['ZX81 sysvars'] =
        `D_FILE=0x${dfile.toString(16)} VARS=0x${vars.toString(16)} E_LINE=0x${eline.toString(16)}`;
      if (eline - SYS_BASE > capacity) {
        metadata['Status'] =
          `Declared size (${eline - SYS_BASE}) exceeds space before the next file (${capacity}); showing clamped content`;
      }
    } else {
      metadata['Status'] = 'No ZX81 system-variable header at the slot start — data may be erased or corrupt';
    }

    entries.push({
      index: slot,
      // Without a directory there are no stored names, so fall back to the
      // page number SADOS+ menus use, which is the slot number plus one.
      filename: hasDirectory ? readDirName(dir, slot).name : `PAGE ${slot + 1}`,
      type,
      typeName: type === 'basic' ? 'ZX81 BASIC' : type === 'code' ? 'ZX81 CODE' : 'Unknown',
      size,
      params: {
        startAddr: SYS_BASE,
        autostartLine: 0,
        // Offsets within the extracted file, for the listing and detail views.
        varsOffset: vars ? vars - SYS_BASE : 0,
        progEnd: dfile ? dfile - SYS_BASE : 0,
        param1: SYS_BASE,
        param2: vars ? vars - SYS_BASE : 0,
      },
      blocks: slotTracks(slot, size),
      isMemoryDump: false,
      isDirectory: false,
      metadata,
    });
  }

  return { header, entries };
}

export function readFileData(buffer: Buffer, entry: FileEntry): Buffer | null {
  if (entry.size <= 0) return null;
  return readSlotData(buffer, entry.index, entry.size);
}

/** Detokenize a ZX81 BASIC file read from one of these disks. */
export function readBasicListing(fileData: Buffer, entry: FileEntry) {
  const progEnd = entry.params.progEnd || undefined;
  return detokenizeZX81(fileData, progEnd);
}

export { IMAGE_SIZE, TRACK_SIZE };
