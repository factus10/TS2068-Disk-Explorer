/**
 * Builds the symbol packs shipped in electron/data/symbols/.
 *
 * Only address/label pairs are taken from the sources — facts, not the
 * commentary around them. Each pack records where it came from so the
 * derivation stays auditable, and regenerating is repeatable.
 *
 *   npx tsx scripts/build-symbols.ts <path-to-Sinclair-ZX81.asm>
 */
import * as fs from 'fs';
import * as path from 'path';

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
function buildFromMarkdown(dir: string, file: string, id: string, name: string, range: [number, number]) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) { console.log(`skipping ${id} — ${file} not found`); return; }
  const symbols: Record<string, { name: string; note?: string }> = {};
  // "All addresses are HOME ROM addresses unless marked [EXROM]" — the EXROM is
  // a different ROM at the same addresses, so its rows must not be mixed in.
  let inExrom = false;
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) { inExrom = /EXROM/i.test(heading[1]); continue; }
    if (inExrom) continue;
    // | $0010   | PRINT-A-1/RST10 | Write character in A ... |
    const m = line.match(/^\|\s*~?\$([0-9A-Fa-f]{4})\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
    if (!m) continue;
    if (/\[EXROM\]/i.test(line)) continue;
    const addr = parseInt(m[1], 16);
    if (addr < range[0] || addr > range[1]) continue;
    const note = m[3].replace(/\*\*/g, '').trim();
    symbols[String(addr)] = { name: m[2].trim(), ...(note && note.length < 80 ? { note } : {}) };
  }
  if (!Object.keys(symbols).length) { console.log(`skipping ${id} — no rows matched`); return; }
  write({ id, name, range, provenance: `${file} (TS2068 Ref Library) — documented entry points`, symbols },
    `${id}.json`);
}

const zx81Asm = process.argv[2];
if (zx81Asm && fs.existsSync(zx81Asm)) buildZX81(zx81Asm);
else console.log('skipping zx81.json — pass the path to Sinclair-ZX81.asm to build it');
buildAercoZX81();
buildLkdos2068();
buildLdosZX81();

const refDocs = process.argv[3];
if (refDocs) {
  buildFromMarkdown(refDocs, 'ts2068_rom_entry_points.md', 'ts2068-home', 'TS2068 HOME ROM', [0x0000, 0x3fff]);
  buildFromMarkdown(refDocs, 'spectrum48_rom_entry_points.md', 'spectrum48', 'ZX Spectrum 48K ROM', [0x0000, 0x3fff]);
} else {
  console.log('skipping ROM entry-point packs — pass the reference docs directory as the 2nd argument');
}
