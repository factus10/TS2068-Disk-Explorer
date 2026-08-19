import React, { useState, useMemo, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { FileEntry, TapPackage, EditState } from '../api';

export interface FileTableHandle {
  visibleRowIndices: number[];
  toggleExpand: (index: number) => void;
  focus: () => void;
}

interface Props {
  entries: FileEntry[];
  selectedIndices: Set<number>;
  onSelect: (index: number, multi: boolean, shift?: boolean) => void;
  onViewHex: (entry: FileEntry) => void;
  packages: TapPackage[];
  manualLoaderIndices: Set<number>;
  onCreatePackage: (targetIndex: number, draggedIndex: number) => void;
  onAddToPackage: (loaderIndex: number, draggedIndex: number, insertBeforeIndex?: number) => void;
  onReorderInPackage: (loaderIndex: number, draggedIndex: number, insertBeforeIndex?: number) => void;
  onRemoveFromPackage: (loaderIndex: number, entryIndex: number) => void;
  editedIndices: EditState;
  searchQuery: string;
  /** Per entry index: archived by your mark, or matched to the archive by name. */
  archiveStatus?: Record<number, 'marked' | 'matched'> | null;
}

type SortKey = 'index' | 'filename' | 'typeName' | 'size';
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

export const FileTable = forwardRef<FileTableHandle, Props>(function FileTable({
  entries, selectedIndices, onSelect, onViewHex, packages,
  manualLoaderIndices, onCreatePackage, onAddToPackage, onReorderInPackage, onRemoveFromPackage,
  archiveStatus,
  editedIndices, searchQuery,
}, ref) {
  const [sortKey, setSortKey] = useState<SortKey>('index');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const tableRef = useRef<HTMLDivElement>(null);

  // Drag-and-drop state
  const dragIndex = useRef<number | null>(null);
  const dragSourcePkg = useRef<number | null>(null); // loader index if dragging from within a package
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<'on' | 'before' | null>(null);

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

  // Map dependency index → its loader index (for drag source tracking)
  const depToLoader = useMemo(() => {
    const map = new Map<number, number>();
    for (const pkg of packages) {
      for (const dep of pkg.dependencies) map.set(dep.index, pkg.loader.index);
    }
    return map;
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
    if (sortKey === 'index') {
      cmp = a.index - b.index;
    } else if (sortKey === 'size') {
      cmp = a.size - b.size;
    } else {
      cmp = a[sortKey].localeCompare(b[sortKey]);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Apply search filter
  const filteredEntries = searchQuery
    ? sortedEntries.filter((e) => e.filename.toLowerCase().includes(searchQuery.toLowerCase()))
    : sortedEntries;

  // Build visible row index list (for keyboard navigation)
  const visibleRowIndices = useMemo(() => {
    const indices: number[] = [];
    for (const entry of filteredEntries) {
      if (isDependency.has(entry.index)) continue;
      indices.push(entry.index);
      const pkg = packageByLoader.get(entry.index);
      if (pkg && expanded.has(entry.index)) {
        for (const dep of pkg.dependencies) indices.push(dep.index);
      }
      if (entry.isDirectory && entry.children && expanded.has(entry.index)) {
        for (const child of entry.children) indices.push(child.index);
      }
    }
    return indices;
  }, [filteredEntries, isDependency, packageByLoader, expanded]);

  // Expose handle for keyboard navigation
  useImperativeHandle(ref, () => ({
    visibleRowIndices,
    toggleExpand,
    focus: () => tableRef.current?.focus(),
  }));

  const toggleExpand = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, entry: FileEntry, loaderIdx: number | null) => {
    dragIndex.current = entry.index;
    dragSourcePkg.current = loaderIdx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(entry.index));
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '';
    dragIndex.current = null;
    dragSourcePkg.current = null;
    setDropTarget(null);
    setDropPosition(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, entryIndex: number, isDepRow: boolean, loaderIdx: number | null) => {
    // Only handle internal row drags, not external file drops from the OS
    if (dragIndex.current === null) return;
    e.preventDefault();
    if (dragIndex.current === entryIndex) return;

    // Determine drop position: 'on' for creating/adding, 'before' for reordering
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const isTopHalf = y < rect.height / 2;

    if (isDepRow && loaderIdx !== null) {
      // Hovering over a dependency row in a package → show reorder indicator
      setDropTarget(entryIndex);
      setDropPosition(isTopHalf ? 'before' : 'on');
      e.dataTransfer.dropEffect = 'move';
    } else {
      // Hovering over a top-level row → will create/add to package
      setDropTarget(entryIndex);
      setDropPosition('on');
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
    setDropPosition(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number, isDepRow: boolean, loaderIdx: number | null) => {
    // Only handle internal row drags
    const srcIndex = dragIndex.current;
    if (srcIndex === null) return;
    e.preventDefault();
    if (srcIndex === targetIndex) return;

    const srcPkg = dragSourcePkg.current;
    const targetPkg = loaderIdx; // the package this dep row belongs to

    if (isDepRow && targetPkg !== null && manualLoaderIndices.has(targetPkg)) {
      // Dropping onto a dependency row in a manual package
      if (srcPkg === targetPkg) {
        // Reorder within same package
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const isTopHalf = e.clientY - rect.top < rect.height / 2;
        onReorderInPackage(targetPkg, srcIndex, isTopHalf ? targetIndex : undefined);
      } else {
        // Add from outside into this package at this position
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const isTopHalf = e.clientY - rect.top < rect.height / 2;
        onAddToPackage(targetPkg, srcIndex, isTopHalf ? targetIndex : undefined);
      }
    } else if (!isDepRow) {
      // Dropping onto a top-level row
      const targetIsLoader = packageByLoader.has(targetIndex);
      if (targetIsLoader && manualLoaderIndices.has(targetIndex)) {
        // Add to existing manual package
        onAddToPackage(targetIndex, srcIndex);
      } else {
        // Create new manual package
        onCreatePackage(targetIndex, srcIndex);
      }
    }

    setDropTarget(null);
    setDropPosition(null);
    dragIndex.current = null;
    dragSourcePkg.current = null;
  }, [manualLoaderIndices, packageByLoader, onCreatePackage, onAddToPackage, onReorderInPackage]);

  const renderRow = (entry: FileEntry, depth: number = 0, isDepRow: boolean = false, parentLoaderIdx: number | null = null) => {
    const isSelected = selectedIndices.has(entry.index);
    const hasChildren = entry.isDirectory && entry.children && entry.children.length > 0;
    const pkg = packageByLoader.get(entry.index);
    const hasPackage = !!pkg;
    const isExpandable = hasChildren || hasPackage;
    const isExpanded = expanded.has(entry.index);
    const isManualPkg = manualLoaderIndices.has(entry.index);
    const isManualDep = isDepRow && parentLoaderIdx !== null && manualLoaderIndices.has(parentLoaderIdx);
    const isDragTarget = dropTarget === entry.index;

    // Drop target styling
    let dropStyle: React.CSSProperties = {};
    if (isDragTarget && dropPosition === 'on') {
      dropStyle = { outline: '2px solid var(--accent)', outlineOffset: -2 };
    } else if (isDragTarget && dropPosition === 'before') {
      dropStyle = { borderTop: '2px solid var(--accent)' };
    }

    return (
      <React.Fragment key={`${entry.index}${isDepRow ? '-dep' : ''}`}>
        <tr
          draggable={!entry.isDirectory}
          onDragStart={(e) => handleDragStart(e, entry, isDepRow ? parentLoaderIdx : null)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, entry.index, isDepRow, parentLoaderIdx)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, entry.index, isDepRow, parentLoaderIdx)}
          onClick={(e) => onSelect(entry.index, e.metaKey || e.ctrlKey, e.shiftKey)}
          onDoubleClick={() => {
            if (isExpandable) toggleExpand(entry.index);
            else onViewHex(entry);
          }}
          style={{
            background: isSelected ? 'var(--row-selected)' : 'transparent',
            cursor: 'pointer',
            ...dropStyle,
          }}
          onMouseEnter={(e) => {
            if (!isSelected && !isDragTarget) (e.currentTarget as HTMLElement).style.background = 'var(--row-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--row-selected)' : 'transparent';
          }}
        >
          <td style={{
            paddingLeft: 14,
            paddingRight: 8,
            textAlign: 'right',
            color: 'var(--text-muted)',
            fontSize: 10,
            fontFamily: 'monospace',
            width: 36,
          }}>
            {isDepRow ? '' : entry.index + 1}
          </td>
          <td style={{ paddingLeft: 8 + depth * 20, whiteSpace: 'nowrap' }}>
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
            {entry.metadata?.Status && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  alert(`${entry.filename.trim()}\n\n${entry.metadata.Status}`);
                }}
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 8,
                  background: '#ff6b6b',
                  color: '#1a1a2e',
                  fontWeight: 700,
                  cursor: 'help',
                }}
                title={entry.metadata.Status}
              >
                ⚠ ISSUE
              </span>
            )}
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
            {editedIndices[entry.index] && Object.keys(editedIndices[entry.index]).length > 0 && (
              <span style={{
                marginLeft: 8,
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 8,
                background: 'var(--badge-basic)',
                color: '#1a1a2e',
                fontWeight: 700,
              }}>
                EDITED
              </span>
            )}
            {hasPackage && (
              <span style={{
                marginLeft: 8,
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 8,
                background: isManualPkg ? 'var(--badge-basic)' : 'var(--accent)',
                color: isManualPkg ? '#1a1a2e' : '#fff',
                fontWeight: 700,
              }}>
                {isManualPkg ? '\u270E ' : ''}PKG {pkg!.dependencies.length}
              </span>
            )}
            {isManualDep && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFromPackage(parentLoaderIdx!, entry.index);
                }}
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  padding: '0 5px',
                  borderRadius: 8,
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
                title="Remove from package"
              >
                {'\u2715'}
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
          <td style={{ textAlign: 'center', fontSize: 12 }}>
            {archiveStatus?.[entry.index] === 'marked' ? (
              <span title="You marked this archived" style={{ color: 'var(--badge-basic)' }}>{'\u2714'}</span>
            ) : archiveStatus?.[entry.index] === 'matched' ? (
              // Hollow, because a name match is a guess and should not read
              // like a decision you made.
              <span title="Matched to the archive by name — a guess, not your decision"
                style={{ color: 'var(--badge-dir)', opacity: 0.85 }}>{'\u2713'}</span>
            ) : null}
          </td>
        </tr>
        {hasChildren && isExpanded && entry.children!.map((child) => renderRow(child, depth + 1))}
        {hasPackage && isExpanded && pkg!.dependencies.map((dep) => renderRow(dep, depth + 1, true, entry.index))}
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
    <div ref={tableRef} tabIndex={0} style={{ outline: 'none', flex: 1 }}>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th
            style={{ ...headerStyle, paddingLeft: 14, width: 36, textAlign: 'right' }}
            onClick={() => handleSort('index')}
            title="Disk order — the original order files appear in the catalog. Click to keep tape-load order intact."
          >
            #{sortArrow('index')}
          </th>
          <th style={headerStyle} onClick={() => handleSort('filename')}>
            Name{sortArrow('filename')}
          </th>
          <th style={headerStyle} onClick={() => handleSort('typeName')}>
            Type{sortArrow('typeName')}
          </th>
          <th style={{ ...headerStyle, textAlign: 'right', paddingRight: 14 }} onClick={() => handleSort('size')}>
            Size{sortArrow('size')}
          </th>
          <th style={headerStyle}>Blocks</th>
          <th style={{ ...headerStyle, textAlign: 'center' }} title="Archived: a solid tick is your own mark, a hollow one a name match">
            Arch
          </th>
        </tr>
      </thead>
      <tbody>
        {filteredEntries.map((entry) =>
          isDependency.has(entry.index) ? null : renderRow(entry)
        )}
      </tbody>
    </table>
    </div>
  );
});
