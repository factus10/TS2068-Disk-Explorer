import React, { useState, useCallback, useEffect, useRef } from 'react';

export type ArchiveFormat = 'folder' | 'zip';

export interface ArchiveMetadata {
  year: string;
  publisher: string;
  system: string;
  country: string;
  format: ArchiveFormat;
}

interface Props {
  diskName: string;
  onExport: (metadata: ArchiveMetadata) => void;
  onCancel: () => void;
}

const SYSTEMS = ['TS2068', 'TS1000', 'ZX Spectrum', 'ZX81', 'Sinclair QL'];
const COUNTRIES = ['US', 'UK', 'CA', 'BR', 'Pt', 'SP'];

const PUBLISHER_HISTORY_KEY = 'archivePublisherHistory';
const MAX_PUBLISHER_HISTORY = 50;

function loadPublisherHistory(): string[] {
  try {
    const raw = localStorage.getItem(PUBLISHER_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePublisherToHistory(value: string) {
  if (!value || value === '-') return;
  const history = loadPublisherHistory().filter((h) => h !== value);
  history.unshift(value);
  if (history.length > MAX_PUBLISHER_HISTORY) history.length = MAX_PUBLISHER_HISTORY;
  localStorage.setItem(PUBLISHER_HISTORY_KEY, JSON.stringify(history));
}

export function ArchiveExportDialog({ diskName, onExport, onCancel }: Props) {
  const [year, setYear] = useState('198x');
  const [publisher, setPublisher] = useState('');
  const [system, setSystem] = useState('TS2068');
  const [country, setCountry] = useState('US');
  const [format, setFormat] = useState<ArchiveFormat>('zip');
  const [publisherHistory] = useState(loadPublisherHistory);
  const yearRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    yearRef.current?.focus();
    yearRef.current?.select();
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const pub = publisher || '-';
    savePublisherToHistory(pub);
    onExport({ year, publisher: pub, system, country, format });
  }, [year, publisher, system, country, format, onExport]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  return (
    <div
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 24,
          width: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          Export for Archive.org
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8 }}>
          Files will be named using archive.org conventions:<br />
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-secondary)' }}>
            Title (Year)(Publisher)(System)(Country)(Type).tap
          </span>
        </div>

        {diskName && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Disk: <strong>{diskName}</strong>
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Year</span>
          <input
            ref={yearRef}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="198x"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '5px 8px',
              fontSize: 12,
            }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Publisher / Author</span>
          <input
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            placeholder="Unknown (-)"
            list="publisher-history"
            autoComplete="off"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '5px 8px',
              fontSize: 12,
            }}
          />
          <datalist id="publisher-history">
            {publisherHistory.map((p) => <option key={p} value={p} />)}
          </datalist>
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>System</span>
            <select
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '5px 8px',
                fontSize: 12,
              }}
            >
              {SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Country</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '5px 8px',
                fontSize: 12,
              }}
            >
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-primary)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', alignSelf: 'center' }}>Export as:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="format"
              checked={format === 'zip'}
              onChange={() => setFormat('zip')}
            />
            ZIP file
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="format"
              checked={format === 'folder'}
              onChange={() => setFormat('folder')}
            />
            Folder
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              padding: '6px 16px',
              fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              padding: '6px 16px',
              fontSize: 12,
            }}
          >
            Export
          </button>
        </div>
      </form>
    </div>
  );
}
