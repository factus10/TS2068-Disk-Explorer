/**
 * ZX Spectrum font → TrueType converter for the main process.
 * Converts 768-byte 8x8 bitmap fonts to TTF using opentype.js.
 */

import opentype from 'opentype.js';

const CHAR_WIDTH = 8;
const CHAR_HEIGHT = 8;
const FIRST_CHAR = 0x20;
const NUM_CHARS = 96;
const FONT_SIZE = 768;
const UNITS_PER_EM = 1024;
const PIXEL = UNITS_PER_EM / CHAR_HEIGHT; // 128 units per pixel

export function isFontFile(size: number, type: string): boolean {
  return type === 'code' && size === FONT_SIZE;
}

/**
 * Build a TTF font from 768 bytes of ZX Spectrum font data.
 * Returns an ArrayBuffer containing the TTF file.
 */
export function buildTtfFont(data: Buffer, familyName: string): Buffer {
  const ASCENDER = UNITS_PER_EM;

  // .notdef glyph
  const notdefPath = new opentype.Path();
  notdefPath.moveTo(0, 0);
  notdefPath.lineTo(PIXEL * CHAR_WIDTH, 0);
  notdefPath.lineTo(PIXEL * CHAR_WIDTH, ASCENDER);
  notdefPath.lineTo(0, ASCENDER);
  notdefPath.close();

  const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: PIXEL * CHAR_WIDTH,
    path: notdefPath,
  });

  const glyphs: opentype.Glyph[] = [notdefGlyph];

  for (let ch = 0; ch < NUM_CHARS; ch++) {
    const charCode = FIRST_CHAR + ch;
    const path = new opentype.Path();

    for (let py = 0; py < CHAR_HEIGHT; py++) {
      const byte = data[ch * 8 + py];
      for (let px = 0; px < CHAR_WIDTH; px++) {
        if (!((byte >> (7 - px)) & 1)) continue;
        const x = px * PIXEL;
        const y = (CHAR_HEIGHT - 1 - py) * PIXEL;
        path.moveTo(x, y);
        path.lineTo(x, y + PIXEL);
        path.lineTo(x + PIXEL, y + PIXEL);
        path.lineTo(x + PIXEL, y);
        path.close();
      }
    }

    glyphs.push(new opentype.Glyph({
      name: charCode === 0x20 ? 'space' : `char${charCode}`,
      unicode: charCode,
      advanceWidth: PIXEL * CHAR_WIDTH,
      path,
    }));
  }

  const font = new opentype.Font({
    familyName,
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: ASCENDER,
    descender: 0,
    glyphs,
  });

  const arrayBuffer = font.toArrayBuffer();
  return Buffer.from(arrayBuffer);
}
