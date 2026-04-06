import React from 'react';
import type { BasicListing as BasicListingData } from '../api';

interface Props {
  listing: BasicListingData;
}

const TOKEN_COLORS: Record<string, string> = {
  statement: 'var(--badge-basic)',
  function: '#fce38a',
  operator: '#f0a050',
  'disk-cmd': '#ff6b6b',
  'ts2068-kw': '#c084fc',
  udg: '#ff6b6b',
  graphic: '#a0a0b0',
  text: 'var(--text-primary)',
};

export function BasicListing({ listing }: Props) {
  const maxLineNum = listing.lines.length > 0
    ? Math.max(...listing.lines.map((l) => l.lineNumber))
    : 0;
  const lineNumWidth = String(maxLineNum).length;

  return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      padding: '8px 0',
      fontFamily: 'monospace',
      fontSize: 12,
      lineHeight: '20px',
      background: 'var(--bg-primary)',
    }}>
      {listing.lines.map((line) => (
        <div
          key={line.lineNumber}
          style={{
            display: 'flex',
            padding: '0 12px',
            background: listing.autostartLine === line.lineNumber
              ? 'rgba(233, 69, 96, 0.12)'
              : 'transparent',
          }}
        >
          <span style={{
            color: 'var(--text-muted)',
            minWidth: lineNumWidth * 8 + 16,
            textAlign: 'right',
            paddingRight: 16,
            userSelect: 'none',
            flexShrink: 0,
          }}>
            {listing.autostartLine === line.lineNumber && (
              <span style={{ color: 'var(--accent)', marginRight: 4 }}>{'\u25B6'}</span>
            )}
            {String(line.lineNumber).padStart(lineNumWidth, ' ')}
          </span>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {line.tokens.map((tok, i) => (
              <span key={i} style={{
                color: TOKEN_COLORS[tok.type] ?? 'var(--text-primary)',
                ...(tok.type === 'disk-cmd' ? {
                  background: 'rgba(255, 107, 107, 0.15)',
                  borderBottom: '1px solid #ff6b6b',
                  borderRadius: 2,
                  padding: '0 2px',
                } : {}),
              }}>
                {tok.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
