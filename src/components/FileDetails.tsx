import React from 'react';
import type { FileEntry } from '../api';

interface Props {
  entry: FileEntry;
  onViewHex: () => void;
}

export function FileDetails({ entry, onViewHex }: Props) {
  return (
    <div style={{
      padding: '10px 14px',
      background: 'var(--bg-surface)',
      borderTop: '1px solid var(--border)',
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 700 }}>{entry.filename.trim()}</span>
        <button
          onClick={onViewHex}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 11, padding: '3px 10px' }}
        >
          View Hex
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, color: 'var(--text-secondary)' }}>
        <span>Type: {entry.typeName}</span>
        <span>Size: {entry.size.toLocaleString()} bytes</span>
        {entry.isMemoryDump && <span style={{ color: 'var(--badge-dump)' }}>Memory Dump</span>}
        {entry.params.autostartLine > 0 && entry.params.autostartLine < 10000 && (
          <span>Autostart: {entry.params.autostartLine}</span>
        )}
        {entry.params.startAddr > 0 && entry.type === 'code' && (
          <span>Start: 0x{entry.params.startAddr.toString(16).toUpperCase().padStart(4, '0')}</span>
        )}
        {entry.params.varsOffset > 0 && entry.type === 'basic' && (
          <span>Vars offset: {entry.params.varsOffset}</span>
        )}
        {Object.entries(entry.metadata).map(([k, v]) => (
          <span key={k}>{k}: {v}</span>
        ))}
      </div>
    </div>
  );
}
