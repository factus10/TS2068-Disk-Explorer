import React, { useEffect, useState } from 'react';

export interface Disassembly {
  text: string;
  origin: number;
  instructions: number;
  conflicts: number;
}

interface Props {
  result: Disassembly | null;
  loading: boolean;
  /** Re-run at a different load address; undefined restores the detected one. */
  onSetOrigin: (origin: number | undefined) => void;
  /** Whether an override is currently in force. */
  overridden: boolean;
}

/** Accepts `$F658`, `0xF658`, `F658h` or plain decimal. */
export function parseOrigin(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const hex = s.match(/^(?:\$|0x)([0-9a-f]+)$/i) ?? s.match(/^([0-9a-f]+)h$/i);
  const n = hex ? parseInt(hex[1], 16) : (/^\d+$/.test(s) ? Number(s) : NaN);
  return Number.isInteger(n) && n >= 0 && n <= 0xffff ? n : null;
}

const hex4 = (n: number) => '$' + n.toString(16).toUpperCase().padStart(4, '0');

/**
 * Renders the .dis text, with a control for the load address.
 *
 * The origin matters more here than it looks. A file carries no record of where
 * it loads, so the disassembler infers it — from the BASIC that loads it, or
 * from the file header, or failing both it assumes zero. Get it wrong and every
 * address and every resolved symbol is wrong with it. The conflict count is the
 * tell: it counts places where two paths disagreed about where an instruction
 * starts, so a high number usually means the origin is wrong, or that the file
 * is data rather than code.
 */
export function DisasmViewer({ result, loading, onSetOrigin, overridden }: Props) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  // Follow the detected origin until the user types over it.
  useEffect(() => {
    if (result) setDraft(hex4(result.origin));
    setInvalid(false);
  }, [result?.origin]);

  const apply = () => {
    const n = parseOrigin(draft);
    if (n === null) { setInvalid(true); return; }
    setInvalid(false);
    onSetOrigin(n);
  };

  const bar = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 12px', background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)', fontSize: 10,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>Origin:</span>
      <input
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
        spellCheck={false}
        style={{
          width: 72, fontSize: 10, fontFamily: 'var(--mono, monospace)',
          padding: '2px 5px', borderRadius: 3,
          background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
          border: `1px solid ${invalid ? 'var(--accent, #e94560)' : 'var(--border)'}`,
        }}
      />
      <button onClick={apply} style={btn}>Apply</button>
      {overridden && <button onClick={() => onSetOrigin(undefined)} style={btn}>Detected</button>}
      {invalid && (
        <span style={{ color: 'var(--accent, #e94560)' }}>
          not an address — try $F658, 0xF658 or 63064
        </span>
      )}
      <div style={{ flex: 1 }} />
      {result && (
        <span style={{ color: 'var(--text-muted)' }}>
          {result.instructions} instructions
          {result.conflicts > 0 && (
            <span
              title="Two paths disagreed about where an instruction starts. A high count usually means the origin is wrong, or that these bytes are data."
              style={{ color: 'var(--accent, #e94560)', marginLeft: 8 }}
            >
              {result.conflicts} conflict{result.conflicts === 1 ? '' : 's'}
            </span>
          )}
        </span>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (loading) {
    body = <div style={{ padding: 12, color: 'var(--text-muted)' }}>Disassembling...</div>;
  } else if (!result) {
    body = (
      <div style={{ padding: 12, color: 'var(--text-muted)' }}>
        No disassembly. This needs a machine-code file with a known entry point —
        on the ZX81 that is a <code>USR</code> call or a <code>REM</code>, and on the
        TS2068 a BASIC loader naming the file as <code>CODE</code>.
      </div>
    );
  } else {
    body = (
      <pre style={{
        margin: 0, padding: '8px 12px', fontSize: 11, lineHeight: '15px',
        fontFamily: 'var(--mono, monospace)', whiteSpace: 'pre', overflow: 'auto',
      }}>
        {result.text.split('\n').map((line, i) => {
          const isComment = line.startsWith(';');
          const split = line.indexOf(' ; ');
          if (!isComment && split > 0) {
            return (
              <div key={i}>
                <span>{line.slice(0, split)}</span>
                <span style={{ color: 'var(--accent, #4ecdc4)' }}>{line.slice(split)}</span>
              </div>
            );
          }
          return (
            <div key={i} style={isComment ? { color: 'var(--text-muted, #666680)' } : undefined}>
              {line || ' '}
            </div>
          );
        })}
      </pre>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {(result || loading) && bar}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{body}</div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
  fontSize: 10, padding: '2px 8px', borderRadius: 3,
};
