import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, WpHit, WpListingsStatus, WpSearchResult } from '../api';

interface Props {
  onClose: () => void;
  /** A name to open with, when the search was asked for from a selected file. */
  initialQuery?: string;
  /** Which search that opening name belongs in. */
  initialMode?: Mode;
}

type Mode = 'source' | 'name';

/**
 * Searching the published archive from inside the app.
 *
 * Two searches, because a disk gives you two kinds of clue and they fail in
 * opposite ways. A name is what you have first and is often no use — the disk
 * says `AUTOSTART`, or six unrelated programs share a title. A line of the
 * listing is the opposite: awkward to come by, and almost always decisive.
 * So the name search is the quick one and the source search is the one to
 * fall back on when the name settles nothing.
 *
 * The source search reads a copy of the listings held on this machine rather
 * than asking the site, because the site cannot answer it: WordPress searches
 * the rendered body, and many records keep their listing only in a field it
 * never looks at. Those records were not ranked low, they were unreachable.
 * Over the local copy the answer is exact and complete, and instant.
 */
export function ArchiveSearch({ onClose, initialQuery, initialMode }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode ?? 'source');
  const [query, setQuery] = useState(initialQuery ?? '');
  const [result, setResult] = useState<WpSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState('');
  const [listings, setListings] = useState<WpListingsStatus | null>(null);
  const [fetching, setFetching] = useState<{ done: number; total: number } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { api.wpListingsStatus().then(setListings).catch(() => setListings(null)); }, []);

  /**
   * Take the copy of the listings the source search reads. Reported as it
   * goes: fifteen megabytes is a few seconds, which is long enough that a
   * still window would read as a hang.
   */
  const fetchListings = useCallback(async () => {
    setFetchError(null);
    setFetching({ done: 0, total: 0 });
    const unsub = api.onWpListingsProgress(setFetching);
    try {
      const r = await api.wpFetchListings();
      if (r.ok) setListings(r); else setFetchError(r.error);
    } catch (err: any) {
      setFetchError(err.message);
    } finally {
      unsub();
      setFetching(null);
    }
  }, []);

  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = useCallback(async (q: string, m: Mode) => {
    const phrase = q.trim();
    if (!phrase) return;
    setSearching(true);
    setSearched(phrase);
    try {
      setResult(m === 'source' ? await api.wpSearchSource(phrase) : await api.wpSearchName(phrase));
    } catch (err: any) {
      setResult({ hits: [], searched: 0, generated: '', phrase: q, error: err.message });
    }
    setSearching(false);
  }, []);

  // Opened from a selected program: the name is already the question.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !initialQuery) return;
    opened.current = true;
    run(initialQuery, initialMode ?? 'source');
  }, [initialQuery, initialMode, run]);

  const btn: React.CSSProperties = {
    background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', padding: '6px 12px', fontSize: 12, borderRadius: 3,
  };
  const tabBtn = (m: Mode): React.CSSProperties => ({
    ...btn,
    background: mode === m ? 'var(--accent)' : 'var(--bg-tertiary)',
    color: mode === m ? '#fff' : 'var(--text-secondary)',
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 6, width: 760, maxWidth: '92vw', height: '80vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              Search the published archive
            </span>
            <button onClick={onClose} style={btn}>Close</button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button onClick={() => setMode('source')} style={tabBtn('source')}>In the listing</button>
            <button onClick={() => setMode('name')} style={tabBtn('name')}>By name</button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={input}
              type="text"
              value={query}
              placeholder={mode === 'source'
                ? 'A line, or part of one — PRINT AT 10,5;"SCORE"'
                : 'A program title'}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run(query, mode); }}
              style={{
                flex: 1, fontSize: 12,
                fontFamily: mode === 'source' ? 'var(--mono, monospace)' : 'inherit',
                padding: '7px 10px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: 3,
              }}
            />
            <button onClick={() => run(query, mode)} style={btn} disabled={searching || !query.trim()}>
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
            {mode === 'source'
              ? 'Matched against the BASIC listing exactly as typed, ignoring case, over every listing '
                + 'the archive holds. This is the search for when the name settles nothing — a disk full '
                + 'of AUTOSTART, or six programs with the same title.'
              : 'Matched against the published title, asked of the site. Quick, and enough when the disk '
                + 'name is distinctive.'}
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {result?.error && (
            <div style={{ fontSize: 12, color: 'var(--badge-dump, #d97706)', lineHeight: 1.6 }}>
              {result.error}
            </div>
          )}

          {/* No copy of the listings: say so, and offer to make one. An empty
              result here would read as an empty archive, which is the one
              thing this must never imply. */}
          {mode === 'source' && !listings && !fetching && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <div style={{ marginBottom: 10 }}>
                The listings are searched from a copy held on this machine, and there is not
                one yet. Fetching reads about 15&nbsp;MB and takes a few seconds; after that
                every search is instant and needs no network.
              </div>
              <button onClick={fetchListings} style={btn}>Fetch the listings</button>
              {fetchError && (
                <div style={{ marginTop: 10, color: 'var(--badge-dump, #d97706)' }}>{fetchError}</div>
              )}
            </div>
          )}

          {fetching && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Reading the listings...
              {fetching.total > 0 && ` ${fetching.done.toLocaleString()} of ${fetching.total.toLocaleString()}`}
            </div>
          )}

          {!result && !searching && !fetching && (mode === 'name' || listings) && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Nothing searched yet.
              {mode === 'source' && listings && (
                <span>
                  {' '}{listings.withSource.toLocaleString()} listings held, copied{' '}
                  {new Date(listings.generated).toLocaleString()}.
                </span>
              )}
            </div>
          )}

          {result && !result.error && !result.needsFetch && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                {result.hits.length === 0
                  ? `Nothing in the archive holds “${result.phrase || searched}”`
                  : `${result.hits.length} program${result.hits.length === 1 ? ' holds' : 's hold'} `
                    + `“${result.phrase || searched}”`}
                {mode === 'source' && result.searched > 0
                  && ` — all ${result.searched.toLocaleString()} listings searched`}
                {result.phrase && result.phrase !== searched.trim()
                  && ' (quotes around a phrase mean the phrase, so they were dropped)'}
              </div>

              {result.hits.map((hit) => <Hit key={hit.id} hit={hit} />)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Hit({ hit }: { hit: WpHit }) {
  const meta = [hit.mediaType, hit.date, hit.company.join(', ')].filter(Boolean).join(' · ');
  return (
    <div style={{
      borderBottom: '1px solid var(--border)', padding: '10px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <a
          href={hit.url}
          onClick={(e) => { e.preventDefault(); api.openExternal(hit.url); }}
          style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer' }}
        >
          {hit.title}
        </a>
        {meta && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta}</span>}
        {!hit.downloadUrl && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no file of its own</span>
        )}
      </div>

      {hit.context.length > 0 && (
        <pre style={{
          margin: '6px 0 0', padding: '6px 10px', background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)', borderRadius: 3,
          fontFamily: 'var(--mono, monospace)', fontSize: 11, color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto',
        }}>
          {hit.context.map((c) => c.line).join('\n')}
        </pre>
      )}
    </div>
  );
}
