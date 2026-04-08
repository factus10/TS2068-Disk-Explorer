import React, { useState, useCallback } from 'react';
import type { BasicVariable } from '../api';

interface Props {
  variables: BasicVariable[];
}

const KIND_COLORS: Record<string, string> = {
  'number': 'var(--badge-basic)',
  'string': '#fce38a',
  'number-array': 'var(--badge-code)',
  'string-array': '#f0a050',
  'for': 'var(--badge-dump)',
};

export function VariableViewer({ variables }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const plainText = variables.map((v) => {
    let line = `${v.name} (${v.kind})`;
    if (v.value !== undefined) line += ` = ${v.value}`;
    if (v.kind === 'for') line += ` = ${v.forValue}, limit=${v.forLimit}, step=${v.forStep}, line=${v.forLine}`;
    if (v.values) line += ` [${v.values.join(', ')}]`;
    return line;
  }).join('\n');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(plainText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [plainText]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '4px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {variables.length} variable{variables.length !== 1 ? 's' : ''}
        </span>
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
        lineHeight: '22px',
        background: 'var(--bg-primary)',
      }}>
        {variables.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>No variables</div>
        )}
        {variables.map((v, idx) => {
          const hasChildren = (v.kind === 'number-array' || v.kind === 'string-array') && v.values && v.values.length > 0;
          const isExpanded = expanded.has(idx);

          return (
            <div key={idx}>
              <div
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', cursor: hasChildren ? 'pointer' : 'default' }}
                onClick={() => hasChildren && toggleExpand(idx)}
              >
                {hasChildren && (
                  <span style={{ fontSize: 10, userSelect: 'none', width: 10 }}>
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>
                )}
                {!hasChildren && <span style={{ width: 10 }} />}
                <span style={{
                  fontSize: 10,
                  padding: '0 6px',
                  borderRadius: 6,
                  background: KIND_COLORS[v.kind] ?? 'var(--text-muted)',
                  color: '#1a1a2e',
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {v.kind === 'for' ? 'FOR' : v.kind === 'number' ? 'NUM' : v.kind === 'string' ? 'STR' : v.kind === 'number-array' ? 'NUM()' : 'STR$()'}
                </span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{v.name}</span>
                {v.value !== undefined && (
                  <span style={{ color: 'var(--text-secondary)' }}>= {v.value}</span>
                )}
                {v.kind === 'for' && (
                  <span style={{ color: 'var(--text-secondary)' }}>
                    = {v.forValue}, limit {v.forLimit}, step {v.forStep}, line {v.forLine}
                  </span>
                )}
                {hasChildren && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                    ({v.dimensions?.join(' \u00D7 ')}) {v.values!.length} values
                  </span>
                )}
              </div>
              {hasChildren && isExpanded && (
                <div style={{ paddingLeft: 40, color: 'var(--text-secondary)' }}>
                  {v.values!.map((val, i) => (
                    <div key={i}>
                      <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>[{i}]</span>
                      {val}
                    </div>
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
