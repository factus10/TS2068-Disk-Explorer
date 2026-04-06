import React from 'react';

interface Props {
  data: number[];
}

export function HexView({ data }: Props) {
  const rows: React.ReactNode[] = [];
  const bytesPerRow = 16;
  const maxRows = Math.min(Math.ceil(data.length / bytesPerRow), 256);

  for (let row = 0; row < maxRows; row++) {
    const offset = row * bytesPerRow;
    const hex: string[] = [];
    const ascii: string[] = [];

    for (let i = 0; i < bytesPerRow; i++) {
      const idx = offset + i;
      if (idx < data.length) {
        hex.push(data[idx].toString(16).padStart(2, '0'));
        const ch = data[idx];
        ascii.push(ch >= 0x20 && ch < 0x7f ? String.fromCharCode(ch) : '.');
      } else {
        hex.push('  ');
        ascii.push(' ');
      }
    }

    rows.push(
      <div key={row} style={{ display: 'flex', gap: 12, lineHeight: '18px' }}>
        <span style={{ color: 'var(--text-muted)', width: 56, textAlign: 'right' }}>
          {offset.toString(16).padStart(6, '0')}
        </span>
        <span style={{ color: 'var(--text-secondary)', letterSpacing: 1 }}>
          {hex.slice(0, 8).join(' ')}  {hex.slice(8).join(' ')}
        </span>
        <span style={{ color: 'var(--badge-basic)' }}>
          {ascii.join('')}
        </span>
      </div>,
    );
  }

  return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      padding: '8px 12px',
      fontFamily: 'monospace',
      fontSize: 11,
      background: 'var(--bg-primary)',
      whiteSpace: 'pre',
    }}>
      {rows}
      {data.length > maxRows * bytesPerRow && (
        <div style={{ color: 'var(--text-muted)', marginTop: 8 }}>
          ... {(data.length - maxRows * bytesPerRow).toLocaleString()} more bytes
        </div>
      )}
    </div>
  );
}
