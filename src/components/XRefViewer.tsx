import React, { useState, useCallback } from 'react';

export interface XRefEntry {
  name: string;
  kind: 'numeric' | 'string' | 'array-num' | 'array-str' | 'fn';
  assignments: number[];
  reads: number[];
}

interface Props {
  entries: XRefEntry[];
}

const KIND_COLORS: Record<string, string> = {
  'numeric': 'var(--badge-basic)',
  'string': '#fce38a',
  'array-num': 'var(--badge-code)',
  'array-str': '#f0a050',
  'fn': 'var(--badge-dump)',
};

const KIND_LABELS: Record<string, string> = {
  'numeric': 'NUM',
  'string': 'STR$',
  'array-num': 'NUM()',
  'array-str': 'STR$()',
  'fn': 'FN',
};

export function XRefViewer({ entries }: Props) {
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);

  const filtered = filter
    ? entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  const plainText = entries.map((e) => {
    const assigns = e.assignments.length > 0 ? `  SET: ${e.assignments.join(', ')}` : '';
    const reads = e.reads.length > 0 ? `  USE: ${e.reads.join(', ')}` : '';
    return `${e.name} (${KIND_LABELS[e.kind]})${assigns}${reads}`;
  }).join('\n');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(plainText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [plainText]);

  const unusedVars = entries.filter((e) => e.reads.length === 0 && e.assignments.length > 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '4px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {entries.length} variables
          {unusedVars.length > 0 && (
            <span style={{ color: 'var(--accent)', marginLeft: 8 }}>
              {unusedVars.length} assigned but never read
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            style={{
              width: 100,
              fontFamily: 'monospace',
              fontSize: 10,
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '2px 6px',
              outline: 'none',
            }}
          />
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
      </div>

      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '8px 12px',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: '22px',
        background: 'var(--bg-primary)',
      }}>
        {filtered.map((entry) => {
          const isUnused = entry.reads.length === 0 && entry.assignments.length > 0;
          return (
            <div key={entry.name} style={{
              padding: '4px 0',
              borderBottom: '1px solid var(--border)',
              opacity: isUnused ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{
                  fontSize: 10,
                  padding: '0 6px',
                  borderRadius: 6,
                  background: KIND_COLORS[entry.kind] ?? 'var(--text-muted)',
                  color: '#1a1a2e',
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {KIND_LABELS[entry.kind]}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{entry.name}</span>
                {isUnused && (
                  <span style={{ fontSize: 10, color: 'var(--accent)' }}>unused</span>
                )}
              </div>
              {entry.assignments.length > 0 && (
                <div style={{ marginLeft: 52, color: 'var(--badge-basic)', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>SET:</span>
                  {entry.assignments.map((ln, i) => (
                    <span key={ln}>
                      {i > 0 && ', '}
                      <span style={{ color: 'var(--badge-basic)' }}>{ln}</span>
                    </span>
                  ))}
                </div>
              )}
              {entry.reads.length > 0 && (
                <div style={{ marginLeft: 52, color: 'var(--text-secondary)', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>USE:</span>
                  {entry.reads.map((ln, i) => (
                    <span key={ln}>
                      {i > 0 && ', '}
                      {ln}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
