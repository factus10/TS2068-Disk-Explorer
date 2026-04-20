import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api, DirEntry } from '../api';

interface Props {
  onOpenFile: (filePath: string) => void;
}

const SUPPORTED_EXTENSIONS = new Set(['img', 'dsk', 'tap', 'tzx', 'sna', 'z80', 'scr', 'mgt', 'zip']);
const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 180;
const MAX_WIDTH = 450;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot + 1).toLowerCase() : '';
}

function isSupported(name: string): boolean {
  return SUPPORTED_EXTENSIONS.has(getExtension(name));
}

export function FileBrowser({ onOpenFile }: Props) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Initialize with home directory
  useEffect(() => {
    api.getHomeDirectory().then((home) => {
      setCurrentPath(home);
    });
  }, []);

  // Load directory listing when path changes
  useEffect(() => {
    if (!currentPath) return;
    let cancelled = false;
    setLoading(true);
    api.listDirectory(currentPath).then((items) => {
      if (!cancelled) {
        setEntries(items);
        setSelectedPath(null);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [currentPath]);

  const navigateTo = useCallback((dirPath: string) => {
    setCurrentPath(dirPath);
  }, []);

  const navigateUp = useCallback(() => {
    const parent = currentPath.replace(/[/\\][^/\\]*$/, '');
    if (parent && parent !== currentPath) {
      setCurrentPath(parent);
    }
  }, [currentPath]);

  const handleChooseFolder = useCallback(async () => {
    const dir = await api.selectDirectory();
    if (dir) setCurrentPath(dir);
  }, []);

  const handleItemClick = useCallback((entry: DirEntry) => {
    if (entry.isDirectory) {
      setSelectedPath(entry.path);
    } else if (isSupported(entry.name)) {
      onOpenFile(entry.path);
    }
  }, [onOpenFile]);

  const handleItemDoubleClick = useCallback((entry: DirEntry) => {
    if (entry.isDirectory) {
      navigateTo(entry.path);
    }
  }, [navigateTo]);

  // Resize handle
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX.current;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta)));
    };

    const handleMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  // Breadcrumb path segments
  const pathSegments = currentPath.split(/[/\\]/).filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width, flexShrink: 0 }}>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
      }}>
        {/* Header with navigation */}
        <div style={{
          padding: '6px 8px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 4,
          alignItems: 'center',
        }}>
          <button
            onClick={navigateUp}
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              fontSize: 11,
              padding: '2px 6px',
              minWidth: 24,
            }}
            title="Parent directory"
          >
            {'\u2191'}
          </button>
          <button
            onClick={handleChooseFolder}
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: 10,
              padding: '2px 6px',
            }}
            title="Choose folder..."
          >
            {'\uD83D\uDCC2'}
          </button>
          <button
            onClick={() => setCurrentPath(currentPath)} // refresh
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: 10,
              padding: '2px 6px',
            }}
            title="Refresh"
          >
            {'\u21BB'}
          </button>
        </div>

        {/* Breadcrumb path */}
        <div style={{
          padding: '4px 8px',
          fontSize: 10,
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0,
          lineHeight: '16px',
        }}>
          <span
            onClick={() => navigateTo('/')}
            style={{ cursor: 'pointer', padding: '0 2px' }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = ''; }}
          >
            /
          </span>
          {pathSegments.map((seg, i) => {
            const segPath = '/' + pathSegments.slice(0, i + 1).join('/');
            return (
              <span key={i}>
                <span
                  onClick={() => navigateTo(segPath)}
                  style={{ cursor: 'pointer', padding: '0 2px' }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--accent)'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.color = ''; }}
                >
                  {seg}
                </span>
                {i < pathSegments.length - 1 && <span style={{ opacity: 0.5 }}>/</span>}
              </span>
            );
          })}
        </div>

        {/* File listing */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>Loading...</div>
          )}
          {!loading && entries.map((entry) => {
            const ext = getExtension(entry.name);
            const supported = isSupported(entry.name);
            const isSelected = selectedPath === entry.path;

            return (
              <div
                key={entry.path}
                onClick={() => handleItemClick(entry)}
                onDoubleClick={() => handleItemDoubleClick(entry)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '3px 8px',
                  fontSize: 11,
                  cursor: entry.isDirectory || supported ? 'pointer' : 'default',
                  background: isSelected ? 'var(--row-selected)' : 'transparent',
                  opacity: !entry.isDirectory && !supported ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--row-hover)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--row-selected)' : 'transparent';
                }}
              >
                {/* Icon */}
                <span style={{ marginRight: 6, fontSize: 12, width: 16, textAlign: 'center', flexShrink: 0 }}>
                  {entry.isDirectory ? '\uD83D\uDCC1' : supported ? '\uD83D\uDCBE' : '\uD83D\uDCC4'}
                </span>

                {/* Name */}
                <span style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: entry.isDirectory
                    ? 'var(--text-primary)'
                    : supported
                      ? 'var(--badge-basic)'
                      : 'var(--text-muted)',
                  fontWeight: supported ? 600 : 400,
                }}>
                  {entry.name}
                </span>

                {/* Size */}
                {!entry.isDirectory && (
                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginLeft: 8,
                    flexShrink: 0,
                    fontFamily: 'monospace',
                  }}>
                    {formatSize(entry.size)}
                  </span>
                )}
              </div>
            );
          })}
          {!loading && entries.length === 0 && (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>Empty directory</div>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          width: 5,
          cursor: 'col-resize',
          background: 'var(--border)',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
        onMouseLeave={(e) => { if (!dragging.current) (e.currentTarget as HTMLElement).style.background = 'var(--border)'; }}
      />
    </div>
  );
}
