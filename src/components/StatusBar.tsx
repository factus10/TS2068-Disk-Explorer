import React from 'react';

interface Props {
  message: string;
  format?: string;
  fileCount?: number;
}

const FORMAT_LABELS: Record<string, string> = {
  'larken': 'Larken (LKDOS)',
  'oliger-v1': 'Oliger V1',
  'oliger-v2': 'Oliger V2',
  'aerco-dos64': 'Aerco DOS-64',
  'aerco-rpm': 'Aerco RP/M',
  'zebra-dirscp': 'Zebra DIRSCP',
  'zebra-cpm': 'Zebra CP/M',
  'ql': 'Sinclair QL',
};

export function StatusBar({ message, format, fileCount }: Props) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '4px 14px',
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border)',
      fontSize: 11,
      color: 'var(--text-muted)',
    }}>
      <span>{message}</span>
      <div style={{ display: 'flex', gap: 16 }}>
        {format && <span>{FORMAT_LABELS[format] ?? format}</span>}
        {fileCount !== undefined && <span>{fileCount} file(s)</span>}
      </div>
    </div>
  );
}
