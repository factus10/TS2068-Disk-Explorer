import React, { useMemo, useState } from 'react';
import type { FileEntry } from '../api';

interface Props {
  entries: FileEntry[];
  totalBlocks: number;
}

// Color palette for files (cycle through these)
const FILE_COLORS = [
  '#4ecdc4', '#ff6b6b', '#fce38a', '#95e1d3', '#f38181',
  '#aa96da', '#fcbad3', '#a8d8ea', '#f0a050', '#c084fc',
  '#88d8b0', '#ff9a76', '#679b9b', '#e8a87c', '#41b3a3',
  '#d63384', '#6f42c1', '#0dcaf0', '#198754', '#fd7e14',
];

export function DiskMap({ entries, totalBlocks }: Props) {
  const [hoverBlock, setHoverBlock] = useState<number | null>(null);

  // Build block → file mapping
  const { blockMap, fileColors, legend } = useMemo(() => {
    const map = new Map<number, { filename: string; colorIdx: number }>();
    const colors = new Map<number, string>(); // entryIndex → color
    const legendItems: { name: string; color: string }[] = [];

    let colorIdx = 0;
    const flat: FileEntry[] = [];
    for (const e of entries) {
      flat.push(e);
      if (e.children) flat.push(...e.children);
    }

    for (const entry of flat) {
      if (entry.blocks.length === 0) continue;
      const color = FILE_COLORS[colorIdx % FILE_COLORS.length];
      colors.set(entry.index, color);
      legendItems.push({ name: entry.filename.trim(), color });

      for (const block of entry.blocks) {
        map.set(block, { filename: entry.filename.trim(), colorIdx });
      }
      colorIdx++;
    }

    return { blockMap: map, fileColors: colors, legend: legendItems };
  }, [entries]);

  const cols = Math.min(32, totalBlocks);
  const rows = Math.ceil(totalBlocks / cols);
  const cellSize = 14;

  const hoverInfo = hoverBlock !== null ? blockMap.get(hoverBlock) : null;

  return (
    <div style={{
      padding: '10px 14px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>
          Disk Map
          <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
            {totalBlocks} blocks ({blockMap.size} used, {totalBlocks - blockMap.size} free)
          </span>
        </span>
        {hoverInfo && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Block {hoverBlock}: <span style={{ fontWeight: 600 }}>{hoverInfo.filename}</span>
          </span>
        )}
        {hoverBlock !== null && !hoverInfo && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Block {hoverBlock}: free
          </span>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gap: 1,
        marginBottom: 8,
      }}>
        {Array.from({ length: totalBlocks }, (_, i) => {
          const info = blockMap.get(i);
          const color = info
            ? FILE_COLORS[info.colorIdx % FILE_COLORS.length]
            : 'var(--bg-tertiary)';

          return (
            <div
              key={i}
              onMouseEnter={() => setHoverBlock(i)}
              onMouseLeave={() => setHoverBlock(null)}
              style={{
                width: cellSize,
                height: cellSize,
                background: color,
                borderRadius: 2,
                opacity: hoverBlock !== null && info?.colorIdx !== blockMap.get(hoverBlock)?.colorIdx ? 0.4 : 1,
                cursor: 'default',
                transition: 'opacity 0.1s',
              }}
              title={info ? `Block ${i}: ${info.filename}` : `Block ${i}: free`}
            />
          );
        })}
      </div>

      {/* Compact legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 10, color: 'var(--text-secondary)' }}>
        {legend.slice(0, 20).map((item) => (
          <span key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, background: item.color, borderRadius: 2, flexShrink: 0 }} />
            {item.name}
          </span>
        ))}
        {legend.length > 20 && <span>+{legend.length - 20} more</span>}
      </div>
    </div>
  );
}
