import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../src/api', async () => ({
  api: { wpTermSearch: async () => ({ terms: [] }) },
}));

const { TermPicker } = await import('../src/components/TermPicker');

describe('picking from a vocabulary too big to look at', () => {
  const render = (props: Partial<React.ComponentProps<typeof TermPicker>> = {}) =>
    renderToStaticMarkup(
      <TermPicker
        kind="indiv"
        value={[]}
        onChange={() => {}}
        placeholder="Surname or forename"
        {...props}
      />,
    );

  it('is a search box, not a list', () => {
    // 3,448 people cannot be a dropdown, and the placeholder should say what
    // to do rather than leaving an empty field.
    const out = render();
    expect(out).toContain('placeholder="Surname or forename"');
    expect(out).not.toContain('<select');
  });

  it('shows what has been chosen, each with a way to drop it', () => {
    const out = render({ value: [{ id: 1, name: 'Tim Swenson' }] });
    expect(out).toContain('Tim Swenson');
    expect(out).toContain('Remove');
  });

  /**
   * A hierarchical term is shown by its path. `Chess` on its own says nothing
   * about whether it is the game or something else filed under Education.
   */
  it('shows a nested term by its path', () => {
    const out = render({
      kind: 'genre',
      value: [{ id: 7, name: 'Chess', path: 'Game > Chess' }],
    });
    expect(out).toContain('Game &gt; Chess');
  });

  // The suggestion list only appears once the reader has typed and the site
  // has answered, neither of which happens under static rendering. What it
  // does with those answers — the three-character floor, dropping stale
  // replies — is behaviour, not markup.
});
