import React from 'react';
import type { FileEntry, TapPackage } from '../api';

interface Props {
  entry: FileEntry;
  onViewHex: () => void;
  tapPackage?: TapPackage | null;
}

export function FileDetails({ entry, onViewHex, tapPackage }: Props) {
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
          View
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
      {tapPackage && (
        <div style={{ marginTop: 6, color: 'var(--accent)' }}>
          <span style={{ fontWeight: 600 }}>Loads: </span>
          {tapPackage.dependencies.map((dep, i) => (
            <span key={dep.index}>
              {i > 0 && ', '}
              <span style={{ fontWeight: 700 }}>{dep.filename.trim()}</span>
              <span style={{ color: 'var(--text-secondary)', marginLeft: 3 }}>
                ({dep.typeName})
              </span>
            </span>
          ))}
          {tapPackage.unresolved.length > 0 && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
              + {tapPackage.unresolved.length} unresolved
            </span>
          )}
        </div>
      )}
    </div>
  );
}
