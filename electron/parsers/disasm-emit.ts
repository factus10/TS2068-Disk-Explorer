/**
 * Renders a trace as the `.dis` text.
 *
 * The output is the archival artifact, so it has to be reproducible: the same
 * input bytes and the same symbol packs must always produce an identical file.
 * Nothing here reads the clock, the filesystem or a path — anything varying
 * belongs in the `.dis.json` sidecar the caller writes alongside it.
 *
 * What the reader gets, per line: address, raw bytes, mnemonic, and — where a
 * symbol pack knows the target — the routine being called. That last column is
 * the whole point. `CALL $0B6B` says nothing; `CALL $0B6B ; PR-STR-4` says the
 * program is printing a string.
 */

import type { Instruction } from './z80-disasm';
import type { TraceResult, DataRun, InlineRun } from './z80-trace';

export interface SymbolPack {
  id: string;
  name: string;
  /** Where this pack's addresses are valid; later packs win inside their range. */
  range?: [number, number];
  provenance?: string;
  /**
   * Address → short label. `approx` marks an address the source itself gave
   * only approximately; it is rendered with a `?` so a reader is never handed
   * false precision.
   */
  symbols: Record<number, { name: string; note?: string; approx?: boolean }>;
}

export interface EmitOptions {
  /** Name shown in the header — the file this came off the disk as. */
  title: string;
  /** Disk image the file came from. */
  source?: string;
  origin: number;
  /**
   * Packs in increasing precedence. A DOS pack must come after the machine
   * pack so it wins over the addresses it pages across — on a Larken TS2068,
   * $0064 is a cartridge control, not whatever the HOME ROM has there.
   */
  packs?: SymbolPack[];
  /** Notes from the entry-point plan, recorded in the header. */
  notes?: string[];
  /** SHA-256 of the disassembled bytes, so a narrative can be bound to them. */
  checksum?: string;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** Resolve an address against the packs, last match winning. */
export function resolve(
  addr: number, packs: SymbolPack[],
): { name: string; note?: string; pack: string; approx?: boolean } | null {
  let hit: { name: string; note?: string; pack: string; approx?: boolean } | null = null;
  for (const p of packs) {
    if (p.range && (addr < p.range[0] || addr > p.range[1])) continue;
    const s = p.symbols[addr];
    if (s) hit = { name: s.name, note: s.note, pack: p.id, approx: s.approx };
  }
  return hit;
}

/** How a resolved symbol reads in the output. */
function label(sym: { name: string; note?: string; approx?: boolean }): string {
  return `${sym.name}${sym.approx ? '?' : ''}${sym.note ? ` — ${sym.note}` : ''}`;
}

export function emit(
  data: Buffer | Uint8Array, result: TraceResult, options: EmitOptions,
): string {
  const { origin, packs = [] } = options;
  const out: string[] = [];
  const s = result.stats;

  out.push(`; ${options.title}`);
  if (options.source) out.push(`; from ${options.source}`);
  out.push(`; origin $${hex4(origin)}, ${data.length} bytes`);
  if (options.checksum) out.push(`; sha256 ${options.checksum}`);
  out.push(';');
  out.push(`; ${s.instructions} instructions, ${s.codeBytes} bytes code, `
    + `${s.inlineBytes} inline, ${s.dataBytes} data`);
  if (s.undocumented) out.push(`; ${s.undocumented} undocumented instruction(s)`);
  if (s.invalid) out.push(`; ${s.invalid} invalid opcode(s)`);
  if (result.conflicts.length) {
    out.push(`; ${result.conflicts.length} conflict(s): a branch landed inside another`);
    out.push('; instruction, so at least one path is walking data — treat with care');
  }
  out.push(`; traced from ${result.seeds.length} entry point(s): `
    + result.seeds.map((a) => `$${hex4(a)}`).join(' '));
  for (const n of options.notes ?? []) out.push(`; ${n}`);
  if (packs.length) {
    out.push(';');
    for (const p of packs) out.push(`; symbols: ${p.name}${p.provenance ? ` — ${p.provenance}` : ''}`);
    if (packs.some((p) => Object.values(p.symbols).some((s) => s.approx))) {
      out.push('; a name ending in ? is an address the source gave only approximately');
    }
  }
  out.push(';');

  // External calls up front: on these disks that list alone often says what a
  // program does, before a single instruction has been read.
  if (result.external.size) {
    out.push('; calls out of this file:');
    const rows = [...result.external.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [addr, sites] of rows) {
      const sym = resolve(addr, packs);
      out.push(`;   $${hex4(addr)}  ${String(sites.length).padStart(3)}×  ${sym ? label(sym) : '(unknown)'}`);
    }
    out.push(';');
  }

  out.push(`\tORG $${hex4(origin)}`);
  out.push('');

  // Walk the buffer in address order, so code, inline data and raw data
  // interleave exactly as they sit in the file.
  const inlineAt = new Map<number, InlineRun>();
  for (const r of result.inline) inlineAt.set(r.start, r);
  const dataAt = new Map<number, DataRun>();
  for (const r of result.data) dataAt.set(r.start, r);

  let off = 0;
  while (off < data.length) {
    const insn = result.code.get(off);
    if (insn) {
      out.push(renderInstruction(insn, result, packs));
      off += insn.length;
      continue;
    }
    const inl = inlineAt.get(off);
    if (inl) {
      out.push(renderBytes(data, inl.start, inl.start + inl.length, origin, `inline: ${inl.note}`));
      off += inl.length;
      continue;
    }
    const run = dataAt.get(off);
    if (run) {
      out.push(...renderData(data, run, origin));
      off = run.end;
      continue;
    }
    // Not reached by anything and not in a run — emit a single byte so the
    // output always accounts for every byte of the input.
    out.push(renderBytes(data, off, off + 1, origin));
    off += 1;
  }
  return out.join('\n') + '\n';
}

function renderInstruction(
  insn: Instruction, result: TraceResult, packs: SymbolPack[],
): string {
  const lineLabel = result.labels.get(insn.addr);
  const raw = insn.bytes.map(hex2).join(' ').padEnd(11);
  let comment = '';
  if (insn.target !== undefined) {
    const sym = resolve(insn.target, packs);
    if (sym) comment = ` ; ${label(sym)}`;
    else if (result.labels.has(insn.target)) comment = '';
  }
  if (insn.undocumented) comment += comment ? ' [undocumented]' : ' ; undocumented';
  if (insn.invalid) comment += ' [invalid opcode]';
  const body = `\t${insn.text}`.padEnd(28);
  const line = `$${hex4(insn.addr)}  ${raw}${body}${comment}`;
  return lineLabel ? `\n${lineLabel}:\n${line}` : line;
}

function renderData(data: Buffer | Uint8Array, run: DataRun, origin: number): string[] {
  if (run.kind === 'text' && run.text) {
    return [`$${hex4(origin + run.start)}  ${' '.repeat(11)}\tDEFM ${JSON.stringify(run.text)}`];
  }
  const lines: string[] = [];
  for (let i = run.start; i < run.end; i += 8) {
    lines.push(renderBytes(data, i, Math.min(i + 8, run.end), origin));
  }
  return lines;
}

function renderBytes(
  data: Buffer | Uint8Array, start: number, end: number, origin: number, note?: string,
): string {
  const bytes: string[] = [];
  for (let i = start; i < end; i++) bytes.push('$' + hex2(data[i]));
  const raw = ''.padEnd(11);
  return `$${hex4(origin + start)}  ${raw}\tDEFB ${bytes.join(',')}`.padEnd(52)
    + (note ? ` ; ${note}` : '');
}
