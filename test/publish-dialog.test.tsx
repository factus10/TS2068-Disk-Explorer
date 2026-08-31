import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Effects do not run under static rendering, so the dialog draws its
// before-anything-loaded state. That state is worth asserting on its own: it
// is what a reader sees first, and it must not imply the record is being made
// already.
vi.mock('../src/api', async () => ({
  api: {
    wpPublishSuggest: async () => ({ suggested: {}, vocabularies: {} }),
    wpPublish: async () => ({ ok: true, postId: 1, url: '', people: 0, images: 0, described: false }),
    onWpPublishProgress: () => () => {},
    openExternal: async () => true,
  },
}));

const { PublishDialog } = await import('../src/components/PublishDialog');

describe('the Publish window', () => {
  const html = () => renderToStaticMarkup(
    <PublishDialog
      imagePath="/x/disk.img"
      entryIndex={3}
      defaultTitle="HANGMAN"
      sourceFilename="Hangman (1983)(-)(TS2068)(US)(Program).zip"
      metadata={{ year: '1983', publisher: 'Sinclair' }}
      onClose={() => {}}
      onStatus={() => {}}
    />,
  );

  /**
   * The one promise the window has to keep visibly: it makes a draft. A
   * reader should never be unsure whether clicking put something on a live
   * site.
   */
  it('says plainly that nothing is published', () => {
    const out = html();
    expect(out).toContain('Creates a draft');
    expect(out).toContain('Create draft');
  });

  it('says it is still reading before it has anything to show', () => {
    // Not an empty form, which would read as "there is nothing to choose".
    expect(html()).toMatch(/Reading the program/);
  });

  it('cannot be submitted before the vocabularies arrive', () => {
    // The button exists from the start, so it has to be disabled until there
    // is something to submit.
    expect(html()).toContain('disabled');
  });

  it('offers no choices until it has read the site', () => {
    // The form proper — title, machine, keywords — is behind the load, so
    // none of it should be drawn yet.
    const out = html();
    expect(out).not.toContain('BASIC keywords used');
    expect(out).not.toContain('Programmers');
  });

  // The filled-in state is not covered here: these tests render to static
  // markup in a node environment, where effects never run, and the dialog only
  // draws its fields once the site has answered. What fills them — the machine,
  // the keywords, the tags — is covered directly in wordpress-write.test.ts.
});
