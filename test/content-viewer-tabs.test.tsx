import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentViewer } from '../src/components/ContentViewer';
import { SCREEN_SIZE } from '../src/api';
import type { FileEntry } from '../src/api';

/**
 * Which tabs a file is offered is a pure function of the entry, so it can be
 * checked by rendering to markup — effects do not run, so no IPC is attempted.
 */
const tabsFor = (entry: Partial<FileEntry>, diskFormat = 'larken') =>
  renderToStaticMarkup(
    <ContentViewer
      entry={{ index: 0, filename: 'X', type: 'code', size: 1024, isDirectory: false, params: {}, ...entry } as FileEntry}
      diskPath="/tmp/d.img"
      diskFormat={diskFormat}
      onClose={() => {}}
      onChangeDisasm={() => {}}
    />,
  );

describe('the tabs a SCREEN$ is offered', () => {
  it('gets a Screen tab and no Disasm tab', () => {
    const html = tabsFor({ type: 'code', size: SCREEN_SIZE });
    expect(html).toContain('>Screen<');
    // The regression: a screen is stored as CODE, so it was offered a
    // disassembly, and tracing its pixels produced a confident listing of
    // instructions that never ran.
    expect(html).not.toContain('>Disasm<');
  });

  it('leaves ordinary code with its Disasm tab and no Screen tab', () => {
    const html = tabsFor({ type: 'code', size: 1024 });
    expect(html).toContain('>Disasm<');
    expect(html).not.toContain('>Screen<');
  });

  it('does not mistake a screen-sized BASIC file or module for a screen', () => {
    expect(tabsFor({ type: 'module', size: SCREEN_SIZE })).toContain('>Disasm<');
    expect(tabsFor({ type: 'module', size: SCREEN_SIZE })).not.toContain('>Screen<');
  });

  it('still offers Disasm for a screen-sized ZX81 file, which is not a SCREEN$', () => {
    expect(tabsFor({ type: 'code', size: SCREEN_SIZE }, 'zx81-aerco')).toContain('>Disasm<');
  });
});
