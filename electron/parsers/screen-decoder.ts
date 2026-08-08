/**
 * ZX Spectrum SCREEN$ decoder.
 * A SCREEN$ is 6912 bytes: 6144 bytes pixel data + 768 bytes attribute data.
 * Ported from TAP Explorer's screen-decoder.js.
 */

export const SCREEN_SIZE = 6912;

/**
 * Whether a catalog entry is a SCREEN$ rather than something to run.
 *
 * Size and type alone, deliberately. The obvious refinement — insisting the
 * file loads at $4000 — looks more precise and is wrong: of the 44 such files
 * across the sample disks, 13 record $5F00 in their header, and they are the
 * same ones the catalog already flags as damaged. They are still screens.
 *
 * The renderer decides the same thing in ContentViewer, across the IPC
 * boundary it does not import across; the two have to agree.
 */
export function isScreenEntry(entry: { type: string; size: number }): boolean {
  return entry.type === 'code' && entry.size === SCREEN_SIZE;
}

// ZX Spectrum color palettes (RGB)
const PALETTE_NORMAL = [
  [0, 0, 0],       // black
  [0, 0, 205],     // blue
  [205, 0, 0],     // red
  [205, 0, 205],   // magenta
  [0, 205, 0],     // green
  [0, 205, 205],   // cyan
  [205, 205, 0],   // yellow
  [205, 205, 205], // white
];

const PALETTE_BRIGHT = [
  [0, 0, 0],       // black
  [0, 0, 255],     // bright blue
  [255, 0, 0],     // bright red
  [255, 0, 255],   // bright magenta
  [0, 255, 0],     // bright green
  [0, 255, 255],   // bright cyan
  [255, 255, 0],   // bright yellow
  [255, 255, 255], // bright white
];

export interface ScreenData {
  /** 192 rows × 256 columns of 0/1 pixel values */
  pixels: number[][];
  /** 24 rows × 32 columns of attribute data */
  attributes: { ink: number; paper: number; bright: number }[][];
  /** RGBA pixel data (192×256×4 bytes) ready for ImageData */
  rgba: number[];
}

/**
 * Decode a SCREEN$ buffer into pixel data and pre-rendered RGBA.
 */
export function decodeScreen(data: Buffer, invert = false): ScreenData {
  if (data.length < SCREEN_SIZE) {
    throw new Error(`SCREEN$ data too short: ${data.length} bytes (need ${SCREEN_SIZE})`);
  }

  // Decode pixel data (6144 bytes) into 192 rows of 256 pixels
  const pixels: number[][] = [];
  for (let y = 0; y < 192; y++) {
    const row = new Array(256);
    const offset = ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
    for (let col = 0; col < 32; col++) {
      const byte = data[offset + col];
      for (let bit = 7; bit >= 0; bit--) {
        row[col * 8 + (7 - bit)] = (byte >> bit) & 1;
      }
    }
    pixels.push(row);
  }

  // Decode attribute data (768 bytes at offset 6144)
  const attributes: { ink: number; paper: number; bright: number }[][] = [];
  for (let row = 0; row < 24; row++) {
    const attrRow: { ink: number; paper: number; bright: number }[] = [];
    for (let col = 0; col < 32; col++) {
      const byte = data[6144 + row * 32 + col];
      attrRow.push({
        ink: byte & 0x07,
        paper: (byte >> 3) & 0x07,
        bright: (byte >> 6) & 0x01,
      });
    }
    attributes.push(attrRow);
  }

  // Pre-render to RGBA array
  const rgba: number[] = new Array(192 * 256 * 4);
  for (let y = 0; y < 192; y++) {
    const attrRow = Math.floor(y / 8);
    for (let x = 0; x < 256; x++) {
      const attrCol = Math.floor(x / 8);
      const attr = attributes[attrRow][attrCol];
      const palette = attr.bright ? PALETTE_BRIGHT : PALETTE_NORMAL;
      const isSet = pixels[y][x] === 1;
      let color: number[];
      if (invert) {
        color = isSet ? palette[attr.paper] : palette[attr.ink];
      } else {
        color = isSet ? palette[attr.ink] : palette[attr.paper];
      }
      const idx = (y * 256 + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = 255;
    }
  }

  return { pixels, attributes, rgba };
}
