import * as fs from 'fs';
import { decodeOne } from '../electron/parsers/z80-disasm';

const L = '/Users/david/Documents/Projects/TS2068 Ref Library';
const rom = fs.readFileSync(`${L}/2068 ROMS/TS2068_U20.BIN`);
const src = fs.readFileSync(`${L}/docs/Timex Sinclair 2068 EXROM.txt`, 'latin1').split('\n');

const REG = new Set(['A','B','C','D','E','H','L','I','R','AF',"AF'",'BC','DE','HL','SP','IX','IY',
  'IXH','IXL','IYH','IYL','NZ','Z','NC','PO','PE','P','M','(HL)','(BC)','(DE)','(C)','(SP)']);

/** Reduce an operand list to its shape: registers kept, anything else a wildcard. */
function norm(text: string): string {
  const t = text.trim().toUpperCase().replace(/\s+/g, ' ');
  const sp = t.indexOf(' ');
  if (sp < 0) return t;
  const mnem = t.slice(0, sp);
  const ops = t.slice(sp + 1).split(',').map((o) => {
    const s = o.trim();
    if (REG.has(s)) return s;
    if (/^\(I[XY][+-].*\)$/.test(s)) return s.replace(/[+-].*\)/, '+*)');
    if (/^\(.*\)$/.test(s)) return /^(CALL|JP|JR|DJNZ)$/.test(mnem) ? '*' : '(*)';
    return '*';
  });
  return `${mnem} ${ops.join(',')}`;
}

function stripComment(line: string): string {
  let out = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && line.slice(i).match(/^'[^']*'/)) q = !q;
    if (ch === ';' && !q) break;
    out += ch;
  }
  return out;
}

/** Count bytes a DEFB/DEFW operand list occupies. */
function items(list: string): number {
  let n = 0, depth = 0, cur = '';
  const push = () => { if (cur.trim()) n += /^'.*'$/.test(cur.trim()) ? cur.trim().length - 2 : 1; cur = ''; };
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { push(); continue; }
    cur += ch;
  }
  push();
  return n;
}

let pc = 0;
const labels: { name: string; addr: number }[] = [];
const anchors: { stated: number; pc: number; line: number }[] = [];
let ok = 0; const bad: string[] = [];

for (let i = 0; i < src.length; i++) {
  const raw = stripComment(src[i]);
  if (!raw.trim()) continue;
  let rest = raw;
  const am = raw.match(/^([0-9A-Fa-f]{4}):/);
  if (am) { anchors.push({ stated: parseInt(am[1], 16), pc, line: i + 1 }); rest = raw.slice(am[0].length); }
  const lm = am ? null : raw.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
  if (lm) { labels.push({ name: lm[1], addr: pc }); rest = raw.slice(lm[0].length); }
  const body = rest.trim();
  if (!body) continue;
  const kw = body.split(/\s+/)[0].toUpperCase();
  if (kw === 'DEFC' || kw === 'DEFINE' || kw === 'INCLUDE') continue;
  if (kw === 'ORG') { pc = Number(body.split(/\s+/)[1].replace('$', '0x')); if (lm) labels[labels.length-1].addr = pc; continue; }
  if (kw === 'DEFB') { pc += items(body.slice(4)); continue; }
  if (kw === 'DEFW') { pc += 2 * items(body.slice(4)); continue; }
  if (pc >= rom.length) break;
  const d = decodeOne(rom, pc, 0);
  const a = norm(body), b = norm(d.text);
  if (a === b) ok++;
  else if (bad.length < 12) bad.push(`  line ${i + 1}  $${pc.toString(16).toUpperCase().padStart(4,'0')}  src "${body.replace(/\s+/g,' ')}" -> ${a}   rom -> ${b}`);
  else bad.push('');
  pc += d.length;
}

console.log(`  labels: ${labels.length}`);
console.log(`  instructions matched: ${ok}, mismatched: ${bad.length}`);
for (const b of bad.slice(0, 12)) if (b) console.log(b);
const below = anchors.filter((a) => a.stated < 0x0a52);
const above = anchors.filter((a) => a.stated >= 0x0a52);
console.log(`  anchors below $0A52: ${below.length}, disagreeing: ${below.filter((a) => a.stated !== a.pc).length}`);
console.log(`  anchors at/above  : ${above.length}, disagreeing: ${above.filter((a) => a.stated !== a.pc).length}`);
const firstBad = anchors.find((a) => a.stated !== a.pc);
if (firstBad) console.log(`  first disagreement at source $${firstBad.stated.toString(16).toUpperCase()}`);
const off = anchors.filter((a) => a.stated !== a.pc);
console.log(`  address anchors in source: ${anchors.length}, disagreeing with the byte-walk: ${off.length}`);
for (const a of off.slice(0, 8)) console.log(`    line ${a.line}: source says $${a.stated.toString(16).toUpperCase().padStart(4,'0')}, walk says $${a.pc.toString(16).toUpperCase().padStart(4,'0')}`);
console.log('  final PC $' + pc.toString(16).toUpperCase());
fs.writeFileSync('.tmp-align/labels.json', JSON.stringify(labels, null, 1));
