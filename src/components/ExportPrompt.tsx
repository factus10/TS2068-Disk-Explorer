import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { TosecMetadata } from '../api';
import {
  SYSTEMS, COUNTRIES, loadPublisherHistory, savePublisherToHistory,
} from './ArchiveExportDialog';

/**
 * How a program leaves the app: as a bare TAP dropped in a folder, or as a
 * ZIP named the archive's way with the program inside it.
 */
export type ExportShape = 'tap' | 'tosec-zip';

export interface ExportChoice {
  /** The name the reader settled on; empty when nothing was up for naming. */
  name: string;
  shape: ExportShape;
  /** Present only for 'tosec-zip'. */
  metadata?: TosecMetadata;
}

interface Props {
  title: string;
  /** Omit to skip the name field — a multi-file export names nothing by hand. */
  defaultValue?: string;
  /** What is being exported, shown when there is no single name to show. */
  summary?: string;
  /**
   * What the program's own file will be called inside the ZIP — `.tap` for the
   * Spectrum-family disks, `.p` for the ZX81. The preview would otherwise
   * promise a tape file for a machine that has none.
   */
  payloadExt?: string;
  /** The archive's word for what this is: Program, Screen, Code, Data. */
  typeSuffix?: string;
  onConfirm: (choice: ExportChoice) => void;
  onCancel: () => void;
}

/**
 * Cataloguing a disk means doing this once per program, and the year, the
 * publisher and the machine are the same every time round. Remembering them
 * turns the second export and every one after it into pressing Return.
 */
const LAST_KEY = 'tosecLastChoice';

interface Remembered {
  shape: ExportShape;
  year: string;
  publisher: string;
  system: string;
  country: string;
}

/**
 * The year, publisher and machine last used. Exported because publishing to
 * WordPress asks the same questions an export does, and answering them twice
 * differently for one program would be a way to get them wrong.
 */
export function loadRemembered(): Remembered {
  const fallback: Remembered = {
    shape: 'tap', year: '198x', publisher: '', system: 'TS2068', country: 'US',
  };
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Remembered>;
    return {
      shape: parsed.shape === 'tosec-zip' ? 'tosec-zip' : 'tap',
      year: typeof parsed.year === 'string' ? parsed.year : fallback.year,
      publisher: typeof parsed.publisher === 'string' ? parsed.publisher : '',
      system: typeof parsed.system === 'string' ? parsed.system : fallback.system,
      country: typeof parsed.country === 'string' ? parsed.country : fallback.country,
    };
  } catch { return fallback; }
}

/**
 * What the export will be called. Mirrors buildArchiveName in main.ts, which
 * does the real naming — the renderer does not import across that boundary,
 * so the two have to agree, and this one exists only so the reader can see
 * the answer before committing to it.
 */
export function previewArchiveName(
  title: string, meta: TosecMetadata, typeSuffix = 'Program',
): string {
  let clean = title.trim().replace(/\.[BCAbca][\w$]*$/, '');
  clean = clean.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();
  if (!clean) clean = 'Unknown';
  return `${clean} (${meta.year})(${meta.publisher || '-'})(${meta.system})(${meta.country})(${typeSuffix})`;
}

const field: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '5px 8px',
  fontSize: 12,
};

const labelText: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)' };

export function ExportPrompt({
  title, defaultValue, summary, payloadExt = '.tap', typeSuffix = 'Program',
  onConfirm, onCancel,
}: Props) {
  const remembered = useRef(loadRemembered()).current;
  const [name, setName] = useState(defaultValue ?? '');
  const [shape, setShape] = useState<ExportShape>(remembered.shape);
  const [year, setYear] = useState(remembered.year);
  const [publisher, setPublisher] = useState(remembered.publisher);
  const [system, setSystem] = useState(remembered.system);
  const [country, setCountry] = useState(remembered.country);
  const [publisherHistory] = useState(loadPublisherHistory);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const metadata: TosecMetadata = { year, publisher: publisher || '-', system, country };
    if (shape === 'tosec-zip') savePublisherToHistory(metadata.publisher);
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({
        shape, year, publisher, system, country,
      } satisfies Remembered));
    } catch { /* a preference that will not save must not stop an export */ }
    onConfirm({ name, shape, ...(shape === 'tosec-zip' ? { metadata } : {}) });
  }, [name, shape, year, publisher, system, country, onConfirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  const preview = previewArchiveName(
    name || defaultValue || summary || 'Unknown',
    { year, publisher, system, country },
    typeSuffix,
  );

  return (
    <div
      onKeyDown={handleKeyDown}
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 24,
          width: 420,
          maxWidth: '92vw',
          // Short today, but a dialog that outgrows the screen has no way to
          // be scrolled to and no way to be dismissed but Escape.
          maxHeight: '85vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          {title}
        </div>

        {defaultValue !== undefined ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={labelText}>Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ ...field, fontFamily: 'var(--mono, monospace)' }}
            />
          </label>
        ) : summary ? (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{summary}</div>
        ) : null}

        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-primary)' }}>
          <span style={{ ...labelText, alignSelf: 'center' }}>Save as:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="shape"
              checked={shape === 'tap'}
              onChange={() => setShape('tap')}
            />
            TAP file
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="shape"
              checked={shape === 'tosec-zip'}
              onChange={() => setShape('tosec-zip')}
            />
            ZIP, archive-named
          </label>
        </div>

        {shape === 'tosec-zip' && (
          <>
            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 90 }}>
                <span style={labelText}>Year</span>
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="198x"
                  style={field}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                <span style={labelText}>Publisher / Author</span>
                <input
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                  placeholder="Unknown (-)"
                  list="publisher-history"
                  autoComplete="off"
                  style={field}
                />
                <datalist id="publisher-history">
                  {publisherHistory.map((p) => <option key={p} value={p} />)}
                </datalist>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                <span style={labelText}>System</span>
                <select value={system} onChange={(e) => setSystem(e.target.value)} style={field}>
                  {SYSTEMS.map((sys) => <option key={sys} value={sys}>{sys}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                <span style={labelText}>Country</span>
                <select value={country} onChange={(e) => setCountry(e.target.value)} style={field}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>

            <div style={{
              fontSize: 10, fontFamily: 'var(--mono, monospace)',
              color: 'var(--text-muted)', wordBreak: 'break-all', lineHeight: 1.5,
            }}>
              {preview}.zip
              <br />
              <span style={{ opacity: 0.7 }}>holding {preview}{payloadExt}</span>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', padding: '6px 16px', fontSize: 12 }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{ background: 'var(--accent)', color: '#fff', padding: '6px 16px', fontSize: 12 }}
          >
            {shape === 'tosec-zip' ? 'Export ZIP' : 'Save TAP'}
          </button>
        </div>
      </form>
    </div>
  );
}
