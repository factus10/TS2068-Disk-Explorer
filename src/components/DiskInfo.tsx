import React from 'react';
import type { DiskHeader } from '../api';

interface Props {
  header: DiskHeader;
  path: string;
}

export function DiskInfo({ header, path }: Props) {
  const filename = path.split('/').pop() ?? path.split('\\').pop() ?? path;

  return (
    <div style={{
      padding: '10px 14px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{filename}</span>
        <span style={{
          fontSize: 11,
          padding: '1px 8px',
          borderRadius: 10,
          background: 'var(--accent)',
          color: '#fff',
          fontWeight: 600,
        }}>
          {header.formatName}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 16 }}>
        {header.diskName && <span>Label: {header.diskName}</span>}
        {header.tracks > 0 && <span>Tracks: {header.tracks}</span>}
        {header.sides > 0 && <span>Sides: {header.sides}</span>}
        {Object.entries(header.extra).map(([k, v]) => (
          <span key={k}>{k}: {v}</span>
        ))}
      </div>
    </div>
  );
}
