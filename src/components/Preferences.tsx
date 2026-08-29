import React, { useEffect, useState } from 'react';
import { api, Settings, EmulatorStatus } from '../api';

interface Props {
  onClose: () => void;
}

/**
 * Settings, in a modal over the browser rather than a second window.
 *
 * The settings are few and mostly paths, so a separate BrowserWindow would
 * cost its own IPC channel and lifecycle for no gain. Opened from
 * File ▸ Preferences (Cmd/Ctrl+,).
 */
export function Preferences({ onClose }: Props) {
  const [shipped, setShipped] = useState<import('../api').ShippedComparison | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ dir: string; images: number; folders: number; programs: number; archived: number } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [emulator, setEmulator] = useState<EmulatorStatus | null>(null);
  const [wpUrl, setWpUrl] = useState('');
  const [wpDefault, setWpDefault] = useState('http://localhost');
  const [wpTesting, setWpTesting] = useState(false);
  const [wpMessage, setWpMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings({}));
    api.getCatalogSummary().then(setCatalog).catch(() => setCatalog(null));
    api.compareShippedList().then(setShipped).catch(() => setShipped(null));
    api.getEmulatorStatus().then(setEmulator).catch(() => setEmulator({ path: null, configured: false }));
    api.wpStatus().then((w) => { setWpUrl(w.url ?? ''); setWpDefault(w.defaultUrl); }).catch(() => { /* leave blank */ });
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

  /**
   * Ask the address whether it holds an archive, and only keep it if it does.
   * Saving an address that answers nothing would leave every later lookup
   * failing with no clue as to why.
   */
  const testWp = async () => {
    const target = wpUrl.trim() || wpDefault;
    setWpTesting(true);
    setWpMessage(null);
    try {
      const r = await api.wpTest(target);
      if (r.ok) {
        await api.wpSaveUrl(target);
        setWpUrl(target);
        setSettings((prev) => ({ ...prev, wordpressUrl: target }));
        setWpMessage({ ok: true, text: `${r.name} — ${r.records.toLocaleString()} published programs. Saved.` });
      } else {
        setWpMessage({ ok: false, text: r.error });
      }
    } catch (err: any) {
      setWpMessage({ ok: false, text: err.message });
    }
    setWpTesting(false);
  };

  const clearWp = async () => {
    await api.wpSaveUrl('');
    setWpUrl('');
    setWpMessage(null);
    setSettings((prev) => ({ ...prev, wordpressUrl: undefined }));
  };

  const chooseCatalog = async () => {
    const dir = await api.pickCatalogDir();
    if (!dir) return;
    setSettings((prev) => ({ ...prev, catalogDir: dir }));
    setCatalog(await api.getCatalogSummary());
    setShipped(await api.compareShippedList());
  };

  const chooseEmulator = async () => {
    setEmulator(await api.pickEmulator());
  };

  const clearEmulator = async () => {
    setEmulator(await api.clearEmulator());
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
          Emulator
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
          Run hands the selected program to <strong>ZEsarUX</strong>, which is the
          emulator that covers every machine these disks came from and the only
          one that can be told which machine to be from the command line. It
          launches with your own emulator settings left untouched, so nothing
          here changes how ZEsarUX behaves when you start it yourself. Only
          worth setting when it lives somewhere the app does not think to look.
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '8px 10px',
        }}>
          <span style={{
            flex: 1, fontSize: 11, fontFamily: 'var(--mono, monospace)',
            color: emulator?.path ? 'var(--text-primary)' : 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            direction: 'rtl', textAlign: 'left',
          }}>
            {emulator === null ? 'Looking...'
              : emulator.path ?? 'Not found — install ZEsarUX, or point at it here'}
          </span>
          <button onClick={chooseEmulator} style={btn}>Choose...</button>
          {emulator?.configured && <button onClick={clearEmulator} style={btn}>Clear</button>}
        </div>
        {emulator?.path && !emulator.configured && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
            Found on its own — nothing to set.
          </div>
        )}

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
              Mark programs archived when I get them out of an image &mdash; extracting,
              a package, or an archive.org bundle. You can always mark a program by hand
              from the toolbar, which is how to record a copy the catalogue could not
              match on its own.
            </span>
          </label>
        )}

        <div style={{ height: 1, background: 'var(--border)', margin: '18px 0' }} />

        <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
          Published archive
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
          The WordPress site holding the published <code>computer_media</code> records &mdash;
          a local copy of it, usually. With one set, a selected program says whether it is
          already published, File &#9656; Search the Published Archive looks one up by name or
          by a line of its listing, and the catalogue&rsquo;s matches can be refreshed from the
          site. Everything here reads; nothing is ever written back to WordPress.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            value={wpUrl}
            placeholder={wpDefault}
            onChange={(e) => { setWpUrl(e.target.value); setWpMessage(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') testWp(); }}
            style={{
              flex: 1, fontSize: 11, fontFamily: 'var(--mono, monospace)', padding: '6px 8px',
              background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 3,
            }}
          />
          <button onClick={testWp} style={btn} disabled={wpTesting}>
            {wpTesting ? 'Testing...' : 'Test and save'}
          </button>
          {settings?.wordpressUrl && <button onClick={clearWp} style={btn}>Clear</button>}
        </div>

        {wpMessage && (
          <div style={{
            fontSize: 11, marginTop: 8, lineHeight: 1.5,
            color: wpMessage.ok ? 'var(--accent)' : 'var(--badge-dump, #d97706)',
          }}>
            {wpMessage.text}
          </div>
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

        {shipped && (
          <div style={{
            fontSize: 11, marginTop: 10, padding: '8px 10px', borderRadius: 4,
            border: `1px solid ${shipped.inStep ? 'var(--border)' : 'var(--badge-dir)'}`,
            color: shipped.inStep ? 'var(--text-secondary)' : 'var(--text-primary)',
            lineHeight: 1.6,
          }}>
            {shipped.inStep ? (
              <>
                The list shipping with the app matches your catalogue —{' '}
                {shipped.catalogPrograms.toLocaleString()} programs. Nothing to publish.
              </>
            ) : (
              <>
                <strong style={{ color: 'var(--badge-dir)' }}>
                  The list shipping with the app has fallen behind your catalogue.
                </strong>
                <br />
                {shipped.added > 0 && <>{shipped.added.toLocaleString()} program(s) it does not have. </>}
                {shipped.removed > 0 && <>{shipped.removed.toLocaleString()} it has that you no longer do. </>}
                {shipped.statusChanged > 0 && (
                  <>{shipped.statusChanged.toLocaleString()} whose archived state has changed. </>
                )}
                <br />
                <span style={{ color: 'var(--text-muted)' }}>
                  Use Update Shared Program List in the File menu, commit the file, and it reaches
                  everyone else on the next release.
                </span>
              </>
            )}
          </div>
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
