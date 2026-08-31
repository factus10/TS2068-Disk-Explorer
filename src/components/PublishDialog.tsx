import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, WpPublishSuggestion, WpPublishResult, WpTerm } from '../api';

interface Props {
  imagePath: string;
  entryIndex: number;
  /** The title the export would have used, so both name a program alike. */
  defaultTitle: string;
  /** The archive filename, which becomes the stamp the CSV importer reads. */
  sourceFilename: string;
  /** Hand-edited BASIC lines, folded into the listing main writes. */
  editedLines?: Record<number, string>;
  /** Remembered between exports; the year, publisher and machine of the disk. */
  metadata: { year: string; publisher: string };
  onClose: () => void;
  onStatus: (message: string) => void;
}

/**
 * Making a published record out of a program on a disk.
 *
 * Three of the answers are already known by the time this opens — the machine
 * the disk speaks for, the BASIC keywords the program uses, and the tags that
 * follow from those — so they arrive ticked. They are shown rather than
 * applied silently: a derived answer is still an answer someone is
 * accountable for, and the machine in particular is a guess the disk cannot
 * settle on its own.
 *
 * Everything is created as a draft. Nothing here publishes.
 */
export function PublishDialog(props: Props) {
  const { imagePath, entryIndex, defaultTitle, sourceFilename, editedLines, metadata } = props;

  const [data, setData] = useState<WpPublishSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTitle);
  const [programmers, setProgrammers] = useState('');
  const [company, setCompany] = useState<number | null>(null);
  const [picked, setPicked] = useState<Record<string, Set<number>>>({});
  const [describe, setDescribe] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<WpPublishResult | null>(null);

  useEffect(() => {
    api.wpPublishSuggest(imagePath, entryIndex, metadata.year)
      .then((r) => {
        if ('error' in r && r.error) { setError(r.error); return; }
        const s = r as WpPublishSuggestion;
        setData(s);
        // What the app worked out arrives ticked, and visibly so.
        setPicked({
          model: new Set(s.suggested.model ? [s.suggested.model.id] : []),
          basic: new Set(s.suggested.basic.map((t) => t.id)),
          tags: new Set(s.suggested.tags.map((t) => t.id)),
          genre: new Set(),
        });
      })
      .catch((e) => setError(e.message));
  }, [imagePath, entryIndex, metadata.year]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props, busy]);

  const toggle = useCallback((tax: string, id: number) => {
    setPicked((prev) => {
      const next = new Set(prev[tax] ?? []);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...prev, [tax]: next };
    });
  }, []);

  const publish = useCallback(async () => {
    setBusy('Starting...');
    const unsub = api.onWpPublishProgress((p) => setBusy(p.message));
    try {
      const r = await api.wpPublish({
        title: title.trim(),
        sourceFilename,
        imagePath,
        entryIndex,
        ...(editedLines ? { editedLines } : {}),
        acf: {
          mediadate: metadata.year,
          'media-type': 'Program',
          ...(company ? { 'producer-company': [company] } : {}),
        },
        taxonomies: {
          model: [...(picked.model ?? [])],
          basic: [...(picked.basic ?? [])],
          genre: [...(picked.genre ?? [])],
          tags: [...(picked.tags ?? [])],
        },
        programmerNames: programmers.split(',').map((n) => n.trim()).filter(Boolean),
        images: [],
        describe,
      });
      setResult(r);
      props.onStatus(r.ok
        ? `Created draft ${r.postId}${r.described ? ', described' : ''}`
        : `Publish failed: ${r.error}`);
    } catch (e: any) {
      setResult({ ok: false, error: e.message });
    } finally {
      unsub();
      setBusy(null);
    }
  }, [title, sourceFilename, imagePath, entryIndex, editedLines, metadata, company, picked, programmers, describe, props]);

  const btn: React.CSSProperties = {
    background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', padding: '6px 12px', fontSize: 12, borderRadius: 3,
  };
  const label: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', margin: '14px 0 6px',
  };

  const chips = (tax: string, terms: WpTerm[], derived: Set<number>) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 108, overflowY: 'auto' }}>
      {terms.map((t) => {
        const on = picked[tax]?.has(t.id) ?? false;
        return (
          <button
            key={t.id}
            onClick={() => toggle(tax, t.id)}
            title={derived.has(t.id) ? 'Worked out from the disk — untick if wrong' : undefined}
            style={{
              ...btn,
              padding: '3px 8px',
              fontSize: 11,
              background: on ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: on ? '#fff' : 'var(--text-secondary)',
              borderStyle: derived.has(t.id) ? 'dashed' : 'solid',
            }}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );

  const derivedModel = useMemo(
    () => new Set(data?.suggested.model ? [data.suggested.model.id] : []), [data]);
  const derivedBasic = useMemo(
    () => new Set(data?.suggested.basic.map((t) => t.id) ?? []), [data]);
  const derivedTags = useMemo(
    () => new Set(data?.suggested.tags.map((t) => t.id) ?? []), [data]);

  return (
    <div
      onClick={() => { if (!busy) props.onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6,
          width: 700, maxWidth: '92vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          padding: '16px 20px 12px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            Publish to WordPress
          </span>
          <button onClick={props.onClose} style={btn} disabled={!!busy}>Close</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 16px' }}>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--badge-dump, #d97706)', marginTop: 14, lineHeight: 1.6 }}>
              {error}
            </div>
          )}

          {!data && !error && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 14 }}>
              Reading the program and the site's vocabularies...
            </div>
          )}

          {result && (
            <div style={{
              fontSize: 12, marginTop: 14, lineHeight: 1.7,
              color: result.ok ? 'var(--accent)' : 'var(--badge-dump, #d97706)',
            }}>
              {result.ok ? (
                <>
                  Created draft {result.postId}
                  {result.people > 0 && `, ${result.people} programmer(s)`}
                  {result.described ? ', described' : ''}.{' '}
                  <a
                    href={result.url}
                    onClick={(e) => { e.preventDefault(); api.openExternal(result.url); }}
                    style={{ color: 'var(--accent)', cursor: 'pointer' }}
                  >
                    Open it in WordPress
                  </a>
                </>
              ) : (
                <>
                  {result.error}
                  {result.url && (
                    <>
                      {' '}A draft was created before this failed —{' '}
                      <a
                        href={result.url}
                        onClick={(e) => { e.preventDefault(); api.openExternal(result.url!); }}
                        style={{ color: 'var(--accent)', cursor: 'pointer' }}
                      >
                        post {result.postId}
                      </a>.
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {data && !result && (
            <>
              <div style={label}>Title</div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  width: '100%', fontSize: 12, padding: '6px 8px', background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3,
                }}
              />

              <div style={label}>
                Machine
                {data.suggested.modelAlternatives.length > 0 && (
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                    {' '}&mdash; the disk says the family, not the badge; it could also be{' '}
                    {data.suggested.modelAlternatives.join(' or ')}
                  </span>
                )}
              </div>
              {chips('model', data.vocabularies.model, derivedModel)}

              <div style={label}>
                BASIC keywords used
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  {' '}&mdash; read from the program itself
                </span>
              </div>
              {chips('basic', data.vocabularies.basic, derivedBasic)}
              {data.suggested.basicUnmatched.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                  Also used, but the archive has no term for them yet:{' '}
                  <span style={{ fontFamily: 'var(--mono, monospace)' }}>
                    {data.suggested.basicUnmatched.join(', ')}
                  </span>
                  . Add them in WordPress if they are worth filing.
                </div>
              )}

              <div style={label}>Genre</div>
              {chips('genre', data.vocabularies.genre, new Set())}

              <div style={label}>Tags</div>
              {chips('tags', data.vocabularies.tags.slice(0, 60), derivedTags)}
              {data.suggested.tagsUnmatched.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  No tag exists for: {data.suggested.tagsUnmatched.join(', ')}
                </div>
              )}

              <div style={label}>
                Programmers
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  {' '}&mdash; comma separated; anyone new is added to the archive
                </span>
              </div>
              <input
                type="text"
                value={programmers}
                placeholder="Jane Smith, A. Dan Klyver"
                onChange={(e) => setProgrammers(e.target.value)}
                style={{
                  width: '100%', fontSize: 12, padding: '6px 8px', background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3,
                }}
              />

              <div style={label}>Publisher</div>
              <select
                value={company ?? ''}
                onChange={(e) => setCompany(e.target.value ? Number(e.target.value) : null)}
                style={{
                  width: '100%', fontSize: 12, padding: '6px 8px', background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3,
                }}
              >
                <option value="">(none)</option>
                {data.vocabularies.companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 16,
                fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={describe}
                  onChange={(e) => setDescribe(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  Have the describer write the description and teaser from the listing, once the
                  record exists. It reads the program on the site, so this only happens after the
                  draft is made.
                </span>
              </label>
            </>
          )}
        </div>

        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {busy ?? (result ? '' : 'Creates a draft — nothing is published.')}
          </span>
          {!result && (
            <button
              onClick={publish}
              style={{ ...btn, background: 'var(--accent)', color: '#fff' }}
              disabled={!data || !!busy || !title.trim()}
            >
              {busy ? 'Working...' : 'Create draft'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
