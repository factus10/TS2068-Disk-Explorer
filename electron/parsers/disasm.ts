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
import type { DiskFormat, FileEntry } from './types';

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
        cache.set(raw.id, { ...raw, symbols });
      } catch { /* a malformed pack must not stop the app opening a disk */ }
    }
    if (cache.size) break;
  }
  return cache;
}

/**
 * Packs for a disk, in increasing precedence. The DOS pack goes last so it
 * wins over the addresses it pages across.
 */
function packsFor(format: DiskFormat): SymbolPack[] {
  const all = loadPacks();
  const pick = (...ids: string[]) => ids.map((i) => all.get(i)).filter((p): p is SymbolPack => !!p);
  // Machine ROM first, then the DOS pack, which must win over the addresses it
  // pages across — on a Larken TS2068, $0064 is a cartridge control, not
  // whatever the HOME ROM happens to hold there.
  if (format === 'zx81-aerco') return pick('zx81', 'aerco-zx81');
  if (format === 'larken') return pick('spectrum48', 'ts2068-home', 'lkdos-2068');
  return pick('spectrum48', 'ts2068-home');
}

export interface DisassemblyResult {
  text: string;
  origin: number;
  instructions: number;
  codeBytes: number;
  dataBytes: number;
  conflicts: number;
  checksum: string;
}

export function disassemble(opts: {
  format: DiskFormat;
  entry: FileEntry;
  data: Buffer;
  listing?: BasicListing | null;
  siblings?: { entry: FileEntry; listing: BasicListing }[];
  originOverride?: number;
  source?: string;
}): DisassemblyResult | null {
  const plan = planDisassembly(opts);
  if (!plan) return null;
  const slice = opts.data.subarray(plan.range[0], plan.range[1]);
  if (!slice.length) return null;
  const result = trace(slice, plan.origin, plan.seeds, { machine: plan.machine });
  const checksum = crypto.createHash('sha256').update(slice).digest('hex');
  const text = emit(slice, result, {
    title: opts.entry.filename.trim(),
    source: opts.source,
    origin: plan.origin,
    packs: packsFor(opts.format),
    notes: plan.notes,
    checksum,
  });
  return {
    text,
    origin: plan.origin,
    instructions: result.stats.instructions,
    codeBytes: result.stats.codeBytes,
    dataBytes: result.stats.dataBytes,
    conflicts: result.conflicts.length,
    checksum,
  };
}

/** True when this file is worth offering a disassembly for. */
export function canDisassemble(format: DiskFormat, entry: FileEntry): boolean {
  if (entry.isDirectory || entry.size <= 0) return false;
  if (format === 'zx81-aerco') return true;
  return entry.type === 'code' || entry.type === 'module';
}
