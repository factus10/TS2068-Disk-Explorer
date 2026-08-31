import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, WpPublishSuggestion, WpPublishResult, WpTerm } from '../api';
import { TermPicker } from './TermPicker';

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
/**
 * Where the bundles live. Every published record points into the same
 * archive.org item, so the download follows from the archive filename — but
 * it stays editable, because a program hosted somewhere else is a thing that
 * can happen and a wrong URL is worse than a blank one.
 */
const ARCHIVE_BASE = 'https://archive.org/download/timex-sinclair-software-archive';

export function PublishDialog(props: Props) {
  const { imagePath, entryIndex, defaultTitle, sourceFilename, editedLines, metadata } = props;

  const [data, setData] = useState<WpPublishSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTitle);
  const [people, setPeople] = useState<WpTerm[]>([]);
  const [companies, setCompanies] = useState<WpTerm[]>([]);
  const [genres, setGenres] = useState<WpTerm[]>([]);
  const [tags, setTags] = useState<WpTerm[]>([]);
  const [picked, setPicked] = useState<Record<string, Set<number>>>({});
  const [describe, setDescribe] = useState(true);
  const [downloadUrl, setDownloadUrl] = useState(
    `${ARCHIVE_BASE}/${encodeURIComponent(props.sourceFilename)}`);
  const [screens, setScreens] = useState<Set<number>>(new Set());
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
        });
        setTags(s.suggested.tags);
        // A program's own loading screen is worth attaching by default; it is
        // the picture of the thing.
        setScreens(new Set(s.suggested.screens.map((x) => x.index)));
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
          ...(downloadUrl.trim() ? { download_url: downloadUrl.trim() } : {}),
          ...(companies.length ? { 'producer-company': companies.map((c) => c.id) } : {}),
        },
        taxonomies: {
          model: [...(picked.model ?? [])],
          basic: [...(picked.basic ?? [])],
          genre: genres.map((t) => t.id),
          tags: tags.map((t) => t.id),
        },
        // Names, not ids: a person picked from the archive and one typed in
        // fresh are both resolved on the far side, and only people are made.
        programmerNames: people.map((t) => t.name),
        screenIndices: [...screens],
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
  }, [title, sourceFilename, imagePath, entryIndex, editedLines, metadata, companies, picked, genres, tags, people, describe, downloadUrl, screens, props]);

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
                Download
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  {' '}&mdash; where the bundle will live; follows the archive name
                </span>
              </div>
              <input
                type="text"
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                style={{
                  width: '100%', fontSize: 11, fontFamily: 'var(--mono, monospace)',
                  padding: '6px 8px', background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3,
                }}
              />

              {data.suggested.screens.length > 0 && (
                <>
                  <div style={label}>
                    Screens
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                      {' '}&mdash; the SCREEN$ files this program loads; the first becomes the
                      featured image
                    </span>
                  </div>
                  {data.suggested.screens.map((sc) => (
                    <label
                      key={sc.index}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer',
                        marginBottom: 4,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={screens.has(sc.index)}
                        onChange={(e) => setScreens((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(sc.index) : next.delete(sc.index);
                          return next;
                        })}
                      />
                      <span style={{ fontFamily: 'var(--mono, monospace)' }}>{sc.filename}</span>
                    </label>
                  ))}
                </>
              )}

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

              <div style={label}>
                Genre
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  {' '}&mdash; type to match; a term under another is shown by its path
                </span>
              </div>
              <TermPicker
                kind="genre"
                local={data.vocabularies.genre}
                value={genres}
                onChange={setGenres}
                placeholder="Game, Utility, Education..."
              />

              <div style={label}>
                Tags
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  {' '}&mdash; type to search the archive's tags
                </span>
              </div>
              <TermPicker
                kind="tags"
                value={tags}
                onChange={setTags}
                placeholder="Type at least three characters"
              />
              {data.suggested.tagsUnmatched.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  No tag exists for: {data.suggested.tagsUnmatched.join(', ')}
                </div>
              )}

              <div style={label}>
                Programmers
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  {' '}&mdash; type to search; anyone the archive has not met can be added
                </span>
              </div>
              <TermPicker
                kind="indiv"
                value={people}
                onChange={setPeople}
                placeholder="Surname or forename"
                allowNew
              />

              <div style={label}>Publisher</div>
              <TermPicker
                kind="company"
                value={companies}
                onChange={setCompanies}
                placeholder="Type at least three characters"
                single
              />

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
                  Have the describer read the listing and write the record up &mdash; the
                  technical analysis into the body, a summary paragraph above it, and a
                  one-sentence teaser as the excerpt. It reads the program on the site, so this
                  only happens after the draft is made.
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
