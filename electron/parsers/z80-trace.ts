/**
 * Recursive-descent tracer: works out which bytes are instructions.
 *
 * This is the part that decides whether a disassembly is worth reading. A
 * linear sweep desynchronises the first time it meets a jump table or a string,
 * and then emits confident nonsense for everything after it — worse than no
 * disassembly at all in something meant for archiving. Following the flow of
 * control from known entry points instead means anything never reached is, by
 * construction, data.
 *
 * The awkward part on these machines is that some restarts take their argument
 * from the instruction stream rather than from a register, so the bytes
 * immediately after the `RST` are data even though execution ran straight
 * through them. Both conventions are used constantly in ROM and in hand-written
 * code, and a tracer that misses them desynchronises on the very first one:
 *
 *   RST $08   error restart, followed by one error-code byte, and it does not
 *             return — control passes to the error handler
 *   RST $28   floating-point calculator, followed by a stream of calculator
 *             literals terminated by end-calc, and it does return
 *
 * end-calc is $34 on the ZX81 and $38 on the Spectrum and TS2068, which is why
 * these live in a per-machine table rather than being hardcoded.
 */

import { decodeOne } from './z80-disasm';
import type { Instruction } from './z80-disasm';

export interface RstConvention {
  /** A fixed number of inline bytes following the RST. */
  bytes?: number;
  /** Or: consume inline bytes up to and including this terminator. */
  until?: number;
  /** Whether control resumes after the inline data. */
  returns: boolean;
  note: string;
}

export interface Machine {
  id: string;
  name: string;
  /** Inline-data conventions, keyed by restart address. */
  rst: Record<number, RstConvention>;
  /** Render a byte as a character for text-run detection, or null. */
  printable(b: number): string | null;
}

const asciiPrintable = (b: number) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : null);

/** ZX81 / TS1000. Its calculator stream ends with $34. */
export const ZX81: Machine = {
  id: 'zx81',
  name: 'ZX81 / TS1000',
  rst: {
    0x08: { bytes: 1, returns: false, note: 'error code' },
    0x28: { until: 0x34, returns: true, note: 'calculator literals, end-calc $34' },
  },
  // The ZX81 character set is its own thing; letters live at $26-$3F and
  // digits at $1C-$25. Only those and space read as text.
  printable(b) {
    if (b === 0x00) return ' ';
    if (b >= 0x1c && b <= 0x25) return String.fromCharCode(48 + b - 0x1c);
    if (b >= 0x26 && b <= 0x3f) return String.fromCharCode(65 + b - 0x26);
    return null;
  },
};

/** ZX Spectrum and TS2068. Its calculator stream ends with $38. */
export const SPECTRUM: Machine = {
  id: 'spectrum',
  name: 'ZX Spectrum / TS2068',
  rst: {
    0x08: { bytes: 1, returns: false, note: 'error code' },
    0x28: { until: 0x38, returns: true, note: 'calculator literals, end-calc $38' },
  },
  printable: asciiPrintable,
};

export interface DataRun {
  start: number;
  end: number;          // exclusive
  kind: 'text' | 'bytes';
  text?: string;
}

export interface InlineRun {
  /** Offset of the first inline byte. */
  start: number;
  length: number;
  /** Address of the RST that introduced it. */
  from: number;
  note: string;
}

export interface TraceResult {
  /** Decoded instructions, keyed by buffer offset. */
  code: Map<number, Instruction>;
  /** Branch targets inside the buffer, as address → label. */
  labels: Map<number, string>;
  /** Targets outside the buffer — ROM and DOS calls — with their call sites. */
  external: Map<number, number[]>;
  /** Inline data consumed after a restart. */
  inline: InlineRun[];
  /** Spans never reached by the trace. */
  data: DataRun[];
  /** Seeds actually used, and any that fell outside the buffer. */
  seeds: number[];
  seedsOutside: number[];
  stats: {
    codeBytes: number;
    inlineBytes: number;
    dataBytes: number;
    instructions: number;
    undocumented: number;
    invalid: number;
  };
}

export interface TraceOptions {
  machine?: Machine;
  /** Minimum run of printable bytes before a data span is called text. */
  minTextRun?: number;
}

/**
 * Trace from `seeds` (absolute addresses) over a buffer loaded at `origin`.
 */
export function trace(
  data: Buffer | Uint8Array,
  origin: number,
  seeds: number[],
  options: TraceOptions = {},
): TraceResult {
  const machine = options.machine ?? SPECTRUM;
  const minTextRun = options.minTextRun ?? 4;
  const end = data.length;

  const code = new Map<number, Instruction>();
  const labels = new Map<number, string>();
  const external = new Map<number, number[]>();
  const inline: InlineRun[] = [];
  const covered = new Uint8Array(end);   // every byte accounted for as code or inline
  const used: number[] = [];
  const outside: number[] = [];

  const inRange = (addr: number) => addr >= origin && addr < origin + end;
  const queue: number[] = [];

  const enqueue = (addr: number) => {
    if (!inRange(addr)) return;
    const off = addr - origin;
    if (!code.has(off)) queue.push(off);
  };

  for (const s of seeds) {
    if (inRange(s)) { used.push(s); queue.push(s - origin); }
    else outside.push(s);
  }

  while (queue.length) {
    let off = queue.pop()!;
    // Walk straight-line code until something ends the run.
    for (;;) {
      if (off < 0 || off >= end || code.has(off)) break;

      const insn = decodeOne(data, off, origin);
      code.set(off, insn);
      for (let i = 0; i < insn.length && off + i < end; i++) covered[off + i] = 1;
      let next = off + insn.length;

      // A restart that takes its argument inline: the following bytes are data,
      // and for the error restart control does not come back at all.
      const rst = insn.text.startsWith('RST ') && insn.target !== undefined
        ? machine.rst[insn.target]
        : undefined;
      if (rst) {
        const from = next;
        let len = 0;
        if (rst.bytes !== undefined) {
          len = rst.bytes;
        } else if (rst.until !== undefined) {
          while (from + len < end && data[from + len] !== rst.until) len++;
          if (from + len < end) len++;    // include the terminator
        }
        len = Math.min(len, end - from);
        if (len > 0) {
          inline.push({ start: from, length: len, from: insn.addr, note: rst.note });
          for (let i = 0; i < len; i++) covered[from + i] = 1;
        }
        next = from + len;
        if (!rst.returns) break;          // error restart: run ends here
        off = next;
        continue;
      }

      if (insn.target !== undefined) {
        if (inRange(insn.target)) {
          if (!labels.has(insn.target)) {
            labels.set(insn.target, `L_${insn.target.toString(16).toUpperCase().padStart(4, '0')}`);
          }
          enqueue(insn.target);
        } else {
          const sites = external.get(insn.target) ?? [];
          sites.push(insn.addr);
          external.set(insn.target, sites);
        }
      }

      if (insn.invalid) break;            // do not trust anything after a bad opcode
      // A conditional branch and a call both fall through as well as branching,
      // so only an unconditional transfer ends the run.
      if (insn.flow === 'jump' || insn.flow === 'ret') break;
      off = next;
    }
  }

  return {
    code, labels, external, inline,
    data: findDataRuns(data, covered, machine, minTextRun),
    seeds: used,
    seedsOutside: outside,
    stats: summarise(code, inline, covered, end),
  };
}

/** Everything the trace never reached, split into text and raw spans. */
function findDataRuns(
  data: Buffer | Uint8Array, covered: Uint8Array, machine: Machine, minTextRun: number,
): DataRun[] {
  const runs: DataRun[] = [];
  let i = 0;
  while (i < data.length) {
    if (covered[i]) { i++; continue; }
    const start = i;
    while (i < data.length && !covered[i]) i++;
    runs.push(...splitSpan(data, start, i, machine, minTextRun));
  }
  return runs;
}

/**
 * Cut one unreached span into text and raw parts, so a string table inside it
 * reads as strings rather than as a wall of bytes.
 */
function splitSpan(
  data: Buffer | Uint8Array, start: number, end: number, machine: Machine, minTextRun: number,
): DataRun[] {
  const runs: DataRun[] = [];
  let pos = start;
  let rawFrom = start;
  while (pos < end) {
    let k = pos;
    while (k < end && machine.printable(data[k]) !== null) k++;
    if (k - pos >= minTextRun) {
      if (pos > rawFrom) runs.push({ start: rawFrom, end: pos, kind: 'bytes' });
      let text = '';
      for (let t = pos; t < k; t++) text += machine.printable(data[t]);
      runs.push({ start: pos, end: k, kind: 'text', text });
      pos = k;
      rawFrom = k;
    } else {
      pos = k > pos ? k : pos + 1;
    }
  }
  if (rawFrom < end) runs.push({ start: rawFrom, end, kind: 'bytes' });
  return runs;
}

function summarise(
  code: Map<number, Instruction>, inline: InlineRun[], covered: Uint8Array, end: number,
) {
  let codeBytes = 0, undocumented = 0, invalid = 0;
  for (const insn of code.values()) {
    codeBytes += insn.length;
    if (insn.undocumented) undocumented++;
    if (insn.invalid) invalid++;
  }
  const inlineBytes = inline.reduce((n, r) => n + r.length, 0);
  let dataBytes = 0;
  for (let i = 0; i < end; i++) if (!covered[i]) dataBytes++;
  return { codeBytes, inlineBytes, dataBytes, instructions: code.size, undocumented, invalid };
}
