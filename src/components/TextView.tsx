import React from 'react';

interface Props {
  text: string;
}

export function TextView({ text }: Props) {
  return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      padding: '8px 12px',
      fontFamily: 'monospace',
      fontSize: 12,
      lineHeight: '18px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      tabSize: 8,
    }}>
      {text}
    </div>
  );
}
