/**
 * Builds the symbol packs shipped in electron/data/symbols/.
 *
 * Only address/label pairs are taken from the sources — facts, not the
 * commentary around them. Each pack records where it came from so the
 * derivation stays auditable, and regenerating is repeatable.
 *
 *   npx tsx scripts/build-symbols.ts <Sinclair-ZX81.asm> <ref-docs-dir> <original-EXROM.bin>
 */
import * as fs from 'fs';
import * as path from 'path';
import { decodeOne } from '../electron/parsers/z80-disasm';

const OUT = path.join(__dirname, '..', 'electron', 'data', 'symbols');
fs.mkdirSync(OUT, { recursive: true });

function write(pack: unknown, file: string) {
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(pack, null, 2) + '\n');
  console.log('wrote', file);
}

/** ZX81 ROM: the vault disassembly pairs a ";; NAME" line with the "Lxxxx:" after it. */
function buildZX81(asmPath: string) {
  const symbols: Record<string, { name: string }> = {};
  let pending: string | null = null;
  for (const line of fs.readFileSync(asmPath, 'latin1').split('\n')) {
    const name = line.match(/^;;\s*(\S.*?)\s*$/);
    if (name) { pending = name[1]; continue; }
    const label = line.match(/^L([0-9A-F]{4}):/);
    if (label) {
      if (pending) symbols[String(parseInt(label[1], 16))] = { name: pending };
      pending = null;
    }
  }
  write({
    id: 'zx81', name: 'ZX81 / TS1000 ROM', range: [0x0000, 0x1fff],
    provenance: 'ZXSpectrumVault/rom-disassemblies, Sinclair ZX81.asm — address/label pairs only',
    symbols,
  }, 'zx81.json');
}

/** The Aerco board and BBDOS, from the FD-ZX manual and BBDOS's on-disk help. */
function buildAercoZX81() {
  const symbols: Record<string, { name: string; note?: string }> = {
    '11000': { name: 'BBDOS-ENTER', note: 'enter BBDOS from BASIC' },
    '12000': { name: 'BBDOS-FUNC', note: 'BBDOS function; Z selects, Z$ names' },
    '13303': { name: 'SADOS-LOAD', note: 'hand over to SADOS to load' },
    '12865': { name: 'AERCO-INIT-DD', note: 'restore sysvars after a tape load, double density' },
    '12868': { name: 'AERCO-INIT-SD', note: 'restore sysvars after a tape load, single density' },
  };
  // USR (12290+page) reads a page, USR (12720+page) writes one; 20 pages on a
  // double-sided 40-track drive.
  for (let page = 1; page <= 20; page++) {
    symbols[String(12290 + page)] = { name: `AERCO-LOAD-${page}`, note: `read disc page ${page} into BASIC system RAM` };
    symbols[String(12720 + page)] = { name: `AERCO-SAVE-${page}`, note: `write BASIC system RAM onto disc page ${page}` };
  }
  write({
    id: 'aerco-zx81', name: 'Aerco / BBDOS (ZX81)', range: [0x2000, 0x3fff],
    provenance: 'AERCO Model FD-ZX Instructions; BBDOS HELP files on the disks',
    symbols,
  }, 'aerco-zx81.json');
}

/** Larken LKDOS on the TS2068 — the manual publishes the jump table outright. */
function buildLkdos2068() {
  const table: [number, string, string][] = [
    [98, 'CARTON', 'turn the cartridge on'], [100, 'CARTOFF', 'turn the cartridge off (a read does it)'],
    [120, 'SAVEBF', 'save the buffer to disk'], [123, 'LOADBF', 'load the buffer from disk'],
    [126, 'TRACK', 'restore to track 0, seek curtrk'], [129, 'NEXTRK', 'advance one track or side'],
    [132, 'INDIR', 'check the directory for prognm'], [135, 'MOVDR', 'move cell to dirwka'],
    [138, 'CMDCK', 'check command syntax'], [141, 'ENDOLN', 'move CH_ADD to end of BASIC line'],
    [144, 'EVALU', 'evaluate numeric formula'], [147, 'NOFIL', 'no-file error'],
    [150, 'WPROT', 'check for a protect sticker'], [153, 'ZERO', 'restore blocks used by cell'],
    [156, 'GTFIL', 'evaluate filename into prognm'], [159, 'ROMS', 'check for Spectrum ROM'],
    [162, 'NEWET', 'put a new entry in the directory'], [165, 'DECDM', 'print temp1 in decimal'],
    [168, 'TRANOK', 'final routine for save'], [171, 'DOSOP', 'close the disk channel'],
    [174, 'DOSERR', 'print error, HL holds the message'], [177, 'CLIRBF', 'clear buffer'],
    [180, 'ENCDBF', 'encode the buffer with addresses'], [183, 'VSERCH', 'look for arrays'],
    [186, 'GTOUT', 'exit cartridge'], [189, 'GROW', 'insert space in program'],
    [192, 'SHRINK', 'delete space in program'], [195, 'FATAL', 'catalogue data error'],
    [198, 'LSUBR', 'user load, first half'], [201, 'LDDATA', 'user load, second half'],
    [204, 'SSUBR', 'user save, first half'], [207, 'SMEM', 'user save, second half'],
  ];
  write({
    id: 'lkdos-2068', name: 'Larken LKDOS (TS2068)', range: [0x0000, 0x00ff],
    provenance: 'LKDOS Machine Language Subroutines (archive.org "larken") — published jump table',
    symbols: Object.fromEntries(table.map(([a, n, note]) => [String(a), { name: n, note }])),
  }, 'lkdos-2068.json');
}

/** The Larken ZX81 interface answers in a different window from Aerco's. */
function buildLdosZX81() {
  write({
    id: 'ldos-zx81', name: 'Larken LDOS (ZX81)', range: [0x3800, 0x3fff],
    provenance: 'Unofficial Technical Manual for the ZX-81 LDOS Disk Controller (archive.org "bill-harmer")',
    symbols: {
      '14336': { name: 'LDOS', note: 'LDOS entry from BASIC' },
      '14546': { name: 'LOADBUFFER', note: 'load buffer off disk' },
      '14778': { name: 'SETTRK', note: 'seek to the track in TRACKNO' },
      '16374': { name: 'LDOS-OUT', note: 'output entry point' },
    },
  }, 'ldos-zx81.json');
}

/**
 * TS2068 and Spectrum ROM entry points, from the curated markdown tables in the
 * reference library. Those tables document the stock ROMs. Note that a dumped
 * EPROM may be a customised variant — the TS2068 HOME image in that library
 * carries a "Superior Machine (W.J.)" signature and is not the same ROM the
 * annotated disassembly beside it describes — so packs are built from the
 * documentation rather than scraped from a particular binary.
 */
/**
 * Whether a heading introduces EXROM addresses.
 *
 * Mentioning the EXROM is not enough. "Tape Routines (HOME ROM remnants; most
 * are in EXROM)" lists HOME ROM addresses and says so, and a naive match on
 * EXROM dropped its two rows from the HOME pack and handed them to the EXROM
 * pack -- where BEEPER then took $0605, an address the EXROM tables give to
 * LD-ALL. Both are right: $0605 is BEEPER in one ROM and LD-ALL in the other,
 * which is the whole reason these are separate packs.
 */
function headingIsExrom(heading: string): boolean {
  return /EXROM/i.test(heading) && !/HOME ROM/i.test(heading);
}

function buildFromMarkdown(dir: string, file: string, id: string, name: string, range: [number, number]) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) { console.log(`skipping ${id} — ${file} not found`); return; }
  const symbols: Record<string, { name: string; note?: string; approx?: boolean }> = {};
  // "All addresses are HOME ROM addresses unless marked [EXROM]" — the EXROM is
  // a different ROM at the same addresses, so its rows must not be mixed in.
  let inExrom = false;
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) { inExrom = headingIsExrom(heading[1]); continue; }
    if (inExrom) continue;
    // | $0010   | PRINT-A-1/RST10 | Write character in A ... |
    const m = line.match(/^\|\s*(~?)\$([0-9A-Fa-f]{4})\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
    if (!m) continue;
    if (/\[EXROM\]/i.test(line)) continue;
    const addr = parseInt(m[2], 16);
    if (addr < range[0] || addr > range[1]) continue;
    const note = m[4].replace(/\*\*/g, '').trim();
    // The tables mark an address approximate with a leading ~. Carry that
    // through rather than shipping it as exact: $1B7A MAIN-4 lands inside
    // another instruction in both the stock and the modified ROM, so treating
    // these as precise would attach a confident label to the wrong address.
    symbols[String(addr)] = {
      name: m[3].trim(),
      ...(note && note.length < 80 ? { note } : {}),
      ...(m[1] ? { approx: true } : {}),
    };
  }
  if (!Object.keys(symbols).length) { console.log(`skipping ${id} — no rows matched`); return; }
  write({ id, name, range, provenance: `${file} (TS2068 Ref Library) — documented entry points`, symbols },
    `${id}.json`);
}


/**
 * System variables. These are not call targets — code reaches them as memory
 * operands, `LD A,($5C3D)`, or through IY, which the ROM keeps permanently at
 * $5C3A so that `(IY+$01)` means FLAGS. In the traced HOME ROM 216 instructions
 * name a $5Cxx address outright and another 148 go through IY, so naming them
 * changes how much of a listing can be read at a glance.
 */
function buildTs2068Sysvars(dir: string) {
  const full = path.join(dir, 'ts2068_system_variables.md');
  if (!fs.existsSync(full)) { console.log('skipping ts2068-sysvars — source not found'); return; }
  const data: Record<string, { name: string; note?: string }> = {};
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    // | NAME | default | $ADDR | $IY | size | description |
    const c = line.split('|').map((x) => x.replace(/\*\*/g, '').trim());
    if (c.length < 7) continue;
    const name = c[1], addr = c[3].match(/^\$([0-9A-Fa-f]{4})$/);
    if (!addr || !/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    const note = c[6] && c[6].length < 70 ? c[6] : undefined;
    data[String(parseInt(addr[1], 16))] = { name, ...(note ? { note } : {}) };
  }
  if (!Object.keys(data).length) { console.log('skipping ts2068-sysvars — no rows matched'); return; }
  write({
    id: 'ts2068-sysvars', name: 'TS2068 system variables', range: [0x5c00, 0x5cff],
    provenance: 'ts2068_system_variables.md (TS2068 Ref Library)',
    // IY is held at $5C3A throughout, so an (IY+d) operand names a variable too.
    indexBase: 0x5c3a,
    kind: 'data',
    symbols: {},
    data,
  }, 'ts2068-sysvars.json');
}

/**
 * ZX81 system variables. Same idea, different machine: the block runs from
 * VERSN at $4009, and the ZX81 ROM keeps IY at $4000.
 */
function buildZX81Sysvars() {
  const vars: [number, string, string][] = [
    [0x4000, 'ERR_NR', 'error code less one'],
    [0x4001, 'FLAGS', 'various BASIC flags'],
    [0x4002, 'ERR_SP', 'address of the error return'],
    [0x4004, 'RAMTOP', 'first byte above BASIC'],
    [0x4006, 'MODE', 'K, L, F or G cursor'],
    [0x4007, 'PPC', 'line number of the statement running'],
    [0x4009, 'VERSN', '0 marks the ROM version'],
    [0x400a, 'E_PPC', 'line number of the line with the cursor'],
    [0x400c, 'D_FILE', 'start of the display file'],
    [0x400e, 'DF_CC', 'address of the PRINT position'],
    [0x4010, 'VARS', 'start of the variables area'],
    [0x4012, 'DEST', 'address of the variable being assigned'],
    [0x4014, 'E_LINE', 'start of the line being edited'],
    [0x4016, 'CH_ADD', 'address of the next character to interpret'],
    [0x4018, 'X_PTR', 'address of the character an error points at'],
    [0x401a, 'STKBOT', 'start of the calculator stack'],
    [0x401c, 'STKEND', 'end of the calculator stack'],
    [0x401e, 'BERG', 'calculator working byte'],
    [0x401f, 'MEM', 'address of the calculator memory area'],
    [0x4022, 'DF_SZ', 'lines in the lower part of the screen'],
    [0x4023, 'S_TOP', 'line number at the top of the screen'],
    [0x4025, 'LAST_K', 'the last key pressed'],
    [0x4027, 'DB_ST', 'debounce status'],
    [0x4028, 'MARGIN', 'blank lines above the picture'],
    [0x4029, 'NXTLIN', 'address of the next line to run'],
    [0x402b, 'OLDPPC', 'line CONT jumps to'],
    [0x402d, 'FLAGX', 'more flags'],
    [0x402e, 'STRLEN', 'length of a string result'],
    [0x4030, 'T_ADDR', 'address in the syntax table'],
    [0x4032, 'SEED', 'RAND seed'],
    [0x4034, 'FRAMES', 'frame counter'],
    [0x4036, 'COORDS', 'x and y of the last PLOT'],
    [0x4038, 'PR_CC', 'printer buffer position'],
    [0x4039, 'S_POSN', 'print position on screen'],
    [0x403b, 'CDFLAG', 'flags, bit 7 set in compute-and-display'],
    [0x403c, 'PRBUFF', 'printer buffer'],
    [0x405d, 'MEMBOT', 'calculator memory area'],
  ];
  write({
    id: 'zx81-sysvars', name: 'ZX81 system variables', range: [0x4000, 0x407c],
    provenance: 'ZX81 system variable block, as documented in the ROM disassembly',
    indexBase: 0x4000,
    kind: 'data',
    symbols: {},
    data: Object.fromEntries(vars.map(([a, n, note]) => [String(a), { name: n, note }])),
  }, 'zx81-sysvars.json');
}

/**
 * TS2068 EXROM. The source listing names 101 routines but prints no addresses
 * against them, so the addresses are recovered rather than read off: walk the
 * listing instruction by instruction against a real ROM dump, and each label's
 * address falls out of where the walk has got to.
 *
 * That is only sound if the walk can be checked, and here it can be twice
 * over. The listing labels a further 172 locations with a bare hex address
 * where its author did not invent a name -- `002C:` rather than `XRST28:` --
 * and those are ground truth the walk must reproduce. It reproduces all 172,
 * matches 3073 of 3074 instructions, and ends at exactly $2000, the length of
 * the ROM. So no address here is trusted; every one is derived from the bytes
 * and confirmed against the document's own arithmetic.
 *
 * Which dump matters. Against `2068Exrom.BIN` the walk agrees on the 109
 * anchors below $0A52 and disagrees on all 63 above it -- that image is the
 * community revision, whose changes `exrom_revision_analysis.md` records as
 * starting at $0A52. TS2068_U20.BIN is the original, and is the one to use.
 */
const EXROM_REGS = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'AF', "AF'", 'BC', 'DE',
  'HL', 'SP', 'IX', 'IY', 'IXH', 'IXL', 'IYH', 'IYL', 'NZ', 'Z', 'NC', 'PO', 'PE', 'P', 'M',
  '(HL)', '(BC)', '(DE)', '(C)', '(SP)']);

/**
 * Reduce an instruction to its shape, so the listing's symbolic operands can
 * be compared with the dump's numeric ones: registers survive, addresses and
 * expressions become a wildcard. `LD HL,(CHADD)` and `LD HL,($5C5D)` both
 * become `LD HL,(*)`.
 */
function exromShape(text: string): string {
  const t = text.trim().toUpperCase().replace(/\s+/g, ' ');
  const sp = t.indexOf(' ');
  if (sp < 0) return t;
  const mnem = t.slice(0, sp);
  const ops = t.slice(sp + 1).split(',').map((o) => {
    const x = o.trim();
    if (EXROM_REGS.has(x)) return x;
    if (/^\(I[XY][+-].*\)$/.test(x)) return x.replace(/[+-].*\)/, '+*)');
    // A jump or call to a parenthesised expression is still an absolute
    // target; only (HL)/(IX)/(IY) are genuinely indirect.
    if (/^\(.*\)$/.test(x)) return /^(CALL|JP|JR|DJNZ)$/.test(mnem) ? '*' : '(*)';
    return '*';
  });
  return `${mnem} ${ops.join(',')}`;
}

/** Drop an end-of-line comment, without mistaking the tick in AF' for a quote. */
function exromStrip(line: string): string {
  let out = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && /^'[^']*'/.test(line.slice(i))) quoted = !quoted;
    if (ch === ';' && !quoted) break;
    out += ch;
  }
  return out;
}

/** Bytes a DEFB/DEFW operand list occupies; a quoted run counts its characters. */
function exromItems(list: string): number {
  let n = 0, depth = 0, cur = '';
  const push = () => {
    const v = cur.trim();
    if (v) n += /^'.*'$/.test(v) ? v.length - 2 : 1;
    cur = '';
  };
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { push(); continue; }
    cur += ch;
  }
  push();
  return n;
}

function buildTs2068Exrom(dir: string, romPath: string | undefined) {
  const full = path.join(dir, 'Timex Sinclair 2068 EXROM.txt');
  if (!fs.existsSync(full)) { console.log('skipping ts2068-exrom — listing not found'); return; }
  if (!romPath || !fs.existsSync(romPath)) {
    console.log('skipping ts2068-exrom — pass the original EXROM dump as the 4th argument');
    return;
  }
  const rom = fs.readFileSync(romPath);
  // The revision changed the NMI branch at $110E from JR NZ to JR Z. The
  // listing describes the original, so refuse the revised image rather than
  // silently emitting addresses that drift past $0A52.
  if (rom.length !== 0x2000 || rom[0x110e] !== 0x20) {
    console.log('skipping ts2068-exrom — that dump is not the original EXROM'
      + ` (expected 8192 bytes with $20 at $110E, got ${rom.length} bytes with `
      + `$${rom[0x110e]?.toString(16).toUpperCase()})`);
    return;
  }

  const labels: { name: string; addr: number }[] = [];
  const anchors: { stated: number; pc: number }[] = [];
  let pc = 0, matched = 0, mismatched = 0;

  for (const line of fs.readFileSync(full, 'latin1').split('\n')) {
    const raw = exromStrip(line);
    if (!raw.trim()) continue;
    let rest = raw;
    const anchor = raw.match(/^([0-9A-Fa-f]{4}):/);
    if (anchor) { anchors.push({ stated: parseInt(anchor[1], 16), pc }); rest = raw.slice(anchor[0].length); }
    const label = anchor ? null : raw.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (label) { labels.push({ name: label[1], addr: pc }); rest = raw.slice(label[0].length); }
    const body = rest.trim();
    if (!body) continue;
    const kw = body.split(/\s+/)[0].toUpperCase();
    if (kw === 'DEFC' || kw === 'DEFINE' || kw === 'INCLUDE') continue;
    if (kw === 'ORG') {
      pc = Number(body.split(/\s+/)[1].replace('$', '0x'));
      if (label) labels[labels.length - 1].addr = pc;
      continue;
    }
    if (kw === 'DEFB') { pc += exromItems(body.slice(4)); continue; }
    if (kw === 'DEFW') { pc += 2 * exromItems(body.slice(4)); continue; }
    if (pc >= rom.length) break;
    const insn = decodeOne(rom, pc, 0);
    if (exromShape(body) === exromShape(insn.text)) matched++;
    else mismatched++;
    pc += insn.length;
  }

  const off = anchors.filter((a) => a.stated !== a.pc);
  console.log(`  ts2068-exrom: ${matched} instructions matched, ${mismatched} not; `
    + `${anchors.length} address anchors, ${off.length} disagreeing; ends at $${pc.toString(16).toUpperCase()}`);
  // The anchors are the check. If any disagrees the walk has desynchronised
  // and every address after it is wrong, so emit nothing at all.
  if (off.length) { console.log('skipping ts2068-exrom — the walk did not reproduce the stated addresses'); return; }
  if (pc !== rom.length) { console.log(`skipping ts2068-exrom — walk ended at $${pc.toString(16)}, not the end of the ROM`); return; }

  const symbols: Record<string, { name: string; note?: string; approx?: boolean }> = {};
  for (const l of labels) symbols[String(l.addr)] = { name: l.name };

  // The entry-point markdown documents a handful of EXROM routines the listing
  // leaves unnamed -- $1000 and $1100 carry no label in the source. Where both
  // name an address they agree ($0DB0 OPDFIL / OPEN-DFILE, $0E27 CLDFIL /
  // CLOSE-DFILE), so the derived name keeps the slot and these only fill gaps.
  let added = 0, agreed = 0;
  const md = path.join(dir, 'ts2068_rom_entry_points.md');
  if (fs.existsSync(md)) {
    let inExrom = false;
    for (const line of fs.readFileSync(md, 'utf8').split('\n')) {
      const heading = line.match(/^#{1,4}\s+(.*)$/);
      if (heading) { inExrom = headingIsExrom(heading[1]); continue; }
      if (!inExrom) continue;
      const m = line.match(/^\|\s*(~?)\$([0-9A-Fa-f]{4})\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
      if (!m) continue;
      const addr = parseInt(m[2], 16);
      if (addr > 0x1fff) continue;
      if (symbols[String(addr)]) { agreed++; continue; }
      const note = m[4].replace(/\*\*/g, '').trim();
      symbols[String(addr)] = {
        name: m[3].trim(),
        ...(note && note.length < 80 ? { note } : {}),
        ...(m[1] ? { approx: true } : {}),
      };
      added++;
    }
  }
  console.log(`  ts2068-exrom: ${labels.length} derived from the listing, ${added} added from the `
    + `entry-point tables, ${agreed} addresses named by both`);

  write({
    id: 'ts2068-exrom',
    name: 'TS2068 EXROM',
    range: [0x0000, 0x1fff],
    provenance: 'Timex Sinclair 2068 EXROM.txt (TS2068 Ref Library) — labels placed by '
      + `walking the listing against ${path.basename(romPath)}, confirmed at all ${anchors.length} `
      + 'stated addresses; gaps filled from ts2068_rom_entry_points.md',
    symbols,
  }, 'ts2068-exrom.json');
}

const zx81Asm = process.argv[2];
if (zx81Asm && fs.existsSync(zx81Asm)) buildZX81(zx81Asm);
else console.log('skipping zx81.json — pass the path to Sinclair-ZX81.asm to build it');
buildAercoZX81();
buildLkdos2068();
buildLdosZX81();
buildZX81Sysvars();

const refDocs = process.argv[3];
if (refDocs) {
  buildFromMarkdown(refDocs, 'ts2068_rom_entry_points.md', 'ts2068-home', 'TS2068 HOME ROM', [0x0000, 0x3fff]);
  buildFromMarkdown(refDocs, 'spectrum48_rom_entry_points.md', 'spectrum48', 'ZX Spectrum 48K ROM', [0x0000, 0x3fff]);
  buildTs2068Sysvars(refDocs);
  buildTs2068Exrom(refDocs, process.argv[4]);
} else {
  console.log('skipping ROM entry-point packs — pass the reference docs directory as the 2nd argument');
}
