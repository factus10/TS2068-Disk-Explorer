/**
 * Ties the disassembler together for the app: pick the packs for a disk,
 * plan the entry points, trace, and emit.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { planDisassembly } from './disasm-entry-points';
import { trace } from './z80-trace';
import { emit } from './disasm-emit';
import type { SymbolPack } from './disasm-emit';
import type { BasicListing } from './basic-detokenizer';
import type { DiskFormat, FileEntry, DisasmSettings } from './types';

/** Packs are loaded once; they are static data. */
let cache: Map<string, SymbolPack> | null = null;

function loadPacks(): Map<string, SymbolPack> {
  if (cache) return cache;
  cache = new Map();
  // Packaged builds put the JSON next to the compiled main process.
  const roots = [
    path.join(__dirname, 'data', 'symbols'),
    path.join(__dirname, '..', 'electron', 'data', 'symbols'),
    path.join(__dirname, '..', '..', 'electron', 'data', 'symbols'),
  ];
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const symbols: SymbolPack['symbols'] = {};
        for (const [addr, v] of Object.entries(raw.symbols ?? {})) {
          symbols[Number(addr)] = v as { name: string; note?: string };
        }
        const data: NonNullable<SymbolPack['data']> = {};
        for (const [addr, v] of Object.entries(raw.data ?? {})) {
          data[Number(addr)] = v as { name: string; note?: string };
        }
        cache.set(raw.id, { ...raw, symbols, ...(Object.keys(data).length ? { data } : {}) });
      } catch { /* a malformed pack must not stop the app opening a disk */ }
    }
    if (cache.size) break;
  }
  return cache;
}

/**
 * Packs for a disk, in increasing precedence. The DOS pack goes last so it
 * wins over the addresses it pages across.
 *
 * The EXROM is a second 8K ROM at the same addresses as the HOME ROM, so its
 * pack can never be merged with the machine's — $0038 is MASK-INT in one and
 * XRST38 in the other, and $0605 is BEEPER in one and LD-ALL in the other.
 * Nothing in a file off a disk records which was paged in when it ran, so this
 * stays off unless a reader asks for it, and the header says when it is on.
 */
function packsFor(format: DiskFormat, exrom = false): SymbolPack[] {
  const all = loadPacks();
  const pick = (...ids: string[]) => ids.map((i) => all.get(i)).filter((p): p is SymbolPack => !!p);
  // Machine ROM first, then the DOS pack, which must win over the addresses it
  // pages across — on a Larken TS2068, $0064 is a cartridge control, not
  // whatever the HOME ROM happens to hold there.
  if (format === 'zx81-aerco') return pick('zx81', 'zx81-sysvars', 'aerco-zx81');
  // The EXROM overlay replaces the machine ROM rather than sitting under it:
  // where it has a name, that name is the whole truth about the address.
  const machine = exrom ? ['spectrum48', 'ts2068-home', 'ts2068-exrom'] : ['spectrum48', 'ts2068-home'];
  if (format === 'larken') return pick(...machine, 'ts2068-sysvars', 'lkdos-2068');
  return pick(...machine, 'ts2068-sysvars');
}

export interface DisassemblyResult {
  text: string;
  origin: number;
  instructions: number;
  codeBytes: number;
  dataBytes: number;
  conflicts: number;
  /** SHA-256 of the exact bytes disassembled — not of the whole file. */
  checksum: string;
  /** Everything needed to reproduce this run, for the .dis.json sidecar. */
  sidecar: {
    file: string;
    source?: string;
    machine: string;
    origin: number;
    /** Byte range of the file that was disassembled. */
    range: [number, number];
    length: number;
    sha256: string;
    seeds: string[];
    /** Dispatch tables whose targets were inferred and traced. */
    tables: { kind: string; base: string; entries: number; from?: string }[];
    external: string[];
    symbolPacks: { id: string; name: string; provenance?: string; symbols: number }[];
    notes: string[];
    stats: { instructions: number; codeBytes: number; inlineBytes: number; dataBytes: number; conflicts: number };
  };
}

export function disassemble(opts: {
  format: DiskFormat;
  entry: FileEntry;
  data: Buffer;
  listing?: BasicListing | null;
  siblings?: { entry: FileEntry; listing: BasicListing }[];
  originOverride?: number;
  source?: string;
  /** Resolve $0000-$1FFF against the EXROM instead of the HOME ROM. */
  exrom?: boolean;
}): DisassemblyResult | null {
  const plan = planDisassembly(opts);
  if (!plan) return null;
  const slice = opts.data.subarray(plan.range[0], plan.range[1]);
  if (!slice.length) return null;
  // Table detection costs one extra scan when nothing is found. It earns that
  // on ROM images, where the interpreter reaches most of itself through tables,
  // and on a handful of disk programs — four of the 397 traced across the
  // sample disks reach code that way and would otherwise stop at `JP (HL)`.
  const result = trace(slice, plan.origin, plan.seeds, { machine: plan.machine, detectTables: true });
  const checksum = crypto.createHash('sha256').update(slice).digest('hex');
  const packs = packsFor(opts.format, opts.exrom);
  const text = emit(slice, result, {
    title: opts.entry.filename.trim(),
    source: opts.source,
    origin: plan.origin,
    packs,
    notes: plan.notes,
    checksum,
  });
  const hex = (n: number) => '$' + n.toString(16).toUpperCase().padStart(4, '0');
  return {
    text,
    origin: plan.origin,
    instructions: result.stats.instructions,
    codeBytes: result.stats.codeBytes,
    dataBytes: result.stats.dataBytes,
    conflicts: result.conflicts.length,
    checksum,
    sidecar: {
      file: opts.entry.filename.trim(),
      ...(opts.source ? { source: opts.source } : {}),
      machine: plan.machine.id,
      origin: plan.origin,
      range: plan.range,
      length: slice.length,
      sha256: checksum,
      seeds: result.seeds.map(hex),
      tables: result.tables.map((t) => ({
        kind: t.kind, base: hex(t.base), entries: t.entries,
        ...(t.from !== undefined ? { from: hex(t.from) } : {}),
      })),
      external: [...result.external.keys()].sort((a, b) => a - b).map(hex),
      symbolPacks: packs.map((p) => ({
        id: p.id, name: p.name, ...(p.provenance ? { provenance: p.provenance } : {}),
        symbols: Object.keys(p.symbols).length,
      })),
      notes: plan.notes,
      stats: {
        instructions: result.stats.instructions,
        codeBytes: result.stats.codeBytes,
        inlineBytes: result.stats.inlineBytes,
        dataBytes: result.stats.dataBytes,
        conflicts: result.conflicts.length,
      },
    },
  };
}

/**
 * The `.dis` for one file during an extraction, or null if it cannot be traced.
 *
 * Lives here rather than in the Electron main process so that the settings
 * actually reaching the disassembler can be tested. They did not, once: the
 * viewer grew an origin override and an EXROM toggle and the export kept
 * calling with neither, so an extraction wrote a listing built from the
 * detected origin while recording it as provenance.
 */
export function disassembleForExport(opts: {
  format: DiskFormat;
  entry: FileEntry;
  data: Buffer;
  loaders: { entry: FileEntry; listing: BasicListing }[];
  source: string;
  settings?: DisasmSettings;
}): DisassemblyResult | null {
  const { format, entry, data, loaders, source, settings } = opts;
  if (!canDisassemble(format, entry)) return null;
  try {
    return disassemble({
      format, entry, data, siblings: loaders, source,
      listing: loaders.find((l) => l.entry.index === entry.index)?.listing ?? null,
      originOverride: settings?.origin,
      exrom: settings?.exrom,
    });
  } catch {
    return null;   // a file that will not trace must not stop the extraction
  }
}

/** True when this file is worth offering a disassembly for. */
export function canDisassemble(format: DiskFormat, entry: FileEntry): boolean {
  if (entry.isDirectory || entry.size <= 0) return false;
  if (format === 'zx81-aerco') return true;
  return entry.type === 'code' || entry.type === 'module';
}
