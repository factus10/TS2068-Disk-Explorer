import React, { useEffect, useState } from 'react';
import { api, Settings } from '../api';

interface Props {
  onClose: () => void;
}

/**
 * Settings, in a modal over the browser rather than a second window.
 *
 * There is one setting and it is a folder, so a separate BrowserWindow would
 * cost its own IPC channel and lifecycle for no gain. Opened from
 * File ▸ Preferences (Cmd/Ctrl+,).
 */
export function Preferences({ onClose }: Props) {
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ dir: string; images: number; folders: number; programs: number; archived: number } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings({}));
    api.getCatalogSummary().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  // Escape closes, as it does in every other dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choose = async () => {
    const dir = await api.pickExtractionDir();
    if (dir) setSettings((s) => ({ ...s, extractionDir: dir }));
  };

  const clear = async () => {
    const next = await api.updateSettings({ extractionDir: undefined });
    setSettings(next);
  };

  const checkUpdate = async () => {
    setChecking(true);
    try {
      const r = await api.checkCatalogUpdate(false);
      setCheckMessage(r.message);
      setSettings(await api.getSettings());
      if (r.updated) setCatalog(await api.getCatalogSummary());
    } catch (err: any) {
      setCheckMessage(`Check failed: ${err.message}`);
    }
    setChecking(false);
  };

  const chooseCatalog = async () => {
    const dir = await api.pickCatalogDir();
    if (!dir) return;
    setSettings((prev) => ({ ...prev, catalogDir: dir }));
    setCatalog(await api.getCatalogSummary());
  };

  const clearCatalog = async () => {
    await api.clearCatalogDir();
    setSettings((prev) => ({ ...prev, catalogDir: undefined }));
    setCatalog(null);
  };

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
          borderRadius: 6, width: 520, maxWidth: '90vw', padding: 20,
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>Preferences</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btn}>Close</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
          Extraction folder
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
          Where the file browser starts when you extract. Disassemblies are written beside
          the files they describe, so this is also where a <code>.dis</code> ends up.
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '8px 10px',
        }}>
          <span style={{
            flex: 1, fontSize: 11, fontFamily: 'var(--mono, monospace)',
            color: settings?.extractionDir ? 'var(--text-primary)' : 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            direction: 'rtl', textAlign: 'left',
          }}>
            {settings === null ? 'Loading...'
              : settings.extractionDir ?? 'Not set — you will be asked the first time you extract'}
          </span>
          <button onClick={choose} style={btn}>Choose...</button>
          {settings?.extractionDir && <button onClick={clear} style={btn}>Clear</button>}
        </div>

        <div style={{ height: 1, background: 'var(--border)', margin: '18px 0' }} />

        <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
          Catalogue folder
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
          A catalogue built by <code>build-catalog</code>, holding <code>occurrences.csv</code>.
          With one set, the file browser shows how much of each disk is already archived, and
          you can mark a disk from there. Marks are written to <code>marks.json</code>, which is
          shared with the catalogue scripts &mdash; the CSVs are left alone, since re-rendering
          the catalogue rewrites them.
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '8px 10px',
        }}>
          <span style={{
            flex: 1, fontSize: 11, fontFamily: 'var(--mono, monospace)',
            color: settings?.catalogDir ? 'var(--text-primary)' : 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            direction: 'rtl', textAlign: 'left',
          }}>
            {settings === null ? 'Loading...' : settings.catalogDir ?? 'Not set'}
          </span>
          <button onClick={chooseCatalog} style={btn}>Choose...</button>
          {settings?.catalogDir && <button onClick={clearCatalog} style={btn}>Clear</button>}
        </div>

        {settings?.catalogDir && (
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10,
            fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={settings.markArchivedOnExport !== false}
              onChange={async (e) => {
                const next = await api.updateSettings({ markArchivedOnExport: e.target.checked });
                setSettings(next);
              }}
              style={{ marginTop: 2 }}
            />
            <span>
              Mark programs archived when I export them as a package or for archive.org.
              Plain extraction never marks anything &mdash; extracting to a working folder
              is not archiving.
            </span>
          </label>
        )}

        <div style={{ height: 1, background: 'var(--border)', margin: '18px 0' }} />

        <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
          Program list
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
          A list of every program the collection is known to hold travels inside the app, so a
          freshly imaged disk can be told apart from one already held. It is current on the day
          you install and drifts afterwards; checking fetches the published copy from GitHub.
          Nothing in your collection or your catalogue is touched either way.
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={checkUpdate} style={btn} disabled={checking}>
            {checking ? 'Checking...' : 'Check now'}
          </button>
          {settings?.catalogUpdate?.checkedAt && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              last checked {new Date(settings.catalogUpdate.checkedAt).toLocaleString()}
            </span>
          )}
        </div>
        {checkMessage && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>{checkMessage}</div>
        )}

        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10,
          fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={settings?.autoCheckCatalogUpdate === true}
            onChange={async (e) => {
              const next = await api.updateSettings({ autoCheckCatalogUpdate: e.target.checked });
              setSettings(next);
            }}
            style={{ marginTop: 2 }}
          />
          <span>Check for a newer program list when the app starts. Off by default, because it is
            a network request you did not ask for.</span>
        </label>

        {catalog && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
            {catalog.programs.toLocaleString()} programs across {catalog.images.toLocaleString()} images
            in {catalog.folders} folders &mdash;{' '}
            <strong style={{ color: 'var(--badge-basic)' }}>{catalog.archived.toLocaleString()} marked archived</strong>.
          </div>
        )}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
  border: '1px solid var(--border)', fontSize: 11, padding: '4px 10px', borderRadius: 3,
  whiteSpace: 'nowrap',
};
