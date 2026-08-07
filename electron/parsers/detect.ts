import type { DiskFormat } from './types';
import { detect as detectZebra } from './zebra';
import { detect as detectQL } from './ql';
import { detect as detectLarken } from './larken';
import { detect as detectAerco } from './aerco';
import { detect as detectOliger } from './oliger';
import { detect as detectSNA } from './sna-reader';
import { detect as detectSCR } from './scr-reader';
import { detect as detectMGT } from './mgt-reader';
import { detect as detectZX81Larken } from './zx81-larken';

/**
 * Auto-detect disk image format from file contents.
 * Order matters: check extension-based formats first,
 * then magic bytes, then heuristics.
 */
export function detectFormat(buffer: Buffer, filePath?: string): DiskFormat | null {
  // 0. ZIP container (check magic bytes before extension-based detection)
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B &&
      buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'zip';
  }

  // 0a. Extension-based detection for unambiguous formats
  const ext = filePath?.toLowerCase().split('.').pop();
  if (ext === 'tap') return 'tap';
  if (ext === 'tzx') return 'tzx';
  if (ext === 'z80') return 'z80';

  // 0b. SNA by extension + size validation
  if (ext === 'sna' && detectSNA(buffer)) return 'sna';

  // 0c. SCR by extension + size validation
  if (ext === 'scr' && detectSCR(buffer)) return 'scr';

  // 0d. MGT by extension or size
  if (ext === 'mgt' && detectMGT(buffer)) return 'mgt';

  // 1. CPC DSK magic → Zebra
  const zebraResult = detectZebra(buffer);
  if (zebraResult) return zebraResult;

  // 2. QL5A/QL5B magic → Sinclair QL
  if (detectQL(buffer)) return 'ql';

  // 3. ZX81 Larken: BBDOS directory sector, or ZX81 memory images at the slot starts
  if (detectZX81Larken(buffer)) return 'zx81-larken';

  // 4. Aerco: JR at byte 0 (0x18) + JP 0x3539 or RP/M
  const aercoResult = detectAerco(buffer);
  if (aercoResult) return aercoResult;

  // 5. Larken: directory markers near 0xBC
  if (detectLarken(buffer)) return 'larken';

  // 6. Oliger V1/V2
  const oligerResult = detectOliger(buffer);
  if (oligerResult) return oligerResult;

  // 7. MGT by size heuristic (819200 bytes)
  if (detectMGT(buffer)) return 'mgt';

  // 8. SNA by size heuristic (49179 bytes)
  if (detectSNA(buffer)) return 'sna';

  // 9. SCR by size heuristic (6912 bytes) — last because it's very small
  if (detectSCR(buffer)) return 'scr';

  // 10. Fallback: if it's a .img file, try by size
  if (ext === 'img') {
    if (buffer.length > 300000) return 'larken';
  }

  return null;
}
