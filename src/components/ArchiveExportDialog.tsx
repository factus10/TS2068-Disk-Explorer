import React, { useState, useCallback, useEffect, useRef } from 'react';

/**
 * `image-zip` wraps the untouched disk image — what archive.org wants when the
 * item *is* the disk. `zip` and `folder` carry the extracted, archive-named
 * files instead, and so are the only sensible shapes for a subset of a disk.
 */
export type ArchiveFormat = 'image-zip' | 'zip' | 'folder';

export type ArchiveScope = 'disk' | 'selected';

export interface ArchiveMetadata {
  year: string;
  publisher: string;
  system: string;
  country: string;
  format: ArchiveFormat;
  scope: ArchiveScope;
}

interface Props {
  diskName: string;
  /** How many catalog rows are selected; 0 disables the selected-files scope. */
  selectedCount: number;
  onExport: (metadata: ArchiveMetadata) => void;
  onCancel: () => void;
}

export const SYSTEMS = ['TS2068', 'TS1000', 'ZX Spectrum', 'ZX81', 'Sinclair QL'];
export const COUNTRIES = ['US', 'UK', 'CA', 'BR', 'Pt', 'SP'];

const PUBLISHER_HISTORY_KEY = 'archivePublisherHistory';
const MAX_PUBLISHER_HISTORY = 50;

export function loadPublisherHistory(): string[] {
  try {
    const raw = localStorage.getItem(PUBLISHER_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function savePublisherToHistory(value: string) {
  if (!value || value === '-') return;
  const history = loadPublisherHistory().filter((h) => h !== value);
  history.unshift(value);
  if (history.length > MAX_PUBLISHER_HISTORY) history.length = MAX_PUBLISHER_HISTORY;
  localStorage.setItem(PUBLISHER_HISTORY_KEY, JSON.stringify(history));
}

export function ArchiveExportDialog({ diskName, selectedCount, onExport, onCancel }: Props) {
  const [year, setYear] = useState('198x');
  const [publisher, setPublisher] = useState('');
  const [system, setSystem] = useState('TS2068');
  const [country, setCountry] = useState('US');
  const [format, setFormat] = useState<ArchiveFormat>('image-zip');
  const [scope, setScope] = useState<ArchiveScope>('disk');
  const [publisherHistory] = useState(loadPublisherHistory);
  const yearRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    yearRef.current?.focus();
    yearRef.current?.select();
  }, []);

  // There is no disk image of a subset, so the raw-image ZIP falls away with
  // the selected scope and the file ZIP takes its place.
  const chooseScope = useCallback((next: ArchiveScope) => {
    setScope(next);
    if (next === 'selected' && format === 'image-zip') setFormat('zip');
    if (next === 'disk' && format === 'zip') setFormat('image-zip');
  }, [format]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const pub = publisher || '-';
    savePublisherToHistory(pub);
    onExport({ year, publisher: pub, system, country, format, scope });
  }, [year, publisher, system, country, format, scope, onExport]);

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

        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-primary)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', alignSelf: 'center' }}>Contents:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="scope"
              checked={scope === 'disk'}
              onChange={() => chooseScope('disk')}
            />
            Entire disk
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: selectedCount > 0 ? 'pointer' : 'default',
              color: selectedCount > 0 ? undefined : 'var(--text-muted)',
            }}
            title={selectedCount > 0 ? undefined : 'Select files in the catalog first'}
          >
            <input
              type="radio"
              name="scope"
              disabled={selectedCount === 0}
              checked={scope === 'selected'}
              onChange={() => chooseScope('selected')}
            />
            Selected ({selectedCount})
          </label>
        </div>

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

        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-primary)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', alignSelf: 'center' }}>Export as:</span>
          {scope === 'disk' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                name="format"
                checked={format === 'image-zip'}
                onChange={() => setFormat('image-zip')}
              />
              ZIP (disk image)
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="format"
              checked={format === 'zip'}
              onChange={() => setFormat('zip')}
            />
            ZIP (files)
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

        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: -8 }}>
          {format === 'image-zip'
            ? 'A ZIP holding the disk image byte-for-byte, named for the metadata above.'
            : `Archive-named TAP/raw files${scope === 'selected' ? ' for the selected entries' : ' for every catalog entry'}, plus any disassembly.`}
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
