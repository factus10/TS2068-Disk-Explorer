import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExportPrompt, tapeNameInput } from '../src/components/ExportPrompt';

const members = [
  { index: 1, filename: 'game      ', typeName: 'BASIC' },
  { index: 3, filename: 'game', typeName: 'CODE' },
];

const render = (props: Partial<React.ComponentProps<typeof ExportPrompt>>) => renderToStaticMarkup(
  <ExportPrompt title="Save package as" defaultValue="game" onConfirm={() => {}} onCancel={() => {}} {...props} />,
);

describe('naming a package\'s files in the export dialog', () => {
  it('offers each file, loader first, under its name on the disk', () => {
    const html = render({ members });
    expect(html).toContain('Names on the tape');
    expect(html.match(/aria-label="Tape name for game"[^>]*value="game"/g)).toHaveLength(2);
    expect(html.indexOf('BASIC · loader')).toBeLessThan(html.indexOf('CODE'));
  });

  it('opens on the names already given, and says what they were', () => {
    const html = render({ members, tapeNames: { 3: 'Galaxians' } });
    expect(html).toContain('value="Galaxians"');
    expect(html).toContain('was game');
  });

  it('asks nothing of a single file', () => {
    expect(render({})).not.toContain('Names on the tape');
  });

  it('keeps a name to what a tape header holds', () => {
    expect(tapeNameInput('Fünf Galaxians')).toBe('Fnf Galaxi');
  });
});
