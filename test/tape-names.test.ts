import { describe, it, expect } from 'vitest';
import { applyTapeNames, scanBasicForLoads } from '../electron/parsers/basic-analyzer';
import { buildMultiFileTap } from '../electron/parsers/tap';
import type { FileEntry } from '../electron/parsers/types';

const LOAD = 0xef, CODE = 0xaf, SCREEN = 0xaa, PRINT = 0xf5;

/** One BASIC line: number, body bytes, terminator, with its length filled in. */
function line(n: number, ...body: (number | string)[]): Buffer {
  const bytes = Buffer.concat(body.map((b) =>
    typeof b === 'string' ? Buffer.from(b, 'latin1') : Buffer.from([b])));
  const withEnd = Buffer.concat([bytes, Buffer.from([0x0d])]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(n, 0);
  head.writeUInt16LE(withEnd.length, 2);
  return Buffer.concat([head, withEnd]);
}

const entry = (over: Partial<FileEntry>): FileEntry => ({
  index: 0, filename: 'X', type: 'basic', typeName: 'BASIC', size: 0,
  params: {}, blocks: [], isMemoryDump: false, isDirectory: false, metadata: {},
  ...over,
} as FileEntry);

// A loader that fetches its screen and its code by name, then a variable
// area after the program that the rewrite must carry along untouched.
const program = Buffer.concat([
  line(10, LOAD, '"', 'TITLE', '"', SCREEN),
  line(20, LOAD, '"', 'game', '"', CODE),
  line(30, PRINT, '"', 'game', '"'),
  line(40, LOAD, '"', '"', CODE),
]);
const vars = Buffer.from([0x61, 0, 0, 5, 0, 0]);
const loaderData = Buffer.concat([program, vars]);

const loader = entry({
  index: 1, filename: 'game      ', size: loaderData.length,
  params: { autostartLine: 10, varsOffset: program.length, param2: program.length },
});
const screen = entry({ index: 2, filename: 'TITLE', type: 'code', typeName: 'CODE', size: 6912, params: { startAddr: 16384 } });
const code = entry({ index: 3, filename: 'game', type: 'code', typeName: 'CODE', size: 4, params: { startAddr: 32768 } });
const members = [loader, screen, code];

describe('renaming the files of a package on the tape', () => {
  it('leaves everything alone when nothing is renamed', () => {
    const out = applyTapeNames(loader, loaderData, members, { 2: 'TITLE', 3: ' game ' });
    expect(out.entry).toBe(loader);
    expect(out.data).toBe(loaderData);
  });

  it('rewrites the LOADs that name a renamed file, and only those', () => {
    const out = applyTapeNames(loader, loaderData, members, { 2: 'Splash', 3: 'Galaxians' });
    expect(scanBasicForLoads(out.data)).toEqual([
      { lineNumber: 10, filename: 'Splash', loadType: 'screen' },
      { lineNumber: 20, filename: 'Galaxians', loadType: 'code' },
      { lineNumber: 40, filename: '', loadType: 'code' },
    ]);
    // A PRINT of the same text is not a reference to the file.
    expect(out.data.includes(Buffer.from('"game"', 'latin1'))).toBe(true);
  });

  it('tells two files of one name apart by what the LOAD asks for', () => {
    // The loader is also called "game": renaming it must not move LOAD "game" CODE.
    const out = applyTapeNames(loader, loaderData, members, { 1: 'Loader' });
    expect(out.entry.filename).toBe('Loader');
    expect(out.data).toEqual(loaderData);
  });

  it('moves the program length with the program and keeps the variables', () => {
    const out = applyTapeNames(loader, loaderData, members, { 3: 'Galaxians' });
    const grown = 'Galaxians'.length - 'game'.length;
    expect(out.entry.params.varsOffset).toBe(program.length + grown);
    expect(out.entry.params.param2).toBe(program.length + grown);
    expect(out.data.length).toBe(loaderData.length + grown);
    expect(out.data.subarray(out.data.length - vars.length)).toEqual(vars);
  });

  it('writes the new names into the tape headers', () => {
    const data = new Map<number, Buffer>([
      [1, loaderData], [2, Buffer.alloc(6912)], [3, Buffer.from([1, 2, 3, 4])],
    ]);
    const tap = buildMultiFileTap(
      { loader, dependencies: [screen, code], unresolved: [] }, data, undefined,
      { 1: 'Loader', 3: 'Galaxians' },
    )!;
    const names: string[] = [];
    let at = 0;
    while (at < tap.length) {
      const len = tap.readUInt16LE(at);
      if (tap[at + 2] === 0x00) names.push(tap.subarray(at + 4, at + 14).toString('latin1'));
      at += 2 + len;
    }
    expect(names).toEqual(['Loader    ', 'TITLE     ', 'Galaxians ']);
  });

  it('drops what a tape header cannot hold', () => {
    const out = applyTapeNames(code, Buffer.alloc(4), members, { 3: 'Fünf Galaxians' });
    expect(out.entry.filename).toBe('Fnf Galaxi');
  });
});
