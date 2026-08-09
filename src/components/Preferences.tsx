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
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings({}));
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
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
  border: '1px solid var(--border)', fontSize: 11, padding: '4px 10px', borderRadius: 3,
  whiteSpace: 'nowrap',
};
