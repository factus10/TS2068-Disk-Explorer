import type { BasicListing, BasicToken } from '../../electron/parsers/basic-detokenizer';

/**
 * Build a line the way the detokenizer does, with token types.
 *
 * The types are not decoration. A real `USR` call is typed `function`, while
 * everything after a `REM` is emitted as plain text — which is how machine
 * code stashed in a REM renders: keyword-shaped, and not executable. Code
 * that tells those apart by type is doing the right thing and code that
 * matches on spelling is not, so a helper producing one untyped blob would let
 * the wrong version pass.
 */
export function basicLine(lineNumber: number, text: string): BasicListing['lines'][number] {
  const tokens: BasicToken[] = [];
  let pending = '';
  let inRem = false;
  let inString = false;
  const flush = () => {
    if (pending) tokens.push({ type: 'text', text: pending });
    pending = '';
  };

  let i = 0;
  while (i < text.length) {
    // A keyword exists only outside a string and outside a REM. The real
    // detokenizer tracks both, and a helper that did not would let a test
    // claim it distinguished type from spelling when it had not.
    if (!inString) {
      const kw = ['REM ', 'USR '].find((k) => text.startsWith(k, i));
      if (kw) {
        flush();
        const isRem = kw === 'REM ';
        // Inside a REM the detokenizer still emits the keyword as its own
        // token — it has to, since it is rendering bytes one at a time — but
        // types it as text rather than as a call. Reproducing that split is
        // the whole point: a helper that merged it into the surrounding blob
        // would leave the type check untested, because no token would then
        // have `USR` as its text.
        tokens.push({
          type: inRem ? 'text' : (isRem ? 'statement' : 'function'),
          text: kw,
        });
        if (isRem && !inRem) inRem = true;
        i += kw.length;
        continue;
      }
    }
    if (text[i] === '"') inString = !inString;
    pending += text[i];
    i++;
  }
  flush();
  return { lineNumber, tokens };
}

/** A listing whose lines are numbered from 1. */
export const listing = (...lines: string[]): BasicListing => ({
  lines: lines.map((text, i) => basicLine(i + 1, text)),
});

/** A listing with explicit line numbers. */
export const numberedListing = (...lines: [number, string][]): BasicListing => ({
  lines: lines.map(([n, text]) => basicLine(n, text)),
});
