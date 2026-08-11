import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DirEntry, FolderArchiveState } from '../src/api';

// The component lists a directory on mount. Effects do not run under static
// rendering, so entries are seeded through the mocked api instead.
let listing: DirEntry[] = [];
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    api: {
      getHomeDirectory: async () => '/home',
      listDirectory: async () => listing,
      setFolderArchived: async () => null,
    },
  };
});

// Tests run in node, with no DOM. The component only reads localStorage for
// its initial toggle state, so a map is enough to stand in for it.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  clear: () => store.clear(),
};

const { FileBrowser, visibleAfterHide } = await import('../src/components/FileBrowser');

const mark = (over: Partial<FolderArchiveState> = {}): FolderArchiveState => ({
  markedAt: '2026-03-04T10:00:00.000Z',
  imageCount: 4,
  currentCount: 4,
  stale: false,
  external: false,
  ...over,
});

const folder = (name: string, archived: FolderArchiveState | null = null): DirEntry =>
  ({ name, isDirectory: true, size: 0, path: `/home/${name}`, archived });

beforeEach(() => {
  listing = [];
  localStorage.clear();
});

const html = () => renderToStaticMarkup(<FileBrowser onOpenFile={() => {}} />);

describe('the archived mark in the file browser', () => {
  it('offers a way to hide archived folders', () => {
    expect(html()).toContain('Hide folders marked as archived');
  });

  it('remembers the hide setting across sessions', () => {
    // A per-session toggle would mean re-hiding on every launch, which is the
    // opposite of what a long archiving pass wants.
    localStorage.setItem('hideArchived', 'true');
    expect(html()).toContain('Archived folders hidden');
  });

});

describe('which rows the hide toggle removes', () => {
  const visible = (entries: DirEntry[], hide = true) =>
    visibleAfterHide(entries, hide).map((e) => e.name);

  it('keeps everything when the toggle is off', () => {
    expect(visible([folder('Todo'), folder('Done', mark())], false)).toEqual(['Todo', 'Done']);
  });

  it('keeps unmarked folders and drops settled ones', () => {
    expect(visible([folder('Todo'), folder('Done', mark())])).toEqual(['Todo']);
  });

  it('keeps a stale folder visible even when hiding archived ones', () => {
    // Hiding it would bury the one case the mark exists to surface.
    const entries = [folder('Done', mark()), folder('Grew', mark({ currentCount: 9, stale: true }))];
    expect(visible(entries)).toEqual(['Grew']);
  });
});
