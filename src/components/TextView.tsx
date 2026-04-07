import React, { useState, useCallback } from 'react';

interface Props {
  text: string;
}

export function TextView({ text }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '4px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}>
        <button
          onClick={handleCopy}
          style={{
            background: 'var(--bg-tertiary)',
            color: copied ? 'var(--badge-basic)' : 'var(--text-secondary)',
            fontSize: 10,
            padding: '2px 10px',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
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
    </div>
  );
}
