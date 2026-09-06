import React, { useState, useEffect, useCallback } from 'react';
import { api, CollectionSurvey, IngestResult } from '../api';

interface Props {
  onClose: () => void;
  onStatus: (message: string) => void;
  /** Called after a successful ingest, so views showing catalogue state refresh. */
  onIngested: () => void;
}

/**
 * Adding newly imaged disks to the catalogue.
 *
 * Surveys first and shows what it found, because "add everything new" is a
 * decision worth seeing the shape of before taking — a survey that turns up
 * four hundred images usually means the wrong folder rather than a busy week.
 */
export function CatalogIngest({ onClose, onStatus, onIngested }: Props) {
  const [survey, setSurvey] = useState<CollectionSurvey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  // undefined scans the catalogue's own root; a chosen folder scans there
  // instead, wherever it sits.
  const [scanDir, setScanDir] = useState<string | undefined>(undefined);

  useEffect(() => {
    setSurvey(null); setResult(null); setError(null);
    api.surveyCollection(scanDir)
      .then((s) => { if (!s) setError('No catalogue is set. Choose one in Preferences first.'); else setSurvey(s); })
      .catch((e) => setError(e.message));
  }, [scanDir]);

  const chooseFolder = useCallback(async () => {
    const dir = await api.selectDirectory();
    if (dir) setScanDir(dir);
  }, []);

  useEffect(() => api.onIngestProgress(setProgress), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !running) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, running]);

  const run = useCallback(async () => {
    if (!survey) return;
    setRunning(true);
    setProgress({ done: 0, total: survey.fresh.length, current: '' });
    try {
      const r = await api.ingestImages(survey.root, survey.fresh);
      if (!r) { setError('The catalogue could not be updated.'); setRunning(false); return; }
      setResult(r);
      onStatus(`Catalogue updated: ${r.newPrograms} new program(s) from ${r.imagesAdded} disk(s)`);
      onIngested();
    } catch (e: any) {
      setError(e.message);
    }
    setRunning(false);
  }, [survey, onStatus, onIngested]);

  const box: React.CSSProperties = {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
    padding: 24, width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 14,
  };
  const btn: React.CSSProperties = {
    background: 'var(--bg-tertiary)', color: 'var(--text-primary)', padding: '6px 16px', fontSize: 12,
  };

  // Folders rather than a flat list: a disk is usually a folder of tapes plus
  // its image, and forty tapes from one disk should read as one line.
  const byFolder = new Map<string, number>();
  for (const rel of survey?.fresh ?? []) {
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '(root)';
    byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
        alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)',
      }}
      onClick={() => { if (!running) onClose(); }}
    >
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          Add new disks to the catalogue
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--accent)' }}>{error}</div>}

        {!error && !survey && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Looking for new disks...</div>
        )}

        {survey && !result && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <div style={{ fontFamily: 'var(--mono, monospace)', color: 'var(--text-muted)' }}>{survey.root}</div>
              {survey.imagesOnDisk} image(s) on disk, {survey.imagesKnown} already catalogued.
              {survey.imagesEmpty > 0
                && ` ${survey.imagesEmpty} examined before and held no program.`}
              {survey.gone.length > 0 && (
                <>
                  <br />
                  <span style={{ color: 'var(--badge-dir)' }}>
                    {survey.gone.length} catalogued image(s) are not on disk right now — left alone,
                    since an unmounted drive looks the same as a deletion.
                  </span>
                </>
              )}
            </div>

            {survey.fresh.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--badge-basic)' }}>
                Nothing new — the catalogue already has every image here.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                  <strong>{survey.fresh.length}</strong> new image(s) in {byFolder.size} folder(s):
                </div>
                <div style={{
                  overflow: 'auto', maxHeight: 220, border: '1px solid var(--border)',
                  borderRadius: 4, padding: '6px 10px', fontSize: 11,
                }}>
                  {[...byFolder].sort((a, b) => b[1] - a[1]).map(([folder, n]) => (
                    <div key={folder} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                      <span style={{
                        fontFamily: 'monospace', color: 'var(--accent)', minWidth: 34, textAlign: 'right',
                      }}>
                        {n}
                      </span>
                      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {folder}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {running && progress && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Reading {progress.done} of {progress.total}...
                <div style={{
                  height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, marginTop: 6, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', width: `${progress.total ? (100 * progress.done) / progress.total : 0}%`,
                    background: 'var(--accent)', transition: 'width 0.2s',
                  }} />
                </div>
                <div style={{
                  color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {progress.current}
                </div>
              </div>
            )}
          </>
        )}

        {result && (
          <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.7 }}>
            Added <strong>{result.newPrograms}</strong> program(s) nobody had seen, and{' '}
            {result.newOccurrences - result.newPrograms} further cop(y/ies) of programs already known,
            from {result.imagesAdded} disk(s).
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
              The catalogue now holds {result.uniqueCount.toLocaleString()} programs
              across {result.imageCount.toLocaleString()} images.
            </div>
            {result.unreadable.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--badge-dir)', marginTop: 6 }}>
                {result.unreadable.length} image(s) could not be read: {result.unreadable[0].reason}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
          <button
            onClick={chooseFolder}
            disabled={running}
            style={btn}
            title="Scan a different folder for new disks"
          >
            Choose folder&hellip;
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={running} style={btn}>
              {result ? 'Close' : 'Cancel'}
            </button>
            {survey && !result && survey.fresh.length > 0 && (
              <button
                onClick={run}
                disabled={running}
                style={{ ...btn, background: 'var(--accent)', color: '#fff' }}
              >
                {running ? 'Adding...' : `Add ${survey.fresh.length} image(s)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
