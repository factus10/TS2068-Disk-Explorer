/**
 * ZX Spectrum BASIC variable area decoder.
 * Parses the variables section that follows the BASIC program in memory.
 *
 * Variable type encoding (bits 7-5 of first byte):
 *   010 (2) = string variable
 *   011 (3) = single-letter numeric
 *   100 (4) = numeric array
 *   101 (5) = multi-letter numeric (longer name)
 *   110 (6) = string array
 *   111 (7) = FOR control variable
 * Bits 4-0 of first byte = letter (0x01-0x1A → a-z)
 */

export interface BasicVariable {
  name: string;
  kind: 'number' | 'string' | 'number-array' | 'string-array' | 'for';
  value?: string;        // formatted display value
  dimensions?: number[]; // array dimensions
  values?: string[];     // array values
  // FOR loop details
  forValue?: number;
  forLimit?: number;
  forStep?: number;
  forLine?: number;
  forStatement?: number;
}

/**
 * Decode a 5-byte floating point number. The ZX81 uses the same
 * representation, so the ZX81 decoder shares this.
 */
export function decodeFloat(data: Buffer, offset: number): number {
  const exp = data[offset];
  if (exp === 0) {
    const sign = data[offset + 1];
    const lo = data[offset + 2];
    const hi = data[offset + 3];
    const val = lo | (hi << 8);
    return sign ? -val : val;
  }
  const sign = data[offset + 1] & 0x80;
  const m1 = (data[offset + 1] | 0x80) & 0xff;
  const m2 = data[offset + 2];
  const m3 = data[offset + 3];
  const m4 = data[offset + 4];
  const mantissa = m1 / 256 + m2 / 65536 + m3 / 16777216 + m4 / 4294967296;
  const value = mantissa * Math.pow(2, exp - 128);
  return sign ? -value : value;
}

export function formatNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = v.toPrecision(10);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * Parse the variables area from a BASIC program.
 */
export function parseVariables(varsData: Buffer): BasicVariable[] {
  const vars: BasicVariable[] = [];
  let pos = 0;

  while (pos < varsData.length) {
    const firstByte = varsData[pos];
    if (firstByte === 0x80) break; // end marker

    const typeBits = (firstByte >> 5) & 0x07;
    const letterCode = firstByte & 0x1f;
    const letter = String.fromCharCode(letterCode + 0x60);

    switch (typeBits) {
      case 3: { // single-letter numeric
        if (pos + 6 > varsData.length) return vars;
        const val = decodeFloat(varsData, pos + 1);
        vars.push({ name: letter, kind: 'number', value: formatNum(val) });
        pos += 6;
        break;
      }

      case 5: { // multi-letter numeric
        let name = letter;
        pos++;
        while (pos < varsData.length && !(varsData[pos] & 0x80)) {
          name += String.fromCharCode(varsData[pos]);
          pos++;
        }
        if (pos < varsData.length) {
          name += String.fromCharCode(varsData[pos] & 0x7f);
          pos++;
        }
        if (pos + 5 > varsData.length) return vars;
        const val = decodeFloat(varsData, pos);
        vars.push({ name, kind: 'number', value: formatNum(val) });
        pos += 5;
        break;
      }

      case 2: { // string
        pos++;
        if (pos + 2 > varsData.length) return vars;
        const len = varsData[pos] | (varsData[pos + 1] << 8);
        pos += 2;
        if (pos + len > varsData.length) return vars;
        let str = '';
        for (let i = 0; i < len; i++) {
          const b = varsData[pos + i];
          if (b >= 0x20 && b <= 0x7e) str += String.fromCharCode(b);
          else str += '.';
        }
        vars.push({ name: letter + '$', kind: 'string', value: `"${str}"` });
        pos += len;
        break;
      }

      case 4: { // numeric array
        pos++;
        if (pos + 2 > varsData.length) return vars;
        const totalLen = varsData[pos] | (varsData[pos + 1] << 8);
        pos += 2;
        const arrStart = pos;
        if (pos + totalLen > varsData.length) { pos += totalLen; break; }
        const numDims = varsData[pos++];
        const dimensions: number[] = [];
        let totalElements = 1;
        for (let d = 0; d < numDims; d++) {
          const dim = varsData[pos] | (varsData[pos + 1] << 8);
          dimensions.push(dim);
          totalElements *= dim;
          pos += 2;
        }
        const values: string[] = [];
        for (let i = 0; i < totalElements && pos + 5 <= arrStart + totalLen + 2; i++) {
          values.push(formatNum(decodeFloat(varsData, pos)));
          pos += 5;
        }
        vars.push({ name: letter + '()', kind: 'number-array', dimensions, values });
        pos = arrStart + totalLen;
        break;
      }

      case 6: { // string array
        pos++;
        if (pos + 2 > varsData.length) return vars;
        const totalLen = varsData[pos] | (varsData[pos + 1] << 8);
        pos += 2;
        const arrStart = pos;
        if (pos + totalLen > varsData.length) { pos += totalLen; break; }
        const numDims = varsData[pos++];
        const dimensions: number[] = [];
        let totalElements = 1;
        for (let d = 0; d < numDims; d++) {
          const dim = varsData[pos] | (varsData[pos + 1] << 8);
          dimensions.push(dim);
          totalElements *= dim;
          pos += 2;
        }
        const strLen = dimensions.length > 0 ? dimensions[dimensions.length - 1] : 1;
        const numStrings = Math.floor(totalElements / strLen);
        const values: string[] = [];
        for (let i = 0; i < numStrings && pos + strLen <= arrStart + totalLen + 2; i++) {
          let str = '';
          for (let j = 0; j < strLen; j++) {
            const b = varsData[pos + j];
            if (b >= 0x20 && b <= 0x7e) str += String.fromCharCode(b);
            else str += '.';
          }
          values.push(`"${str}"`);
          pos += strLen;
        }
        vars.push({ name: letter + '$()', kind: 'string-array', dimensions, values });
        pos = arrStart + totalLen;
        break;
      }

      case 7: { // FOR control variable
        if (pos + 19 > varsData.length) return vars;
        const val = decodeFloat(varsData, pos + 1);
        const limit = decodeFloat(varsData, pos + 6);
        const step = decodeFloat(varsData, pos + 11);
        const loopLine = varsData[pos + 16] | (varsData[pos + 17] << 8);
        const loopStmt = varsData[pos + 18];
        vars.push({
          name: letter,
          kind: 'for',
          forValue: val,
          forLimit: limit,
          forStep: step,
          forLine: loopLine,
          forStatement: loopStmt,
        });
        pos += 19;
        break;
      }

      default:
        return vars; // unknown type, stop parsing
    }
  }

  return vars;
}
