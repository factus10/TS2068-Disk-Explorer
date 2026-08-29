import React, { useEffect, useState } from 'react';
import { api, WpHit } from '../api';

interface Props {
  /** The name to ask the archive about — the file's, as it stands on the disk. */
  name: string;
  /** Whether a site is configured; without one there is nothing to ask. */
  siteUrl: string | null;
  /** Take the question to the full search window, where the listing can be used. */
  onSearch: (query: string) => void;
}

/**
 * Whether the selected program is already published, answered while browsing.
 *
 * This is the cheap question — one request against the site's own search —
 * and it is only ever a lead. A name is the weakest evidence a disk carries:
 * `AUTOSTART` matches nothing useful and `CHESS` matches three unrelated
 * records. So the answer is phrased as what the archive holds under that
 * name, never as a verdict on this program, and the way to settle it is the
 * source search one click away.
 *
 * Nothing is cached between selections beyond the request in flight: the
 * site is on the reader's own machine, and a stale answer would be worse
 * than a repeated question.
 */
export function ArchivePresence({ name, siteUrl, onSearch }: Props) {
  const [hits, setHits] = useState<WpHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!siteUrl || !name.trim()) { setHits(null); setError(null); return; }

    // The selection can move faster than the site answers; a reply that
    // arrives after the reader has moved on belongs to nothing.
    let current = true;
    setBusy(true);
    setHits(null);
    setError(null);
    api.wpLookup(name)
      .then((r) => { if (!current) return; if (r.error) setError(r.error); else setHits(r.hits); })
      .catch((e) => { if (current) setError(e.message); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [name, siteUrl]);

  if (!siteUrl) return null;

  const link: React.CSSProperties = {
    color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer', fontWeight: 600,
  };
  const searchLink: React.CSSProperties = {
    color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer',
    background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 11,
  };

  return (
    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
      <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Archive: </span>

      {busy && <span style={{ color: 'var(--text-muted)' }}>looking...</span>}

      {!busy && error && <span style={{ color: 'var(--text-muted)' }}>{error}</span>}

      {!busy && !error && hits?.length === 0 && (
        <span style={{ color: 'var(--text-muted)' }}>
          nothing published under this name
        </span>
      )}

      {!busy && !error && hits && hits.length > 0 && (
        <>
          {hits.slice(0, 4).map((hit, i) => (
            <span key={hit.id}>
              {i > 0 && ', '}
              <a
                href={hit.url}
                onClick={(e) => { e.preventDefault(); api.openExternal(hit.url); }}
                style={link}
              >
                {hit.title}
              </a>
              {hit.date && <span style={{ color: 'var(--text-muted)' }}> ({hit.date})</span>}
            </span>
          ))}
          {hits.length > 4 && (
            <span style={{ color: 'var(--text-muted)' }}> + {hits.length - 4} more</span>
          )}
        </>
      )}

      {!busy && (
        <button onClick={() => onSearch(name)} style={{ ...searchLink, marginLeft: 8 }}>
          search the listing
        </button>
      )}
    </div>
  );
}
