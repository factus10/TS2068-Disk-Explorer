import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api, Insights, TodoEntry, FolderStat } from '../api';

interface Props {
  onClose: () => void;
  onStatus: (message: string) => void;
  /** Take the file browser to a folder, so a finding can be acted on. */
  onBrowseTo: (absolutePath: string) => void;
  onChanged: () => void;
}

type Tab = 'todo' | 'folders';

/**
 * What browsing cannot tell you: what is rarest and still unarchived, and
 * which folders hold material that exists nowhere else.
 *
 * Both are orderings rather than lists — the value is in what comes first, so
 * the top of each is what the window is for.
 */
export function CatalogInsights({ onClose, onStatus, onBrowseTo, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('todo');
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getCatalogInsights()
      .then((d) => { if (!d) setError('No catalogue is set. Choose one in Preferences first.'); else setData(d); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = filter.trim().toLowerCase();
  const todo = useMemo(() => {
    if (!data) return [];
    return q
      ? data.todo.filter((t) => (t.title + ' ' + t.clue + ' ' + t.foundIn.join(' ')).toLowerCase().includes(q))
      : data.todo;
  }, [data, q]);
  const folders = useMemo(() => {
    if (!data) return [];
    return q ? data.folders.filter((f) => f.folder.toLowerCase().includes(q)) : data.folders;
  }, [data, q]);

  // Rendering seven thousand rows would cost more than it tells anyone; the
  // ordering is the point, so the head of it is what gets drawn.
  const LIMIT = 300;
  const shownTodo = todo.slice(0, LIMIT);
  const shownFolders = folders.slice(0, LIMIT);

  const markPicked = useCallback(async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const r = await api.markProgramsArchived([...picked]);
      onStatus(`Marked ${r?.changed ?? 0} program(s) archived`);
      setPicked(new Set());
      onChanged();
      load();
    } catch (e: any) {
      onStatus(`Error: ${e.message}`);
    }
    setBusy(false);
  }, [picked, onStatus, onChanged, load]);

  const th: React.CSSProperties = {
    textAlign: 'left', borderBottom: '2px solid var(--border)', padding: '5px 8px',
    position: 'sticky', top: 0, background: 'var(--bg-surface)', fontSize: 11,
  };
  const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--border)', fontSize: 11 };
  const num: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: 'monospace' };
  const btn: React.CSSProperties = {
    background: 'var(--bg-tertiary)', color: 'var(--text-primary)', padding: '5px 12px', fontSize: 12,
  };
  const tabBtn = (t: Tab): React.CSSProperties => ({
    ...btn,
    background: tab === t ? 'var(--accent)' : 'var(--bg-tertiary)',
    color: tab === t ? '#fff' : 'var(--text-secondary)',
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
        alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
          padding: 20, width: 900, maxWidth: '92vw', height: '82vh',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            Catalogue insights
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btn}>Close</button>
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--accent)' }}>{error}</div>}
        {!error && !data && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Reading the catalogue...</div>}

        {data && (
          <>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <button style={tabBtn('todo')} onClick={() => setTab('todo')}>
                Still to archive ({data.todo.length.toLocaleString()})
              </button>
              <button style={tabBtn('folders')} onClick={() => setTab('folders')}>
                Folders ({data.folders.length})
              </button>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={tab === 'todo' ? 'filter by title, folder or text' : 'filter by folder'}
                style={{
                  flex: 1, minWidth: 180, fontSize: 11, padding: '5px 8px',
                  background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', borderRadius: 4,
                }}
              />
              {tab === 'todo' && picked.size > 0 && (
                <button
                  onClick={markPicked}
                  disabled={busy}
                  style={{ ...btn, background: 'var(--accent)', color: '#fff' }}
                >
                  Mark {picked.size} archived
                </button>
              )}
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {tab === 'todo'
                ? 'Rarest first — fewest folders, then fewest copies. A program in one folder disappears with that disk.'
                : 'Sorted by how much exists nowhere else. These are the disks to reach for first.'}
            </div>

            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
              {tab === 'todo' ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 24 }} />
                      <th style={th}>Program</th>
                      <th style={th}>Kind</th>
                      <th style={{ ...th, textAlign: 'right' }}>Folders</th>
                      <th style={{ ...th, textAlign: 'right' }}>Copies</th>
                      <th style={th}>Found in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownTodo.map((t: TodoEntry) => (
                      <tr key={t.id}>
                        <td style={td}>
                          <input
                            type="checkbox"
                            checked={picked.has(t.id)}
                            onChange={(e) => setPicked((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(t.id); else next.delete(t.id);
                              return next;
                            })}
                          />
                        </td>
                        <td style={td}>
                          <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t.title}</div>
                          {t.clue && (
                            <div style={{
                              color: 'var(--text-muted)', fontSize: 10, maxWidth: 320,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {t.clue}
                            </div>
                          )}
                        </td>
                        <td style={td}>
                          <span style={{
                            fontSize: 10, padding: '1px 5px', borderRadius: 3,
                            border: '1px solid var(--border)', color: 'var(--text-secondary)',
                          }}>
                            {t.kind}
                          </span>
                        </td>
                        <td style={{ ...num, color: t.folders === 1 ? 'var(--accent)' : 'var(--text-secondary)' }}>
                          {t.folders}
                        </td>
                        <td style={num}>{t.copies}</td>
                        <td style={td}>
                          {t.foundIn.map((f) => (
                            <div key={f}>
                              <a
                                href="#"
                                onClick={(e) => { e.preventDefault(); onBrowseTo(`${data.root}/${f}`); onClose(); }}
                                style={{ color: 'var(--badge-basic)', textDecoration: 'none' }}
                              >
                                {f}
                              </a>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Folder</th>
                      <th style={{ ...th, textAlign: 'right' }}>Nowhere else</th>
                      <th style={{ ...th, textAlign: 'right' }}>Programs</th>
                      <th style={{ ...th, textAlign: 'right' }}>Entries</th>
                      <th style={{ ...th, textAlign: 'right' }}>Archived</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownFolders.map((f: FolderStat) => (
                      <tr key={f.folder}>
                        <td style={td}>
                          <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); onBrowseTo(`${data.root}/${f.folder}`); onClose(); }}
                            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                          >
                            {f.folder}
                          </a>
                        </td>
                        <td style={{ ...num, color: 'var(--accent)', fontWeight: 700 }}>{f.onlyHere}</td>
                        <td style={num}>{f.programs}</td>
                        <td style={num}>{f.entries}</td>
                        <td style={{
                          ...num,
                          color: f.archived >= f.programs ? 'var(--badge-basic)'
                            : f.archived > 0 ? 'var(--badge-dir)' : 'var(--text-muted)',
                        }}>
                          {f.archived}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {tab === 'todo'
                ? `showing ${shownTodo.length.toLocaleString()} of ${todo.length.toLocaleString()}`
                : `showing ${shownFolders.length} of ${folders.length}`}
              {' · '}{data.archived.toLocaleString()} of {data.programs.toLocaleString()} programs archived
            </div>
          </>
        )}
      </div>
    </div>
  );
}
