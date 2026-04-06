import React, { useState, useMemo } from 'react';
import type { FileEntry, TapPackage } from '../api';

interface Props {
  entries: FileEntry[];
  selectedIndices: Set<number>;
  onSelect: (index: number, multi: boolean) => void;
  onViewHex: (entry: FileEntry) => void;
  packages: TapPackage[];
}

type SortKey = 'filename' | 'typeName' | 'size';
type SortDir = 'asc' | 'desc';

const TYPE_COLORS: Record<string, string> = {
  BASIC: 'var(--badge-basic)',
  CODE: 'var(--badge-code)',
  DATA: 'var(--badge-data)',
  EXEC: 'var(--badge-code)',
  MODULE: 'var(--badge-code)',
  DIR: 'var(--badge-dir)',
  'State capture': 'var(--badge-dump)',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

export function FileTable({ entries, selectedIndices, onSelect, onViewHex, packages }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('filename');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Build lookup maps for package relationships
  const packageByLoader = useMemo(() => {
    const map = new Map<number, TapPackage>();
    for (const pkg of packages) map.set(pkg.loader.index, pkg);
    return map;
  }, [packages]);

  const isDependency = useMemo(() => {
    const set = new Set<number>();
    for (const pkg of packages) {
      for (const dep of pkg.dependencies) set.add(dep.index);
    }
    return set;
  }, [packages]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedEntries = [...entries].sort((a, b) => {
    let cmp: number;
    if (sortKey === 'size') {
      cmp = a.size - b.size;
    } else {
      cmp = a[sortKey].localeCompare(b[sortKey]);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleExpand = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const renderRow = (entry: FileEntry, depth: number = 0, isDepRow: boolean = false) => {
    const isSelected = selectedIndices.has(entry.index);
    const hasChildren = entry.isDirectory && entry.children && entry.children.length > 0;
    const pkg = packageByLoader.get(entry.index);
    const hasPackage = !!pkg;
    const isExpandable = hasChildren || hasPackage;
    const isExpanded = expanded.has(entry.index);

    return (
      <React.Fragment key={`${entry.index}${isDepRow ? '-dep' : ''}`}>
        <tr
          onClick={(e) => onSelect(entry.index, e.metaKey || e.ctrlKey)}
          onDoubleClick={() => {
            if (isExpandable) toggleExpand(entry.index);
            else onViewHex(entry);
          }}
          style={{
            background: isSelected ? 'var(--row-selected)' : 'transparent',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--row-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--row-selected)' : 'transparent';
          }}
        >
          <td style={{ paddingLeft: 14 + depth * 20, whiteSpace: 'nowrap' }}>
            {isExpandable && (
              <span
                onClick={(e) => { e.stopPropagation(); toggleExpand(entry.index); }}
                style={{ marginRight: 6, fontSize: 10, userSelect: 'none' }}
              >
                {isExpanded ? '\u25BC' : '\u25B6'}
              </span>
            )}
            {isDepRow && (
              <span style={{ marginRight: 4, fontSize: 10, color: 'var(--text-muted)' }}>{'\u21B3'}</span>
            )}
            <span style={{ fontFamily: 'monospace' }}>
              {entry.filename.trim()}{entry.isDirectory ? '/' : ''}
            </span>
            {entry.isMemoryDump && (
              <span style={{
                marginLeft: 8,
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 8,
                background: 'var(--badge-dump)',
                color: '#1a1a2e',
                fontWeight: 700,
              }}>
                DUMP
              </span>
            )}
            {hasPackage && (
              <span style={{
                marginLeft: 8,
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 8,
                background: 'var(--accent)',
                color: '#fff',
                fontWeight: 700,
              }}>
                PKG {pkg!.dependencies.length}
              </span>
            )}
          </td>
          <td>
            <span style={{
              fontSize: 11,
              padding: '1px 8px',
              borderRadius: 8,
              background: TYPE_COLORS[entry.typeName] ?? 'var(--text-muted)',
              color: '#1a1a2e',
              fontWeight: 600,
            }}>
              {entry.typeName}
            </span>
          </td>
          <td style={{ textAlign: 'right', fontFamily: 'monospace', paddingRight: 14 }}>
            {entry.isDirectory ? '' : formatSize(entry.size)}
          </td>
          <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)' }}>
            {entry.blocks.length > 6
              ? `[${entry.blocks.slice(0, 6).join(', ')}, ...]`
              : `[${entry.blocks.join(', ')}]`}
          </td>
        </tr>
        {hasChildren && isExpanded && entry.children!.map((child) => renderRow(child, depth + 1))}
        {hasPackage && isExpanded && pkg!.dependencies.map((dep) => renderRow(dep, depth + 1, true))}
      </React.Fragment>
    );
  };

  const headerStyle: React.CSSProperties = {
    padding: '6px 8px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: 11,
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    userSelect: 'none',
    background: 'var(--bg-secondary)',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...headerStyle, paddingLeft: 14 }} onClick={() => handleSort('filename')}>
            Name{sortArrow('filename')}
          </th>
          <th style={headerStyle} onClick={() => handleSort('typeName')}>
            Type{sortArrow('typeName')}
          </th>
          <th style={{ ...headerStyle, textAlign: 'right', paddingRight: 14 }} onClick={() => handleSort('size')}>
            Size{sortArrow('size')}
          </th>
          <th style={headerStyle}>Blocks</th>
        </tr>
      </thead>
      <tbody>
        {sortedEntries.map((entry) =>
          isDependency.has(entry.index) ? null : renderRow(entry)
        )}
      </tbody>
    </table>
  );
}
