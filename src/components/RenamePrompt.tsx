import React, { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  title: string;
  message?: string;
  defaultValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function RenamePrompt({ title, message, defaultValue, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(value);
  }, [value, onConfirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  return (
    <div
      onKeyDown={handleKeyDown}
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          {title}
        </div>
        {message && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{message}</div>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
            OK
          </button>
        </div>
      </form>
    </div>
  );
}
