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
