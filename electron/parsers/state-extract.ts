/**
 * Extract BASIC program from a TS2068/ZX Spectrum state capture (memory dump).
 *
 * State captures contain full RAM snapshots. The BASIC program can be located
 * using the system variables area at 0x5C00:
 *   PROG (0x5C53): Start of BASIC program
 *   VARS (0x5C4B): End of BASIC / start of variables
 *   ELINE (0x5C59): End of edit line
 *
 * Oliger ABS captures start at 0x3E00, Larken dumps at 0x4000.
 */

export interface StateBasicInfo {
  /** Extracted BASIC program bytes */
  basicData: Buffer;
  /** Variables area bytes (preserved for runtime state) */
  varsData: Buffer;
  /** PROG system variable value */
  progAddr: number;
  /** VARS system variable value */
  varsAddr: number;
  /** ELINE system variable value */
  elineAddr: number;
}

// System variable addresses
const SYSVAR_VARS = 0x5c4b;   // Address of variables area
const SYSVAR_PROG = 0x5c53;   // Address of BASIC program
const SYSVAR_ELINE = 0x5c59;  // Address of edit line

/**
 * Extract BASIC program data from a state capture.
 * Returns null if the capture doesn't contain a valid BASIC program.
 */
export function extractBasicFromState(data: Buffer, origin: number): StateBasicInfo | null {
  const progOffset = SYSVAR_PROG - origin;
  const varsOffset = SYSVAR_VARS - origin;
  const elineOffset = SYSVAR_ELINE - origin;

  // Validate offsets are within data
  if (progOffset < 0 || progOffset + 2 > data.length) return null;
  if (varsOffset < 0 || varsOffset + 2 > data.length) return null;
  if (elineOffset < 0 || elineOffset + 2 > data.length) return null;

  const progAddr = data[progOffset] | (data[progOffset + 1] << 8);
  const varsAddr = data[varsOffset] | (data[varsOffset + 1] << 8);
  const elineAddr = data[elineOffset] | (data[elineOffset + 1] << 8);

  // Validate addresses
  if (progAddr < origin || progAddr >= origin + data.length) return null;
  if (varsAddr < progAddr || varsAddr >= origin + data.length) return null;

  const basicStart = progAddr - origin;
  const basicEnd = varsAddr - origin;
  const varsEnd = Math.min(elineAddr - origin, data.length);

  if (basicStart >= basicEnd) return null;

  const basicData = Buffer.from(data.subarray(basicStart, basicEnd));
  const varsData = Buffer.from(data.subarray(basicEnd, Math.max(basicEnd, varsEnd)));

  return { basicData, varsData, progAddr, varsAddr, elineAddr };
}
