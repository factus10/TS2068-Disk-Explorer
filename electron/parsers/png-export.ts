/**
 * Simple PNG encoder for SCREEN$ data.
 * Builds a valid PNG file from RGBA pixel data without requiring canvas.
 * Implements the minimum PNG spec: IHDR + IDAT (deflate) + IEND.
 */

import * as zlib from 'zlib';

const WIDTH = 256;
const HEIGHT = 192;

/**
 * Encode RGBA pixel data (256x192) to a PNG Buffer.
 * @param rgba - Array of RGBA values (256 * 192 * 4 = 196608 values)
 * @param scale - Upscale factor (1, 2, or 4)
 */
export function encodePng(rgba: number[], scale: number = 1): Buffer {
  const w = WIDTH * scale;
  const h = HEIGHT * scale;

  // Build raw image data with filter byte (0 = None) per row
  const rawData = Buffer.alloc(h * (1 + w * 4));
  let pos = 0;

  for (let y = 0; y < h; y++) {
    rawData[pos++] = 0; // filter: None
    const srcY = Math.floor(y / scale);
    for (let x = 0; x < w; x++) {
      const srcX = Math.floor(x / scale);
      const srcIdx = (srcY * WIDTH + srcX) * 4;
      rawData[pos++] = rgba[srcIdx];     // R
      rawData[pos++] = rgba[srcIdx + 1]; // G
      rawData[pos++] = rgba[srcIdx + 2]; // B
      rawData[pos++] = rgba[srcIdx + 3]; // A
    }
  }

  // Compress with zlib deflate
  const compressed = zlib.deflateSync(rawData);

  // Build PNG file
  const chunks: Buffer[] = [];

  // PNG signature
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(buildChunk('IHDR', ihdr));

  // IDAT chunk
  chunks.push(buildChunk('IDAT', compressed));

  // IEND chunk
  chunks.push(buildChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function buildChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBytes = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBytes, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBytes, data, crc]);
}

/** CRC-32 for PNG chunks. */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
