import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, WpTerm } from '../api';

interface Props {
  /** A taxonomy name, or `company` for the publisher posts. */
  kind: string;
  /** What has been chosen so far. */
  value: WpTerm[];
  onChange: (terms: WpTerm[]) => void;
  placeholder: string;
  /** One only — a program has one publisher. */
  single?: boolean;
  /**
   * A vocabulary small enough to hold, filtered here instead of asked for.
   * Genre is 88 terms and hierarchical: matching locally is instant and lets
   * a term be shown by its full path.
   */
  local?: WpTerm[];
  /**
   * Offer to add what was typed when nothing matches. True only for people:
   * a programmer the archive has not met is ordinary, where an unknown genre
   * or tag is more likely a typo.
   */
  allowNew?: boolean;
}

/** Below this a search matches most of the archive and tells nobody anything. */
const MIN_CHARS = 3;

/**
 * Picking terms out of a vocabulary too big to look at.
 *
 * The archive has 3,448 people, 1,336 tags and some 900 companies. None of
 * that can be a list of chips or a dropdown — nobody remembers whether it is
 * filed under Dan Klyver or A. Dan Klyver — so this asks the site as the
 * reader types and offers what it finds.
 *
 * It waits for three characters and a pause before asking. Searching on every
 * keystroke would put a request behind each letter, and the first two letters
 * of a name match hundreds of people to no purpose.
 */
export function TermPicker({ kind, value, onChange, placeholder, single, local, allowNew }: Props) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<WpTerm[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  const chosen = useMemo(() => new Set(value.map((t) => t.id)), [value]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) { setMatches([]); setError(null); setBusy(false); return; }

    // A local vocabulary needs no request and no delay.
    if (local) {
      const needle = q.toLowerCase();
      setMatches(local.filter((t) => (t.path ?? t.name).toLowerCase().includes(needle)).slice(0, 40));
      return;
    }

    setBusy(true);
    // Only the last search in a burst of typing is worth showing; `seq` drops
    // the answers to the ones before it, which can arrive out of order.
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const r = await api.wpTermSearch(kind, q);
        if (mine !== seq.current) return;
        setMatches(r.terms);
        setError(r.error ?? null);
      } catch (err: any) {
        if (mine === seq.current) setError(err.message);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, kind, local]);

  const add = useCallback((term: WpTerm) => {
    onChange(single ? [term] : [...value.filter((t) => t.id !== term.id), term]);
    setQuery('');
    setMatches([]);
    setOpen(false);
  }, [onChange, single, value]);

  const remove = useCallback((id: number) => {
    onChange(value.filter((t) => t.id !== id));
  }, [onChange, value]);

  const q = query.trim();
  const exactExists = matches.some((m) => m.name.toLowerCase() === q.toLowerCase());
  const offerNew = allowNew && q.length >= MIN_CHARS && !busy && !exactExists;

  const chip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: 'var(--accent)', color: '#fff', borderRadius: 3,
    padding: '2px 6px', fontSize: 11,
  };

  return (
    <div style={{ position: 'relative' }}>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
          {value.map((t) => (
            <span key={t.id} style={chip}>
              {t.path ?? t.name}
              <button
                onClick={() => remove(t.id)}
                title="Remove"
                style={{
                  background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
                  padding: 0, fontSize: 13, lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // A blur has to outlive the click that caused it, or choosing a
        // suggestion would close the list before the click lands.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{
          width: '100%', fontSize: 12, padding: '6px 8px', background: 'var(--bg-tertiary)',
          color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3,
        }}
      />

      {open && q.length > 0 && q.length < MIN_CHARS && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Keep typing &mdash; {MIN_CHARS} characters before it looks.
        </div>
      )}

      {open && (busy || matches.length > 0 || offerNew || error) && q.length >= MIN_CHARS && (
        <div style={{
          position: 'absolute', zIndex: 10, left: 0, right: 0, marginTop: 2,
          maxHeight: 220, overflowY: 'auto',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 3, boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
        }}>
          {busy && (
            <div style={{ padding: '6px 9px', fontSize: 11, color: 'var(--text-muted)' }}>Looking...</div>
          )}
          {error && (
            <div style={{ padding: '6px 9px', fontSize: 11, color: 'var(--badge-dump, #d97706)' }}>{error}</div>
          )}
          {matches.map((m) => (
            <button
              key={m.id}
              onMouseDown={(e) => { e.preventDefault(); add(m); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none',
                background: chosen.has(m.id) ? 'var(--bg-tertiary)' : 'transparent',
                color: 'var(--text-primary)', padding: '5px 9px', fontSize: 12, cursor: 'pointer',
              }}
            >
              {m.path ?? m.name}
              {chosen.has(m.id) && (
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> &mdash; already chosen</span>
              )}
            </button>
          ))}
          {!busy && matches.length === 0 && !offerNew && !error && (
            <div style={{ padding: '6px 9px', fontSize: 11, color: 'var(--text-muted)' }}>
              Nothing in the archive matches. Add the term in WordPress if it belongs there.
            </div>
          )}
          {offerNew && (
            <button
              onMouseDown={(e) => { e.preventDefault(); add({ id: -Date.now(), name: q }); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none',
                borderTop: matches.length ? '1px solid var(--border)' : 'none',
                background: 'transparent', color: 'var(--accent)',
                padding: '5px 9px', fontSize: 12, cursor: 'pointer',
              }}
            >
              Add &ldquo;{q}&rdquo; as someone new
            </button>
          )}
        </div>
      )}
    </div>
  );
}
