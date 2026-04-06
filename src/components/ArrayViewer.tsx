import React from 'react';
import type { ArrayData } from '../api';

interface Props {
  data: ArrayData;
}

export function ArrayViewer({ data }: Props) {
  return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      padding: 12,
      fontFamily: 'monospace',
      fontSize: 12,
      background: 'var(--bg-primary)',
    }}>
      <div style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>
        <span style={{ fontWeight: 600, color: 'var(--badge-data)' }}>
          {data.kind === 'numeric' ? 'Numeric' : 'Character'} Array
        </span>
        <span style={{ marginLeft: 12 }}>
          Dimensions: ({data.dimensions.join(' \u00D7 ')})
        </span>
        {data.kind === 'char' && (
          <span style={{ marginLeft: 12 }}>
            String length: {data.stringLength}
          </span>
        )}
      </div>

      {data.kind === 'numeric' ? (
        <NumericGrid values={data.values} dimensions={data.dimensions} />
      ) : (
        <CharList values={data.values} />
      )}
    </div>
  );
}

function NumericGrid({ values, dimensions }: { values: number[]; dimensions: number[] }) {
  // For 1D arrays, show as a simple list. For 2D, show as a table.
  const cols = dimensions.length >= 2 ? dimensions[dimensions.length - 1] : 1;
  const rows = Math.ceil(values.length / cols);

  if (cols === 1) {
    return (
      <div>
        {values.map((v, i) => (
          <div key={i} style={{ padding: '1px 0', display: 'flex', gap: 12 }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>[{i}]</span>
            <span style={{ color: 'var(--text-primary)' }}>{formatNumber(v)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <table style={{ borderCollapse: 'collapse' }}>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            <td style={{
              color: 'var(--text-muted)',
              paddingRight: 12,
              textAlign: 'right',
              userSelect: 'none',
            }}>
              [{r}]
            </td>
            {Array.from({ length: cols }, (_, c) => {
              const idx = r * cols + c;
              return (
                <td key={c} style={{
                  padding: '1px 8px',
                  textAlign: 'right',
                  color: 'var(--text-primary)',
                }}>
                  {idx < values.length ? formatNumber(values[idx]) : ''}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CharList({ values }: { values: string[] }) {
  return (
    <div>
      {values.map((s, i) => (
        <div key={i} style={{ padding: '1px 0', display: 'flex', gap: 12 }}>
          <span style={{ color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>[{i}]</span>
          <span style={{ color: 'var(--badge-basic)' }}>"{s}"</span>
        </div>
      ))}
    </div>
  );
}

function formatNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  // Show reasonable precision
  const s = v.toPrecision(10);
  // Trim trailing zeros after decimal
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
