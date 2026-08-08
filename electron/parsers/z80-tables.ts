/**
 * Recovers the targets of table dispatches, so a trace does not simply stop at
 * `JP (HL)`.
 *
 * This is the last thing keeping whole-ROM coverage low: the BASIC interpreter
 * reaches most of itself through tables, and an indirect jump has no target the
 * decoder can read off the bytes. Recursive descent therefore ends the run and
 * everything past it is reported as data.
 *
 * The risk in fixing that is worse than the problem. A detector that guesses
 * produces seeds pointing into the middle of data, and the trace then emits
 * confident nonsense — the exact failure the whole design exists to avoid. So
 * nothing here scans hopefully for things that look like addresses. Each
 * detector requires a specific, named instruction sequence, computes the targets
 * that sequence implies, and reports what it inferred and from where, so a
 * reader can discount it. Where the evidence is absent the run still stops.
 *
 * Two patterns, both taken from real code rather than from a reference:
 *
 * 1. An offset table. The dominant form in the TS2068 and Spectrum ROMs:
 *
 *        LD HL,$1293      ; table base
 *        ...              ; something advances HL by an index
 *        LD E,(HL)        ; read a one-byte offset
 *        ADD HL,DE        ; add it to the address it was read from
 *        JP (HL)
 *
 *    so the entry at `base + k` sends control to `base + k + table[k]`.
 *
 * 2. A table of jumps, three bytes to an entry. What Larken's LKDOS manual
 *    documents — "each Call is 3 bytes apart" — a run of `JP nnnn`.
 */

import { decodeOne } from './z80-disasm';
import type { Instruction } from './z80-disasm';

/** How a set of targets was arrived at, so the emitter can say so. */
export interface InferredTable {
  kind: 'offset-table' | 'jp-table';
  /** Address of the dispatch that led here, for 'offset-table'. */
  from?: number;
  /** Address of the table itself. */
  base: number;
  entries: number;
  targets: number[];
}

const MAX_OFFSET_ENTRIES = 96;
const MIN_JP_ENTRIES = 4;

/** `ADD HL,DE` / `ADD HL,BC` — the add that completes an offset dispatch. */
const ADD_HL = /^ADD HL,(DE|BC)$/;
/** `LD E,(HL)` / `LD C,(HL)` — reading the offset byte. */
const LD_FROM_HL = /^LD (E|C),\(HL\)$/;
/** `LD HL,$nnnn` — the table base. */
const LD_HL_IMM = /^LD HL,\$([0-9A-F]{4})$/;

/**
 * Find offset tables behind the indirect jumps in an already-traced body.
 *
 * `ordered` must be the decoded instructions in address order. The base is
 * looked for in the instructions leading up to the dispatch; a dispatch whose
 * base is not visible there yields nothing rather than a guess.
 */
export function findOffsetTables(
  data: Buffer | Uint8Array, origin: number, ordered: Instruction[], lookBack = 12,
): InferredTable[] {
  const out: InferredTable[] = [];
  const seen = new Set<number>();
  const end = origin + data.length;

  for (let i = 2; i < ordered.length; i++) {
    if (ordered[i].text !== 'JP (HL)') continue;
    // The two instructions before it must be the read-and-add.
    if (!ADD_HL.test(ordered[i - 1].text)) continue;
    if (!LD_FROM_HL.test(ordered[i - 2].text)) continue;

    // Walk back for the base the table was loaded from.
    let base: number | null = null;
    for (let j = i - 3; j >= 0 && j > i - 3 - lookBack; j--) {
      const m = ordered[j].text.match(LD_HL_IMM);
      if (m) { base = parseInt(m[1], 16); break; }
      // A second dispatch in between means we have walked out of this one.
      if (ordered[j].text === 'JP (HL)') break;
    }
    if (base === null || base < origin || base >= end) continue;
    if (seen.has(base)) continue;
    seen.add(base);

    // Each byte is an offset from its own address. Stop at the first entry that
    // does not land inside the image — a table has no length field, so the
    // range check is the only terminator available.
    const targets: number[] = [];
    for (let k = 0; k < MAX_OFFSET_ENTRIES; k++) {
      const at = base + k;
      if (at < origin || at >= end) break;
      const target = at + data[at - origin];
      if (target < origin || target >= end) break;
      // An offset of zero would jump to the table byte itself; treat it as the
      // end rather than as an entry.
      if (data[at - origin] === 0) break;
      targets.push(target);
    }
    if (targets.length) {
      out.push({
        kind: 'offset-table', from: ordered[i].addr, base, entries: targets.length, targets,
      });
    }
  }
  return out;
}

/**
 * Find runs of `JP nnnn` used as a dispatch table. Unlike the offset form this
 * needs no anchoring code — a stride of three `C3` bytes with in-range targets
 * is not something data falls into by accident at length.
 */
export function findJpTables(
  data: Buffer | Uint8Array, origin: number, minEntries = MIN_JP_ENTRIES,
): InferredTable[] {
  const out: InferredTable[] = [];
  const end = origin + data.length;
  let i = 0;
  while (i + 2 < data.length) {
    if (data[i] !== 0xc3) { i++; continue; }
    const targets: number[] = [];
    let j = i;
    while (j + 2 < data.length && data[j] === 0xc3) {
      const t = data[j + 1] | (data[j + 2] << 8);
      if (t < origin || t >= end) break;
      targets.push(t);
      j += 3;
    }
    if (targets.length >= minEntries) {
      out.push({ kind: 'jp-table', base: origin + i, entries: targets.length, targets });
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

/** Both detectors, deduplicated by table base. */
export function findTables(
  data: Buffer | Uint8Array, origin: number, ordered: Instruction[],
): InferredTable[] {
  const tables = [...findOffsetTables(data, origin, ordered), ...findJpTables(data, origin)];
  const byBase = new Map<number, InferredTable>();
  for (const t of tables) if (!byBase.has(t.base)) byBase.set(t.base, t);
  return [...byBase.values()].sort((a, b) => a.base - b.base);
}

/** Re-export so callers do not need z80-disasm directly for a linear probe. */
export { decodeOne };
