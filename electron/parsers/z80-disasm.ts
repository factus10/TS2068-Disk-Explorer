/**
 * Z80 instruction decoder.
 *
 * Pure and self-contained: bytes in, one instruction out. It knows nothing
 * about disks, files or machines, so the same decoder serves the ZX81 and the
 * TS2068 — the differences between them live in the symbol packs, not here.
 *
 * Decoding follows the standard opcode grouping, splitting each byte into
 *
 *   x = op >> 6    y = (op >> 3) & 7    z = op & 7    p = y >> 1    q = y & 1
 *
 * which turns most of the instruction set into a handful of regular rules
 * rather than a 256-entry table per prefix. The irregular corners are listed
 * out explicitly below.
 *
 * Undocumented instructions are decoded rather than skipped, and flagged. They
 * are not exotic in period code: `SLL` and the `IXH`/`IXL` register halves both
 * turn up in hand-written Z80 from this era, and a disassembler that refuses
 * them desynchronises exactly where the interesting code is.
 */

/** How an instruction affects the flow of control, for the tracer. */
export type Flow =
  | 'seq'    // falls through to the next instruction
  | 'jump'   // unconditional transfer; does not fall through
  | 'cond'   // conditional transfer; both branches live
  | 'call'   // transfers and returns, so both are live
  | 'ret'    // returns; does not fall through
  | 'halt';  // HALT — resumes on interrupt, so treated as falling through

export interface Instruction {
  /** Absolute address of this instruction. */
  addr: number;
  /** Raw bytes consumed. */
  bytes: number[];
  /** Rendered assembly, e.g. `LD HL,$4082`. */
  text: string;
  length: number;
  /** Absolute branch target for JP/JR/CALL/RST, when statically known. */
  target?: number;
  flow: Flow;
  /** Set for opcodes outside the documented instruction set. */
  undocumented?: boolean;
  /** Set when the bytes decode to no valid instruction. */
  invalid?: boolean;
}

const R = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
const RP = ['BC', 'DE', 'HL', 'SP'];
const RP2 = ['BC', 'DE', 'HL', 'AF'];
const CC = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
const ALU = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '];
const ROT = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'];
const IM = ['0', '0', '1', '2', '0', '0', '1', '2'];
const BLOCK = [
  ['LDI', 'CPI', 'INI', 'OUTI'],
  ['LDD', 'CPD', 'IND', 'OUTD'],
  ['LDIR', 'CPIR', 'INIR', 'OTIR'],
  ['LDDR', 'CPDR', 'INDR', 'OTDR'],
];

const hex8 = (n: number) => '$' + n.toString(16).toUpperCase().padStart(2, '0');
const hex16 = (n: number) => '$' + n.toString(16).toUpperCase().padStart(4, '0');
/** Signed displacement, rendered the way it is written: `(IX+5)`, `(IX-3)`. */
const disp = (d: number) => (d < 0 ? `-${(-d).toString()}` : `+${d.toString()}`);

/** Reader that keeps the consumed bytes so the emitter can show them. */
class Cursor {
  readonly start: number;
  pos: number;
  constructor(private data: Buffer | Uint8Array, start: number) {
    this.start = start;
    this.pos = start;
  }
  byte(): number {
    return this.pos < this.data.length ? this.data[this.pos++] : (this.pos++, 0);
  }
  signed(): number {
    const b = this.byte();
    return b > 127 ? b - 256 : b;
  }
  word(): number {
    return this.byte() | (this.byte() << 8);
  }
  get overrun(): boolean {
    return this.pos > this.data.length;
  }
  bytesFrom(data: Buffer | Uint8Array): number[] {
    const out: number[] = [];
    for (let i = this.start; i < Math.min(this.pos, data.length); i++) out.push(data[i]);
    return out;
  }
}

/**
 * Decode the instruction at `offset`. `origin` is the address the buffer's
 * first byte lives at, so branch targets come back as absolute addresses.
 */
export function decodeOne(
  data: Buffer | Uint8Array, offset: number, origin = 0,
): Instruction {
  const c = new Cursor(data, offset);
  const addr = origin + offset;
  const r = decode(c, addr);
  const bytes = c.bytesFrom(data);
  return {
    addr,
    bytes,
    length: Math.max(1, bytes.length),
    text: r.text,
    ...(r.target !== undefined ? { target: r.target } : {}),
    flow: r.flow,
    ...(r.undocumented ? { undocumented: true } : {}),
    ...(r.invalid || c.overrun ? { invalid: true } : {}),
  };
}

interface Decoded {
  text: string;
  flow: Flow;
  target?: number;
  undocumented?: boolean;
  invalid?: boolean;
}

const seq = (text: string, undocumented?: boolean): Decoded =>
  ({ text, flow: 'seq', ...(undocumented ? { undocumented: true } : {}) });

function decode(c: Cursor, addr: number): Decoded {
  const op = c.byte();
  if (op === 0xcb) return decodeCB(c);
  if (op === 0xed) return decodeED(c);
  if (op === 0xdd) return decodeIndexed(c, addr, 'IX');
  if (op === 0xfd) return decodeIndexed(c, addr, 'IY');
  return decodeBase(c, addr, op, null);
}

/**
 * The unprefixed set, and — with `ix` set — its DD/FD forms, where HL becomes
 * IX or IY, H and L become the undocumented register halves, and (HL) becomes
 * (IX+d). Sharing one function keeps the two in step.
 */
function decodeBase(c: Cursor, addr: number, op: number, ix: string | null): Decoded {
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;

  // Register names shift under an index prefix. (HL) becomes (IX+d), which
  // also consumes a displacement byte — so it must be read at the right moment.
  const reg = (i: number, allowIndex = true): string => {
    if (!ix) return R[i];
    if (i === 4) return ix + 'H';
    if (i === 5) return ix + 'L';
    if (i === 6 && allowIndex) return `(${ix}${disp(c.signed())})`;
    return R[i];
  };
  const hl = ix ?? 'HL';
  const rp = (i: number) => (i === 2 ? hl : RP[i]);
  const rp2 = (i: number) => (i === 2 ? hl : RP2[i]);
  const und = ix !== null;

  switch (x) {
    case 0:
      switch (z) {
        case 0:
          if (y === 0) return seq('NOP');
          if (y === 1) return seq("EX AF,AF'");
          if (y === 2) {
            const t = addr + (c.pos - c.start) + 1 + c.signed();
            return { text: `DJNZ ${hex16(t & 0xffff)}`, flow: 'cond', target: t & 0xffff };
          }
          if (y === 3) {
            const t = addr + (c.pos - c.start) + 1 + c.signed();
            return { text: `JR ${hex16(t & 0xffff)}`, flow: 'jump', target: t & 0xffff };
          }
          {
            const t = addr + (c.pos - c.start) + 1 + c.signed();
            return { text: `JR ${CC[y - 4]},${hex16(t & 0xffff)}`, flow: 'cond', target: t & 0xffff };
          }
        case 1:
          return q === 0
            ? seq(`LD ${rp(p)},${hex16(c.word())}`, und && p === 2)
            : seq(`ADD ${hl},${rp(p)}`, und);
        case 2:
          if (q === 0) {
            if (p === 0) return seq('LD (BC),A');
            if (p === 1) return seq('LD (DE),A');
            if (p === 2) return seq(`LD (${hex16(c.word())}),${hl}`, und);
            return seq(`LD (${hex16(c.word())}),A`);
          }
          if (p === 0) return seq('LD A,(BC)');
          if (p === 1) return seq('LD A,(DE)');
          if (p === 2) return seq(`LD ${hl},(${hex16(c.word())})`, und);
          return seq(`LD A,(${hex16(c.word())})`);
        case 3:
          return seq(`${q === 0 ? 'INC' : 'DEC'} ${rp(p)}`, und);
        case 4: return seq(`INC ${reg(y)}`, und && (y === 4 || y === 5));
        case 5: return seq(`DEC ${reg(y)}`, und && (y === 4 || y === 5));
        case 6: {
          // (IX+d) takes its displacement before the immediate byte.
          const target = reg(y);
          return seq(`LD ${target},${hex8(c.byte())}`, und && (y === 4 || y === 5));
        }
        default:
          return seq(['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'][y]);
      }
    case 1: {
      if (z === 6 && y === 6) return { text: 'HALT', flow: 'halt' };
      // Only one operand may be the indexed form; the other stays H or L.
      const indexed = ix && (y === 6 || z === 6);
      const dst = indexed && y !== 6 ? R[y] : reg(y);
      const src = indexed && z !== 6 ? R[z] : reg(z, y !== 6);
      return seq(`LD ${dst},${src}`, und);
    }
    case 2:
      return seq(`${ALU[y]}${reg(z)}`, und && (z === 4 || z === 5));
    default:
      switch (z) {
        case 0: return { text: `RET ${CC[y]}`, flow: 'cond' };
        case 1:
          if (q === 0) return seq(`POP ${rp2(p)}`, und && p === 2);
          if (p === 0) return { text: 'RET', flow: 'ret' };
          if (p === 1) return seq('EXX');
          if (p === 2) return { text: `JP (${hl})`, flow: 'jump' };
          return seq(`LD SP,${hl}`, und);
        case 2: {
          const t = c.word();
          return { text: `JP ${CC[y]},${hex16(t)}`, flow: 'cond', target: t };
        }
        case 3:
          if (y === 0) { const t = c.word(); return { text: `JP ${hex16(t)}`, flow: 'jump', target: t }; }
          if (y === 1) return decodeCB(c); // handled by the caller for DD/FD
          if (y === 2) return seq(`OUT (${hex8(c.byte())}),A`);
          if (y === 3) return seq(`IN A,(${hex8(c.byte())})`);
          if (y === 4) return seq(`EX (SP),${hl}`, und);
          if (y === 5) return seq('EX DE,HL');
          return seq(y === 6 ? 'DI' : 'EI');
        case 4: {
          const t = c.word();
          return { text: `CALL ${CC[y]},${hex16(t)}`, flow: 'call', target: t };
        }
        case 5:
          if (q === 0) return seq(`PUSH ${rp2(p)}`, und && p === 2);
          if (p === 0) { const t = c.word(); return { text: `CALL ${hex16(t)}`, flow: 'call', target: t }; }
          return seq('NOP'); // DD/ED/FD reached here are handled before this point
        case 6: return seq(`${ALU[y]}${hex8(c.byte())}`);
        default: return { text: `RST ${hex8(y * 8)}`, flow: 'call', target: y * 8 };
      }
  }
}

function decodeCB(c: Cursor): Decoded {
  const op = c.byte();
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
  if (x === 0) return seq(`${ROT[y]} ${R[z]}`, y === 6);
  if (x === 1) return seq(`BIT ${y},${R[z]}`);
  return seq(`${x === 2 ? 'RES' : 'SET'} ${y},${R[z]}`);
}

/** DD CB d op / FD CB d op — displacement first, then the operation byte. */
function decodeIndexedCB(c: Cursor, ix: string): Decoded {
  const d = c.signed();
  const op = c.byte();
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
  const operand = `(${ix}${disp(d)})`;
  // With z != 6 the result is also copied into a register. That form is
  // undocumented but real, and appears in period code.
  const copy = z !== 6 ? `,${R[z]}` : '';
  if (x === 0) return seq(`${ROT[y]} ${operand}${copy}`, true);
  if (x === 1) return seq(`BIT ${y},${operand}`, z !== 6);
  return seq(`${x === 2 ? 'RES' : 'SET'} ${y},${operand}${copy}`, true);
}

function decodeIndexed(c: Cursor, addr: number, ix: string): Decoded {
  const op = c.byte();
  if (op === 0xcb) return decodeIndexedCB(c, ix);
  // A prefix followed by another prefix is consumed and has no effect; the
  // hardware goes on to decode from the second one.
  if (op === 0xdd || op === 0xed || op === 0xfd) {
    c.pos--;                       // hand the second prefix back to the caller
    return seq('NOP', true);       // the ignored prefix is a one-byte no-op
  }
  const r = decodeBase(c, addr, op, ix);
  // If the decoded instruction never mentions the index register, the prefix
  // was consumed for nothing. That is legal and executes as the unprefixed
  // instruction — but it is worth flagging, since it usually means the bytes
  // are data rather than code.
  return r.text.includes(ix) ? r : { ...r, undocumented: true };
}

function decodeED(c: Cursor): Decoded {
  const op = c.byte();
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  if (x === 1) {
    switch (z) {
      case 0: return seq(y === 6 ? 'IN (C)' : `IN ${R[y]},(C)`, y === 6);
      case 1: return seq(y === 6 ? 'OUT (C),0' : `OUT (C),${R[y]}`, y === 6);
      case 2: return seq(`${q === 0 ? 'SBC' : 'ADC'} HL,${RP[p]}`);
      case 3:
        // ED 63 and ED 6B duplicate the shorter 22 / 2A encodings of the same
        // instruction, and are undocumented.
        return q === 0
          ? seq(`LD (${hex16(c.word())}),${RP[p]}`, p === 2)
          : seq(`LD ${RP[p]},(${hex16(c.word())})`, p === 2);
      case 4: return seq('NEG', y !== 0);
      case 5:
        // Only ED 45 (RETN) and ED 4D (RETI) are documented; the other six
        // encodings in this slot behave as RETN.
        return { text: y === 1 ? 'RETI' : 'RETN', flow: 'ret', ...(y > 1 ? { undocumented: true } : {}) };
      case 6: return seq(`IM ${IM[y]}`, y === 0 || y === 4 || y === 5);
      default:
        return seq(['LD I,A', 'LD R,A', 'LD A,I', 'LD A,R', 'RRD', 'RLD', 'NOP', 'NOP'][y], y >= 6);
    }
  }
  if (x === 2 && z <= 3 && y >= 4) return seq(BLOCK[y - 4][z]);
  // Everything else in the ED page is an invalid two-byte no-op.
  return { text: `DEFB $ED,${hex8(op)}`, flow: 'seq', invalid: true };
}

/** Decode a run of instructions, for callers that just want a linear sweep. */
export function decodeRange(
  data: Buffer | Uint8Array, start: number, end: number, origin = 0,
): Instruction[] {
  const out: Instruction[] = [];
  let pos = start;
  while (pos < end) {
    const insn = decodeOne(data, pos, origin);
    out.push(insn);
    pos += insn.length;
  }
  return out;
}
