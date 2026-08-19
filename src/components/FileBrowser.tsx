import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api, DirEntry } from '../api';
import { isSupportedFile as isSupported } from '../../electron/parsers/supported-formats';

interface Props {
  onOpenFile: (filePath: string) => void;
  /** The currently-loaded disk file path, highlighted in the listing. */
  currentDiskPath?: string | null;
  /** Change this to force a re-listing — a folder's archived state moved. */
  refreshToken?: number;
}

const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 180;
const MAX_WIDTH = 450;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

/**
 * Rows surviving the "hide archived" toggle. A folder with new images since
 * it was marked stays visible — hiding it would bury the one case the mark is
 * meant to surface.
 */
export function visibleAfterHide(entries: DirEntry[], hideArchived: boolean): DirEntry[] {
  if (!hideArchived) return entries;
  return entries.filter((e) => !e.archived || e.archived.stale);
}

/** How a catalogue count reads at a glance: all done, part done, or none. */
function catalogTone(c: { archived: number; total: number }): 'done' | 'part' | 'none' {
  if (c.archived >= c.total) return 'done';
  return c.archived > 0 ? 'part' : 'none';
}

/** "Archived 4 Mar 2026" — the date a mark was made, for its tooltip. */
function formatMarkedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function FileBrowser({ onOpenFile, currentDiskPath, refreshToken }: Props) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [hideArchived, setHideArchived] = useState(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('hideArchived') === 'true',
  );
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DirEntry } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
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
  }, [currentPath, refreshToken, refreshTick]);

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

  useEffect(() => {
    localStorage.setItem('hideArchived', String(hideArchived));
  }, [hideArchived]);

  // Any click or Escape outside the menu dismisses it.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: DirEntry) => {
    // A folder can be flagged as processed; anything the catalogue knows
    // about can be marked archived. Everything else has no menu.
    if (!entry.isDirectory && !entry.catalog) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  /**
   * Mark everything the catalogue knows about here. A program lives on more
   * than one disk, so this reaches every copy — which is the point, but worth
   * saying out loud before it happens.
   */
  const setCatalogArchived = useCallback(async (entry: DirEntry, archived: boolean) => {
    setMenu(null);
    const result = await api.setCatalogArchived(entry.path, entry.isDirectory, archived);
    if (!result) return;
    setEntries((prev) => prev.map((e) => (
      e.path === entry.path && e.catalog
        ? { ...e, catalog: { ...e.catalog, archived: archived ? e.catalog.total : 0 } }
        : e
    )));
    // Other rows can share programs with this one, so re-list rather than
    // guess which of them just changed.
    setRefreshTick((n) => n + 1);
  }, []);

  const toggleArchived = useCallback(async (entry: DirEntry) => {
    setMenu(null);
    const next = await api.setFolderArchived(entry.path, !entry.archived);
    // Patch the one row rather than re-listing: a re-list would also reset the
    // selection, and nothing else in the folder changed.
    setEntries((prev) => prev.map((e) => (e.path === entry.path ? { ...e, archived: next } : e)));
  }, []);

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

  const visibleEntries = visibleAfterHide(entries, hideArchived);
  const hiddenCount = entries.length - visibleEntries.length;

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
          <button
            onClick={() => setHideArchived((v) => !v)}
            style={{
              background: hideArchived ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: hideArchived ? '#fff' : 'var(--text-secondary)',
              fontSize: 10,
              padding: '2px 6px',
              marginLeft: 'auto',
            }}
            title={hideArchived
              ? 'Archived folders hidden \u2014 click to show them'
              : 'Hide folders marked as archived'}
          >
            {hideArchived ? '\u2713 hidden' : '\u2713'}
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
          {!loading && visibleEntries.map((entry) => {
            const supported = isSupported(entry.name);
            const isSelected = selectedPath === entry.path;
            const isCurrentDisk = !!currentDiskPath && currentDiskPath === entry.path;
            const bg = isCurrentDisk ? 'var(--accent)' : isSelected ? 'var(--row-selected)' : 'transparent';
            const fg = isCurrentDisk ? '#fff' : 'inherit';
            const archived = entry.archived;
            // A stale folder is not dimmed: it is the one that still wants work.
            const settled = !!archived && !archived.stale;

            return (
              <div
                key={entry.path}
                onClick={() => handleItemClick(entry)}
                onDoubleClick={() => handleItemDoubleClick(entry)}
                onContextMenu={(e) => handleContextMenu(e, entry)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '3px 8px',
                  fontSize: 11,
                  cursor: entry.isDirectory || supported ? 'pointer' : 'default',
                  background: bg,
                  color: fg,
                  fontWeight: isCurrentDisk ? 600 : 400,
                  opacity: !entry.isDirectory && !supported ? 0.4 : settled ? 0.55 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected && !isCurrentDisk) (e.currentTarget as HTMLElement).style.background = 'var(--row-hover)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = bg;
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
                  color: isCurrentDisk
                    ? '#fff'
                    : entry.isDirectory
                      ? 'var(--text-primary)'
                      : supported
                        ? 'var(--badge-basic)'
                        : 'var(--text-muted)',
                  fontWeight: isCurrentDisk || supported ? 600 : 400,
                }}>
                  {entry.name}
                </span>

                {/* Archived mark */}
                {archived && (
                  <span
                    title={archived.stale
                      ? `Archived ${formatMarkedAt(archived.markedAt)} with ${archived.imageCount} image(s); ${archived.currentCount - archived.imageCount} added since`
                      : `Archived ${formatMarkedAt(archived.markedAt)}`
                        + (archived.external ? ' (recorded in app settings — folder not writable)' : '')}
                    style={{
                      fontSize: 10,
                      marginLeft: 6,
                      flexShrink: 0,
                      fontFamily: 'monospace',
                      color: archived.stale ? 'var(--badge-dir)' : 'var(--badge-basic)',
                    }}
                  >
                    {archived.stale ? `✓+${archived.currentCount - archived.imageCount}` : '✓'}
                  </span>
                )}

                {/* How much of this is already archived */}
                {entry.catalog && (
                  <span
                    title={`${entry.catalog.archived} of ${entry.catalog.total} program(s) here are archived`
                      + `\n  ${entry.catalog.marked} marked by you`
                      + `\n  ${entry.catalog.matched} matched to the archive by name (a guess)`}
                    style={{
                      fontSize: 10,
                      marginLeft: 6,
                      flexShrink: 0,
                      fontFamily: 'monospace',
                      color: isCurrentDisk ? 'rgba(255,255,255,0.9)'
                        : catalogTone(entry.catalog) === 'done' ? 'var(--badge-basic)'
                          : catalogTone(entry.catalog) === 'part' ? 'var(--badge-dir)'
                            : 'var(--text-muted)',
                    }}
                  >
                    {entry.catalog.archived}/{entry.catalog.total}
                  </span>
                )}

                {/* Size */}
                {!entry.isDirectory && (
                  <span style={{
                    fontSize: 10,
                    color: isCurrentDisk ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)',
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
          {!loading && hiddenCount > 0 && (
            <div style={{ padding: '6px 12px', color: 'var(--text-muted)', fontSize: 10, fontStyle: 'italic' }}>
              {hiddenCount} archived folder{hiddenCount === 1 ? '' : 's'} hidden
            </div>
          )}
        </div>
      </div>

      {/* Folder context menu */}
      {menu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 1200,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: 4,
            minWidth: 170,
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}
        >
          {menu.entry.catalog && (
            <>
              <button
                onClick={() => setCatalogArchived(menu.entry, true)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                  color: 'var(--text-primary)', fontSize: 11, padding: '5px 10px',
                }}
              >
                Mark {menu.entry.catalog.total} program(s) archived
              </button>
              {menu.entry.catalog.archived > 0 && (
                <button
                  onClick={() => setCatalogArchived(menu.entry, false)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                    color: 'var(--text-secondary)', fontSize: 11, padding: '5px 10px',
                  }}
                >
                  Unmark them
                </button>
              )}
              <div style={{ padding: '2px 10px 5px', fontSize: 10, color: 'var(--text-muted)' }}>
                Reaches every copy, on every disk
              </div>
              {menu.entry.isDirectory && (
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              )}
            </>
          )}
          {menu.entry.isDirectory && (
          <button
            onClick={() => toggleArchived(menu.entry)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 11,
              padding: '5px 10px',
            }}
          >
            {menu.entry.archived ? 'Unmark folder as done' : 'Mark folder as done'}
          </button>
          )}
          {menu.entry.archived?.stale && (
            <div style={{ padding: '2px 10px 5px', fontSize: 10, color: 'var(--badge-dir)' }}>
              {menu.entry.archived.currentCount - menu.entry.archived.imageCount} new image(s) since
            </div>
          )}
        </div>
      )}

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
