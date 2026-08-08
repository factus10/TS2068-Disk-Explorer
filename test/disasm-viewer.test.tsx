import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DisasmViewer } from '../src/components/DisasmViewer';

/**
 * The bar is a pure function of its props, so it can be checked by rendering
 * to markup — no DOM, which keeps the suite the plain Node one it is.
 */
const render = (props: Partial<React.ComponentProps<typeof DisasmViewer>> = {}) =>
  renderToStaticMarkup(
    <DisasmViewer
      result={{ text: '$0000  C9\tRET', origin: 0, instructions: 1, conflicts: 0 }}
      loading={false}
      onSetOrigin={() => {}}
      overridden={false}
      exrom={false}
      onSetExrom={() => {}}
      showExrom
      {...props}
    />,
  );

describe('the EXROM toggle', () => {
  it('is offered, and off, by default', () => {
    const html = render();
    expect(html).toContain('EXROM');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
  });

  it('shows as on when the overlay is in force', () => {
    expect(render({ exrom: true })).toContain('checked=""');
  });

  it('is hidden on a machine that has no EXROM', () => {
    expect(render({ showExrom: false })).not.toContain('EXROM');
  });

  it('says why it is a choice rather than the default', () => {
    // Without this the toggle reads as a display preference rather than an
    // assertion about which ROM was paged in when the code ran.
    expect(render()).toContain('MASK-INT');
  });
});
