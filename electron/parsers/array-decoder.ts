/**
 * ZX Spectrum data array decoder.
 * Decodes numeric arrays (5-byte FP values) and character arrays (string data).
 * Ported from TAP Explorer's ipc-handlers.js.
 */

export interface NumericArrayData {
  kind: 'numeric';
  dimensions: number[];
  values: number[];
  totalElements: number;
}

export interface CharArrayData {
  kind: 'char';
  dimensions: number[];
  values: string[];
  stringLength: number;
  totalElements: number;
}

export type ArrayData = NumericArrayData | CharArrayData;

/**
 * Decode a ZX Spectrum 5-byte floating point number.
 * Format: exponent(1), mantissa(4)
 */
function decodeZxFloat(data: Buffer, offset: number): number {
  const exp = data[offset];

  if (exp === 0) {
    // Small integer stored in special format
    const sign = data[offset + 1];
    const lo = data[offset + 2];
    const hi = data[offset + 3];
    const val = lo | (hi << 8);
    return sign ? -val : val;
  }

  // Floating point with implied 1 bit in mantissa
  const sign = data[offset + 1] & 0x80;
  const m1 = (data[offset + 1] | 0x80) & 0xff;
  const m2 = data[offset + 2];
  const m3 = data[offset + 3];
  const m4 = data[offset + 4];

  const mantissa = m1 / 256 + m2 / 65536 + m3 / 16777216 + m4 / 4294967296;
  const value = mantissa * Math.pow(2, exp - 128);

  return sign ? -value : value;
}

/**
 * Decode a numeric array (TAP type 1).
 * Format: numDimensions(1), dims(2 bytes each LE), then 5-byte FP values.
 */
export function decodeNumericArray(content: Buffer): NumericArrayData {
  let pos = 0;
  const numDims = content[pos++];
  const dimensions: number[] = [];
  let totalElements = 1;

  for (let d = 0; d < numDims; d++) {
    if (pos + 2 > content.length) break;
    const dimSize = content[pos] | (content[pos + 1] << 8);
    pos += 2;
    dimensions.push(dimSize);
    totalElements *= dimSize;
  }

  const values: number[] = [];
  for (let i = 0; i < totalElements && pos + 5 <= content.length; i++) {
    values.push(decodeZxFloat(content, pos));
    pos += 5;
  }

  return { kind: 'numeric', dimensions, values, totalElements };
}

/**
 * Decode a character array (TAP type 2).
 * Format: numDimensions(1), dims(2 bytes each LE), then character data.
 * Last dimension is the string length.
 */
export function decodeCharArray(content: Buffer): CharArrayData {
  let pos = 0;
  const numDims = content[pos++];
  const dimensions: number[] = [];
  let totalElements = 1;

  for (let d = 0; d < numDims; d++) {
    if (pos + 2 > content.length) break;
    const dimSize = content[pos] | (content[pos + 1] << 8);
    pos += 2;
    dimensions.push(dimSize);
    totalElements *= dimSize;
  }

  const stringLength = dimensions.length > 0 ? dimensions[dimensions.length - 1] : 1;
  const numStrings = Math.floor(totalElements / stringLength);
  const values: string[] = [];

  for (let i = 0; i < numStrings && pos + stringLength <= content.length; i++) {
    let str = '';
    for (let j = 0; j < stringLength; j++) {
      str += String.fromCharCode(content[pos + j]);
    }
    values.push(str);
    pos += stringLength;
  }

  return { kind: 'char', dimensions, values, stringLength, totalElements };
}
