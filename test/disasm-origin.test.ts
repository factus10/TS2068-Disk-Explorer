import { describe, it, expect } from 'vitest';
import { parseOrigin } from '../src/components/DisasmViewer';

describe('parsing a load address the user typed', () => {
  it('takes the forms the rest of the app shows addresses in', () => {
    expect(parseOrigin('$F658')).toBe(0xf658);
    expect(parseOrigin('0xf658')).toBe(0xf658);
    expect(parseOrigin('F658h')).toBe(0xf658);
    expect(parseOrigin('63064')).toBe(63064);
  });

  it('tolerates surrounding space and either case', () => {
    expect(parseOrigin('  $f658  ')).toBe(0xf658);
    expect(parseOrigin('$ABCD')).toBe(0xabcd);
  });

  it('accepts the ends of the range', () => {
    expect(parseOrigin('0')).toBe(0);
    expect(parseOrigin('$FFFF')).toBe(0xffff);
  });

  it('rejects anything that is not a 16-bit address', () => {
    for (const bad of ['', '   ', '$', 'ffff!', '$10000', '65536', '-1', '$-1', 'nonsense', '1.5']) {
      expect(parseOrigin(bad), `expected ${JSON.stringify(bad)} to be rejected`).toBeNull();
    }
  });

  it('does not read a bare hex string as decimal', () => {
    // "F658" without a marker is ambiguous, so it is only valid as hex via a
    // marker; a bare non-decimal string is refused rather than guessed at.
    expect(parseOrigin('F658')).toBeNull();
  });
});
