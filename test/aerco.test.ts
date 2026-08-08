import { describe, it, expect } from 'vitest';
import { readCatalog, readFileData } from '../electron/parsers/aerco';

/**
 * A minimal DOS-64 image, built here so the suite needs no disk of its own.
 *
 * Layout the parser expects: 5120-byte tracks, the directory starting at $200
 * in track 0, 32-byte entries of
 *
 *   [0]     type       [1..10] name, NUL-padded
 *   [11,12] length LE  [13,14] param1   [15,16] param2
 *   [17..31] block numbers, zero-terminated
 *
 * BASIC/CODE/DATA repeat a 17-byte header at the start of their first track,
 * which the reader strips; MODULE does not.
 */
const TRACK = 5120;
const DIR_START = 0x200;
const HEADER = 17;

function buildImage(files: {
  type: number; name: string; length: number; blocks: number[]; fill: number;
}[], tracks = 8): Buffer {
  const img = Buffer.alloc(TRACK * tracks);
  files.forEach((f, i) => {
    const e = img.subarray(DIR_START + i * 32, DIR_START + (i + 1) * 32);
    e[0] = f.type;
    e.write(f.name, 1, 'ascii');
    e.writeUInt16LE(f.length, 11);
    f.blocks.forEach((b, j) => { e[17 + j] = b; });
    // Fill the allocated tracks so the content is recognisable.
    for (const b of f.blocks) img.fill(f.fill, b * TRACK, (b + 1) * TRACK);
  });
  return img;
}

describe('Aerco DOS-64 file sizes', () => {
  const img = buildImage([
    // A MODULE across two tracks. DOS-64 records no length for overlays.
    { type: 0x04, name: 'ml', length: 0, blocks: [2, 3], fill: 0xaa },
    // A CODE file with a declared length shorter than its allocation.
    { type: 0x03, name: 'prog', length: 100, blocks: [4], fill: 0xbb },
    // A CODE file whose declared length exceeds what the blocks can hold.
    { type: 0x03, name: 'over', length: 60000, blocks: [5], fill: 0xcc },
  ]);
  const cat = readCatalog(img);
  const byName = (n: string) => cat.entries.find((e) => e.filename.trim() === n)!;

  it('reports a MODULE at the size of the bytes it returns, not zero', () => {
    const e = byName('ml');
    expect(e.type).toBe('module');
    // Two whole tracks; a MODULE carries no 17-byte header to strip.
    expect(e.size).toBe(2 * TRACK);
    expect(readFileData(img, e)!.length).toBe(e.size);
  });

  it('says so, rather than presenting an allocated size as a declared one', () => {
    expect(byName('ml').metadata.length).toMatch(/not recorded/);
  });

  it('still honours a declared length, and strips the header', () => {
    const e = byName('prog');
    expect(e.size).toBe(100);
    const d = readFileData(img, e)!;
    expect(d.length).toBe(100);
    expect(d[0]).toBe(0xbb);              // content, not the header
    expect(byName('prog').metadata.length).toBeUndefined();
  });

  it('clamps a declared length that exceeds the allocated blocks', () => {
    const e = byName('over');
    // One track less the header is all the block list can hold.
    expect(e.size).toBe(TRACK - HEADER);
    expect(readFileData(img, e)!.length).toBe(e.size);
  });

  it('never returns more data than the size it advertises', () => {
    for (const e of cat.entries) {
      const d = readFileData(img, e);
      if (d) expect(d.length).toBeLessThanOrEqual(e.size);
    }
  });
});
