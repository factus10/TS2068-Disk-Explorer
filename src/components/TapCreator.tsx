import React, { useState, useCallback } from 'react';
import { api, TapFileSpec } from '../api';

interface Props {
  onClose: () => void;
  onStatus: (msg: string) => void;
}

interface FileRow {
  filePath: string;
  fileName: string;
  tapName: string;
  tapType: number;
  param1: number;
  param2: number;
  fileSize: number;
}

export function TapCreator({ onClose, onStatus }: Props) {
  const [files, setFiles] = useState<FileRow[]>([]);

  const handleAddFiles = useCallback(async () => {
    const paths = await api.selectFilesForTap();
    if (!paths) return;

    const newFiles: FileRow[] = paths.map((fp) => {
      const name = fp.split('/').pop()?.split('\\').pop() ?? 'file';
      const baseName = name.replace(/\.[^.]+$/, '').slice(0, 10);
      return {
        filePath: fp,
        fileName: name,
        tapName: baseName,
        tapType: 3, // default to CODE
        param1: 0,
        param2: 32768,
        fileSize: 0,
      };
    });

    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleRemove = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleMoveUp = useCallback((idx: number) => {
    if (idx <= 0) return;
    setFiles((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((idx: number) => {
    setFiles((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const updateField = useCallback((idx: number, field: keyof FileRow, value: string | number) => {
    setFiles((prev) => prev.map((f, i) => i === idx ? { ...f, [field]: value } : f));
  }, []);

  const handleSave = useCallback(async () => {
    if (files.length === 0) return;

    const result = await api.selectDirectory();
    if (!result) return;

    const destPath = result + '/' + (files[0].tapName || 'output') + '.tap';
    const specs: TapFileSpec[] = files.map((f) => ({
      filePath: f.filePath,
      tapName: f.tapName,
      tapType: f.tapType,
      param1: f.param1,
      param2: f.param2,
    }));

    try {
      const path = await api.createTapFromFiles(specs, destPath);
      if (path) onStatus(`Created TAP: ${path.split('/').pop()}`);
      onClose();
    } catch (err: any) {
      onStatus(`Error: ${err.message}`);
    }
  }, [files, onClose, onStatus]);

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    padding: '2px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
    outline: 'none',
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        width: 700,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>Create TAP File</span>
          <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-secondary)', fontSize: 11 }}>
            Close
          </button>
        </div>

        {/* File list */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {files.length === 0 && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
              Click "Add Files" to select files to include in the TAP
            </div>
          )}

          {files.map((f, idx) => (
            <div key={idx} style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
              fontSize: 12,
            }}>
              {/* Reorder buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={() => handleMoveUp(idx)} disabled={idx === 0}
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 9, padding: '0 4px' }}>{'\u25B2'}</button>
                <button onClick={() => handleMoveDown(idx)} disabled={idx === files.length - 1}
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 9, padding: '0 4px' }}>{'\u25BC'}</button>
              </div>

              {/* File info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.fileName}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                    Name:
                    <input value={f.tapName} onChange={(e) => updateField(idx, 'tapName', e.target.value.slice(0, 10))}
                      style={{ ...inputStyle, width: 90, marginLeft: 4 }} />
                  </label>
                  <label style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                    Type:
                    <select value={f.tapType} onChange={(e) => updateField(idx, 'tapType', Number(e.target.value))}
                      style={{ ...inputStyle, marginLeft: 4 }}>
                      <option value={0}>BASIC</option>
                      <option value={1}>Num Array</option>
                      <option value={2}>Str Array</option>
                      <option value={3}>CODE</option>
                    </select>
                  </label>
                  <label style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                    {f.tapType === 0 ? 'Autostart:' : 'Address:'}
                    <input type="number" value={f.param1} onChange={(e) => updateField(idx, 'param1', Number(e.target.value))}
                      style={{ ...inputStyle, width: 60, marginLeft: 4 }} />
                  </label>
                </div>
              </div>

              {/* Remove button */}
              <button onClick={() => handleRemove(idx)}
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', fontSize: 11, padding: '2px 8px' }}>
                {'\u2715'}
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px',
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <button onClick={handleAddFiles}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
            Add Files
          </button>
          <button onClick={handleSave} disabled={files.length === 0}
            style={{ background: 'var(--accent)', color: '#fff' }}>
            Save TAP
          </button>
        </div>
      </div>
    </div>
  );
}
