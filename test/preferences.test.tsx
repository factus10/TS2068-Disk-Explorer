import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component asks the main process for settings on mount. Effects do not
// run under static rendering, so this only has to exist to be imported.
vi.mock('../src/api', async () => ({
  api: { getSettings: async () => ({}), pickExtractionDir: async () => null, updateSettings: async () => ({}) },
}));

const { Preferences } = await import('../src/components/Preferences');

describe('the Preferences window', () => {
  const html = () => renderToStaticMarkup(<Preferences onClose={() => {}} />);

  it('names the setting and says where a .dis ends up', () => {
    // The reason to have this setting at all is that a narrative pass needs to
    // find the .dis files, so the window should say where they land.
    const out = html();
    expect(out).toContain('Extraction folder');
    expect(out).toContain('.dis');
  });

  it('says the folder is unset rather than showing a blank box', () => {
    // Before mount resolves there is no folder, and an empty field would read
    // as "set to nothing" rather than "not chosen yet".
    expect(html()).toMatch(/Loading|Not set/);
  });

  /**
   * The settings outgrew a short window: on a laptop the foot of it was off
   * the bottom of the screen, with the fields down there unreachable. The
   * body has to scroll, and Close has to stay put.
   */
  it('scrolls rather than running off the screen', () => {
    const out = html();
    expect(out).toContain('max-height:85vh');
    expect(out).toContain('overflow-y:auto');
  });

  it('offers a way to choose one', () => {
    expect(html()).toContain('Choose');
  });
});
