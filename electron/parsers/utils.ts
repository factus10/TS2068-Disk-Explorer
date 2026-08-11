import * as fs from 'fs';
import * as path from 'path';

const SAFE_CHARS = new Set(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~ -_.'.split('')
);

export function makeSafeFilename(input: string): string {
  return input
    .split('')
    .filter((c) => SAFE_CHARS.has(c))
    .join('');
}

export function uniquePath(filepath: string): string {
  if (!fs.existsSync(filepath)) return filepath;
  const { dir, name, ext } = path.parse(filepath);
  let counter = 2;
  while (fs.existsSync(path.join(dir, `${name}_${counter}${ext}`))) {
    counter++;
  }
  return path.join(dir, `${name}_${counter}${ext}`);
}

/**
 * Disambiguate names that are about to share one namespace with no directory
 * to check against — a ZIP central directory, say. Two catalog entries can
 * carry the same name, and archive.org naming keeps them the same, so the
 * copies would otherwise silently overwrite one another.
 *
 * The counter goes before the extension, which starts at the first dot after
 * the metadata suffixes so that a `.dis.json` stays a `.dis.json`.
 */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((original) => {
    const dot = original.indexOf('.', original.lastIndexOf(')') + 1);
    const stem = dot < 0 ? original : original.slice(0, dot);
    const ext = dot < 0 ? '' : original.slice(dot);
    let name = original;
    for (let n = 2; used.has(name); n++) name = `${stem} (${n})${ext}`;
    used.add(name);
    return name;
  });
}

export function calculateCrc(data: Buffer | Uint8Array): number {
  let result = 0;
  for (let i = 0; i < data.length; i++) {
    result ^= data[i];
  }
  return result;
}

export function readUint16LE(buf: Buffer, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

export function readUint16BE(buf: Buffer, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1];
}

export function readUint32BE(buf: Buffer, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

export function writeUint16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf[0] = value & 0xff;
  buf[1] = (value >> 8) & 0xff;
  return buf;
}

export function writeUint16BE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf[0] = (value >> 8) & 0xff;
  buf[1] = value & 0xff;
  return buf;
}

/** A file is called text when this fraction of its bytes are printable. */
export const TEXT_PRINTABLE_THRESHOLD = 0.9;

/**
 * Whether a file reads as text rather than as something to execute.
 *
 * This matters more than it sounds. On the newsletter disks almost everything
 * is saved as CODE — 264 of the 294 files that reached the disassembler across
 * the sample images are word-processor articles, one of which opens "THE
 * CHARTER AND BY-LAWS OF THE SINCLAIR COMPUTER USERS' SOCIETY". Disassembling
 * prose does not fail; it yields a confident listing of instructions that were
 * never executed.
 *
 * The separation is not marginal. Of those 294, 260 are over 98% printable and
 * 26 are under 50%, with almost nothing in between, so the threshold is not
 * doing delicate work.
 *
 * The renderer decides the same thing in ContentViewer, across the IPC
 * boundary it does not import across; the two have to agree.
 */
export function isTextData(data: ArrayLike<number>): boolean {
  if (!data.length) return false;
  const len = Math.min(data.length, 2048);
  let printable = 0;
  for (let i = 0; i < len; i++) {
    const b = data[i];
    if ((b >= 0x20 && b <= 0x7e) || b === 0x0d || b === 0x0a || b === 0x09) printable++;
  }
  return printable / len >= TEXT_PRINTABLE_THRESHOLD;
}
