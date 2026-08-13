import { describe, it, expect } from 'vitest';
import { readCatalog, readFileData } from '../electron/parsers/tzx-reader';
import { detectFormat } from '../electron/parsers/detect';

/**
 * TZX carries tapes for more than one machine, so these check both that a
 * ZX81 tape is read and that a Spectrum/TS2068 one is left alone.
 */

const SYS_BASE = 0x4009;
const NAME_TEST = [0x39, 0x2a, 0x38, 0x39];   // "TEST" in the ZX81 character set

function tzxHeader(): Buffer {
  return Buffer.from([...Buffer.from('ZXTape!\x1a', 'ascii'), 0x01, 0x14]);
}

/**
 * A ZX81 memory image: system variables from 0x4009, with D_FILE, VARS and
 * E_LINE placed so the image accounts for its own length.
 */
function zx81Image(length: number, { eline = SYS_BASE + length } = {}): Buffer {
  const img = Buffer.alloc(length, 0);
  img.writeUInt16LE(SYS_BASE + 0x74, 3);    // D_FILE
  img.writeUInt16LE(SYS_BASE + 0x60, 7);    // VARS
  img.writeUInt16LE(eline, 11);             // E_LINE
  return img;
}

/** A Generalized Data Block (0x19) whose data stream is `data` verbatim. */
function generalizedBlock(data: Buffer, { asd = 2, npd = 2 } = {}): Buffer {
  const symdef = Buffer.alloc(asd * (1 + 2 * npd), 0);
  const body = Buffer.alloc(18);
  body.writeUInt16LE(0, 0);                  // pause
  body.writeUInt32LE(0, 2);                  // TOTP — no pilot
  body.writeUInt8(0, 6);                     // NPP
  body.writeUInt8(0, 7);                     // ASP
  const bits = Math.max(1, Math.ceil(Math.log2(asd)));
  body.writeUInt32LE(Math.floor((data.length * 8) / bits), 8);  // TOTD
  body.writeUInt8(npd, 12);                  // NPD
  body.writeUInt8(asd, 13);                  // ASD
  const payload = Buffer.concat([body.subarray(0, 14), symdef, data]);

  const len = Buffer.alloc(4);
  len.writeUInt32LE(payload.length, 0);
  return Buffer.concat([Buffer.from([0x19]), len, payload]);
}

function zx81Tape(name: number[], image: Buffer): Buffer {
  const named = Buffer.from([...name.slice(0, -1), name[name.length - 1] | 0x80]);
  return Buffer.concat([tzxHeader(), generalizedBlock(Buffer.concat([named, image]))]);
}

/** A Spectrum/TS2068 tape: a 0x10 header block followed by its data block. */
function spectrumTape(): Buffer {
  const header = Buffer.alloc(19, 0x20);
  header[0] = 0x00;                 // flag: header
  header[1] = 0x00;                 // type: BASIC
  Buffer.from('PROG      ', 'ascii').copy(header, 2);
  header.writeUInt16LE(10, 12);     // data length
  header.writeUInt16LE(10, 14);     // autostart
  header.writeUInt16LE(10, 16);     // vars offset

  const data = Buffer.alloc(12, 0);
  data[0] = 0xff;

  const block = (payload: Buffer) => {
    const len = Buffer.alloc(2);
    len.writeUInt16LE(payload.length, 0);
    return Buffer.concat([Buffer.from([0x10]), Buffer.alloc(2), len, payload]);
  };
  return Buffer.concat([tzxHeader(), block(header), block(data)]);
}

describe('a ZX81 tape in TZX', () => {
  it('is read from the generalized data block', () => {
    // The regression: 0x19 was skipped outright, so a ZX81 tape catalogued as
    // nothing at all and its programs were invisible.
    const { header, entries } = readCatalog(zx81Tape(NAME_TEST, zx81Image(200)));
    expect(header.format).toBe('zx81-tzx');
    expect(entries).toHaveLength(1);
    expect(entries[0].filename).toBe('TEST');
  });

  it('takes the image length from E_LINE, not from the recording', () => {
    // A recording can carry a few trailing bytes past the program; the system
    // variable is what says where the file actually ends.
    const image = zx81Image(200, { eline: SYS_BASE + 190 });
    const tape = zx81Tape(NAME_TEST, image);
    const { entries } = readCatalog(tape);
    expect(entries[0].size).toBe(190);
    expect(readFileData(tape, entries[0])!.length).toBe(190);
  });

  it('returns the memory image whole, with no flag byte or checksum trimmed', () => {
    const image = zx81Image(200);
    image[20] = 0xab;
    const tape = zx81Tape(NAME_TEST, image);
    const { entries } = readCatalog(tape);
    const data = readFileData(tape, entries[0])!;
    // Byte 0 is VERSN and byte 20 is ours; a TAP-style trim would shift both.
    expect(data[20]).toBe(0xab);
    expect(data.readUInt16LE(11)).toBe(SYS_BASE + 200);
  });

  it('offers the system variables the ZX81 listing needs', () => {
    const { entries } = readCatalog(zx81Tape(NAME_TEST, zx81Image(200)));
    expect(entries[0].params.progEnd).toBe(0x74);
    expect(entries[0].params.varsOffset).toBe(0x60);
    expect(entries[0].type).toBe('basic');
  });

  it('is detected as its own format from the bytes, not the extension', () => {
    expect(detectFormat(zx81Tape(NAME_TEST, zx81Image(200)), 'x.tzx')).toBe('zx81-tzx');
  });
});

describe('a Spectrum or TS2068 tape in TZX', () => {
  it('still reads its header and data blocks', () => {
    const { header, entries } = readCatalog(spectrumTape());
    expect(header.format).toBe('tzx');
    expect(entries).toHaveLength(1);
    expect(entries[0].filename.trim()).toBe('PROG');
    expect(entries[0].type).toBe('basic');
  });

  it('is not mistaken for a ZX81 tape', () => {
    // The whole risk of this change: TZX serves both machines, and a wrong
    // guess would read a TS2068 program as a ZX81 memory image.
    expect(detectFormat(spectrumTape(), 'x.tzx')).toBe('tzx');
  });
});

describe('generalized blocks that are not ZX81 recordings', () => {
  it('ignores a block whose E_LINE does not account for the data', () => {
    // A TS2068 custom loader could sit in a generalized block. Nothing there
    // will place a plausible E_LINE at exactly the right offset.
    const junk = Buffer.alloc(300, 0x55);
    junk[0] = 0x80;   // ends the "filename" immediately
    const tape = Buffer.concat([tzxHeader(), generalizedBlock(junk)]);
    expect(readCatalog(tape).entries).toHaveLength(0);
    expect(detectFormat(tape, 'x.tzx')).toBe('tzx');
  });

  it('ignores an alphabet wider than two symbols', () => {
    // More than two symbols packs several to a byte, so the stream is not the
    // tape bytes and cannot be read as an image.
    const tape = Buffer.concat([
      tzxHeader(),
      generalizedBlock(Buffer.concat([
        Buffer.from([...NAME_TEST.slice(0, -1), NAME_TEST[3] | 0x80]),
        zx81Image(200),
      ]), { asd: 4 }),
    ]);
    expect(readCatalog(tape).entries).toHaveLength(0);
  });

  it('survives a truncated block without throwing', () => {
    const good = zx81Tape(NAME_TEST, zx81Image(200));
    expect(() => readCatalog(good.subarray(0, good.length - 40))).not.toThrow();
  });
});
