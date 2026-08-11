import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as zlib from 'zlib';
import { uniqueNames } from '../electron/parsers/utils';
import { buildZipArchive } from '../electron/parsers/zip-writer';
import { planArchiveExport } from '../electron/parsers/archive-selection';
import type { FileEntry, TapPackage } from '../electron/parsers/types';
import { ArchiveExportDialog } from '../src/components/ArchiveExportDialog';

const entry = (index: number, filename: string, extra: Partial<FileEntry> = {}): FileEntry =>
  ({ index, filename, type: 'code', size: 100, isDirectory: false, params: {}, ...extra }) as FileEntry;

const LOADER = entry(0, 'MENU', { type: 'basic' });
const SCREEN = entry(1, 'PIC');
const CODE = entry(2, 'ENGINE');
const LONE = entry(3, 'NOTES');
const CATALOG = [LOADER, SCREEN, CODE, LONE];
const PKG: TapPackage = { loader: LOADER, dependencies: [SCREEN, CODE], unresolved: [] };

describe('what an archive.org export covers', () => {
  it('takes the whole catalog when nothing is selected', () => {
    const plan = planArchiveExport(CATALOG, [PKG]);
    expect(plan.bundled).toEqual([PKG]);
    expect(plan.covered.map((e) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it('narrows to the selection', () => {
    const plan = planArchiveExport(CATALOG, [PKG], [3]);
    expect(plan.covered.map((e) => e.filename)).toEqual(['NOTES']);
  });

  it('bundles a package whose every member was selected', () => {
    const plan = planArchiveExport(CATALOG, [PKG], [0, 1, 2]);
    expect(plan.bundled).toEqual([PKG]);
  });

  it('will not bundle a package the selection only partly covers', () => {
    // Bundling here would put PIC and ENGINE in an export of MENU alone —
    // files the user did not ask for. MENU goes out on its own instead.
    const plan = planArchiveExport(CATALOG, [PKG], [0]);
    expect(plan.bundled).toEqual([]);
    expect(plan.covered.map((e) => e.filename)).toEqual(['MENU']);
  });

  it('keeps directory rows out of the export', () => {
    const dir = entry(4, 'SUBDIR', { isDirectory: true });
    const plan = planArchiveExport([...CATALOG, dir], []);
    expect(plan.covered.map((e) => e.index)).not.toContain(4);
  });

  it('treats an explicitly empty selection as selecting nothing', () => {
    // Not as "no filter" — an empty array must not fall back to the whole disk.
    expect(planArchiveExport(CATALOG, [PKG], []).covered).toEqual([]);
  });
});

const dialog = (selectedCount: number) =>
  renderToStaticMarkup(
    <ArchiveExportDialog
      diskName="PUBDOM5"
      selectedCount={selectedCount}
      onExport={() => {}}
      onCancel={() => {}}
    />,
  );

describe('names packed into one ZIP', () => {
  it('leaves distinct names alone', () => {
    const names = ['A (198x)(-)(TS2068)(US)(Program).tap', 'B (198x)(-)(TS2068)(US)(Code).tap'];
    expect(uniqueNames(names)).toEqual(names);
  });

  it('separates two catalog entries that archive to the same name', () => {
    // Larken disks routinely carry two blocks called the same thing; without
    // this the second one would replace the first inside the ZIP.
    const name = 'MENU (198x)(-)(TS2068)(US)(Program).tap';
    expect(uniqueNames([name, name, name])).toEqual([
      name,
      'MENU (198x)(-)(TS2068)(US)(Program) (2).tap',
      'MENU (198x)(-)(TS2068)(US)(Program) (3).tap',
    ]);
  });

  it('keeps a .dis.json whole rather than counting from its first dot', () => {
    const name = 'MENU (198x)(-)(TS2068)(US)(Program).dis.json';
    expect(uniqueNames([name, name])[1])
      .toBe('MENU (198x)(-)(TS2068)(US)(Program) (2).dis.json');
  });

  it('handles a name with no extension at all', () => {
    const name = 'MENU (198x)(-)(TS2068)(US)(Code)';
    expect(uniqueNames([name, name])[1]).toBe('MENU (198x)(-)(TS2068)(US)(Code) (2)');
  });
});

/**
 * Read a ZIP back the way any other tool would: off the central directory,
 * not off the local headers the writer happened to lay down first.
 */
function readZip(zip: Buffer): { name: string; data: Buffer }[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let cd = zip.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];

  for (let i = 0; i < count; i++) {
    const nameLen = zip.readUInt16LE(cd + 28);
    const compSize = zip.readUInt32LE(cd + 20);
    const local = zip.readUInt32LE(cd + 42);
    const name = zip.subarray(cd + 46, cd + 46 + nameLen).toString('utf8');

    const localNameLen = zip.readUInt16LE(local + 26);
    const extraLen = zip.readUInt16LE(local + 28);
    const start = local + 30 + localNameLen + extraLen;
    out.push({ name, data: zlib.inflateRawSync(zip.subarray(start, start + compSize)) });
    cd += 46 + nameLen + zip.readUInt16LE(cd + 30) + zip.readUInt16LE(cd + 32);
  }
  return out;
}

describe('a ZIP of extracted files', () => {
  it('round-trips every entry, not just the first', () => {
    // The whole-disk ZIP only ever held one member, so the multi-member case
    // is new: a bad central directory would still open, showing one file.
    const files = [
      { name: 'MENU (198x)(-)(TS2068)(US)(Program).tap', data: Buffer.from('AAAA'.repeat(40)) },
      { name: 'PIC (198x)(-)(TS2068)(US)(Screen).tap', data: Buffer.from('BBBB'.repeat(40)) },
      { name: 'MENU (198x)(-)(TS2068)(US)(Program).dis.json', data: Buffer.from('{"x":1}\n') },
    ];
    const back = readZip(buildZipArchive(files));

    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(back.map((f) => f.data.toString())).toEqual(files.map((f) => f.data.toString()));
  });
});

describe('the archive.org export dialog', () => {
  it('offers the whole disk or the selection, and says how many are selected', () => {
    const html = dialog(3);
    expect(html).toContain('Entire disk');
    expect(html).toContain('Selected (3)');
  });

  it('will not let an empty selection be exported', () => {
    // The scope is a choice about files that exist; with none picked the
    // radio has nothing to mean, so it is disabled rather than silently empty.
    expect(dialog(0)).toContain('disabled');
    expect(dialog(3)).not.toContain('disabled');
  });

  it('defaults to the disk image ZIP, so the button still means the whole disk', () => {
    const html = dialog(3);
    expect(html).toContain('ZIP (disk image)');
    expect(html).toContain('ZIP (files)');
    expect(html).toContain('Folder');
    expect(html).toContain('byte-for-byte');
  });
});
