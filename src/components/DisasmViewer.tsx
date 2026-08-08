import React from 'react';

interface Props {
  text: string | null;
  loading: boolean;
}

/**
 * Renders the .dis text. Header comment lines are dimmed so the code stands
 * out, and resolved symbol comments are highlighted — those are the reason
 * the disassembly is worth reading rather than a hex dump.
 */
export function DisasmViewer({ text, loading }: Props) {
  if (loading) return <div style={{ padding: 12, color: 'var(--text-muted)' }}>Disassembling...</div>;
  if (!text) {
    return (
      <div style={{ padding: 12, color: 'var(--text-muted)' }}>
        No disassembly. This needs a machine-code file with a known entry point —
        on the ZX81 that is a <code>USR</code> call or a <code>REM</code>, and on the
        TS2068 a BASIC loader naming the file as <code>CODE</code>.
      </div>
    );
  }
  const lines = text.split('\n');
  return (
    <pre style={{
      margin: 0, padding: '8px 12px', fontSize: 11, lineHeight: '15px',
      fontFamily: 'var(--mono, monospace)', whiteSpace: 'pre', overflow: 'auto',
    }}>
      {lines.map((line, i) => {
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
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
