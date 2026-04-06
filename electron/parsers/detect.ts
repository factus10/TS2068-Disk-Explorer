import type { DiskFormat } from './types';
import { detect as detectZebra } from './zebra';
import { detect as detectQL } from './ql';
import { detect as detectLarken } from './larken';
import { detect as detectAerco } from './aerco';
import { detect as detectOliger } from './oliger';

/**
 * Auto-detect disk image format from file contents.
 * Order matters: check formats with clear magic bytes first,
 * then fall back to heuristics.
 */
export function detectFormat(buffer: Buffer, filePath?: string): DiskFormat | null {
  // 0. TAP files by extension
  const ext = filePath?.toLowerCase().split('.').pop();
  if (ext === 'tap') return 'tap';

  // 1. CPC DSK magic → Zebra
  const zebraResult = detectZebra(buffer);
  if (zebraResult) return zebraResult;

  // 2. QL5A/QL5B magic → Sinclair QL
  if (detectQL(buffer)) return 'ql';

  // 3. Aerco: JR at byte 0 (0x18) + JP 0x3539 or RP/M
  const aercoResult = detectAerco(buffer);
  if (aercoResult) return aercoResult;

  // 4. Larken: directory markers near 0xBC
  if (detectLarken(buffer)) return 'larken';

  // 5. Oliger V1/V2
  const oligerResult = detectOliger(buffer);
  if (oligerResult) return oligerResult;

  // 6. Fallback: if it's a .img file, try by size
  if (ext === 'img') {
    if (buffer.length > 300000) return 'larken';
  }

  return null;
}
