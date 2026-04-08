import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { BasicListing as BasicListingData, FileEdits } from '../api';

interface Props {
  listing: BasicListingData;
  fileEdits?: FileEdits;
  onEditLine?: (lineNumber: number, text: string) => void;
  onRevertLine?: (lineNumber: number) => void;
  onRevertAll?: () => void;
}

const TOKEN_COLORS: Record<string, string> = {
  statement: 'var(--badge-basic)',
  function: '#fce38a',
  operator: '#f0a050',
  'disk-cmd': '#ff6b6b',
  'ts2068-kw': '#c084fc',
  udg: '#ff6b6b',
  graphic: '#a0a0b0',
  text: 'var(--text-primary)',
};

export function BasicListing({ listing, fileEdits, onEditLine, onRevertLine, onRevertAll }: Props) {
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const editCount = fileEdits ? Object.keys(fileEdits).length : 0;

  const maxLineNum = listing.lines.length > 0
    ? Math.max(...listing.lines.map((l) => l.lineNumber))
    : 0;
  const lineNumWidth = String(maxLineNum).length;

  const plainText = useMemo(() => {
    return listing.lines.map((line) => {
      const text = fileEdits?.[line.lineNumber]
        ?? line.tokens.map((t) => t.text).join('');
      return `${String(line.lineNumber).padStart(lineNumWidth, ' ')} ${text}`;
    }).join('\n');
  }, [listing, lineNumWidth, fileEdits]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(plainText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [plainText]);

  const startEdit = useCallback((lineNumber: number, currentText: string) => {
    if (!onEditLine) return;
    setEditingLine(lineNumber);
    setEditText(fileEdits?.[lineNumber] ?? currentText);
  }, [onEditLine, fileEdits]);

  const confirmEdit = useCallback(() => {
    if (editingLine !== null && onEditLine) {
      onEditLine(editingLine, editText);
    }
    setEditingLine(null);
  }, [editingLine, editText, onEditLine]);

  const cancelEdit = useCallback(() => {
    setEditingLine(null);
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editingLine !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingLine]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '4px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {editCount > 0 && (
            <span style={{ color: 'var(--accent)', marginRight: 8 }}>
              {editCount} edited
              {onRevertAll && (
                <span
                  onClick={onRevertAll}
                  style={{ marginLeft: 6, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Revert all
                </span>
              )}
            </span>
          )}
          Double-click a line to edit
        </span>
        <button
          onClick={handleCopy}
          style={{
            background: 'var(--bg-tertiary)',
            color: copied ? 'var(--badge-basic)' : 'var(--text-secondary)',
            fontSize: 10,
            padding: '2px 10px',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '8px 0',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: '20px',
        background: 'var(--bg-primary)',
      }}>
        {listing.lines.map((line) => {
          const isEditing = editingLine === line.lineNumber;
          const isEdited = fileEdits && line.lineNumber in fileEdits;
          const originalText = line.tokens.map((t) => t.text).join('');

          if (isEditing) {
            return (
              <div
                key={line.lineNumber}
                style={{
                  display: 'flex',
                  padding: '0 12px',
                  background: 'rgba(233, 69, 96, 0.2)',
                }}
              >
                <span style={{
                  color: 'var(--text-muted)',
                  minWidth: lineNumWidth * 8 + 16,
                  textAlign: 'right',
                  paddingRight: 16,
                  flexShrink: 0,
                }}>
                  {String(line.lineNumber).padStart(lineNumWidth, ' ')}
                </span>
                <input
                  ref={inputRef}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  onBlur={confirmEdit}
                  style={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    background: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--accent)',
                    borderRadius: 2,
                    padding: '0 4px',
                    outline: 'none',
                  }}
                />
              </div>
            );
          }

          return (
            <div
              key={line.lineNumber}
              onDoubleClick={() => startEdit(line.lineNumber, originalText)}
              style={{
                display: 'flex',
                padding: '0 12px',
                background: isEdited
                  ? 'rgba(78, 205, 196, 0.1)'
                  : listing.autostartLine === line.lineNumber
                    ? 'rgba(233, 69, 96, 0.12)'
                    : 'transparent',
                cursor: onEditLine ? 'text' : 'default',
              }}
            >
              <span style={{
                color: 'var(--text-muted)',
                minWidth: lineNumWidth * 8 + 16,
                textAlign: 'right',
                paddingRight: 16,
                userSelect: 'none',
                flexShrink: 0,
              }}>
                {listing.autostartLine === line.lineNumber && (
                  <span style={{ color: 'var(--accent)', marginRight: 4 }}>{'\u25B6'}</span>
                )}
                {String(line.lineNumber).padStart(lineNumWidth, ' ')}
              </span>
              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1 }}>
                {isEdited ? (
                  <span style={{ color: 'var(--badge-basic)' }}>{fileEdits![line.lineNumber]}</span>
                ) : (
                  line.tokens.map((tok, i) => (
                    <span key={i} style={{
                      color: TOKEN_COLORS[tok.type] ?? 'var(--text-primary)',
                      ...(tok.type === 'disk-cmd' ? {
                        background: 'rgba(255, 107, 107, 0.15)',
                        borderBottom: '1px solid #ff6b6b',
                        borderRadius: 2,
                        padding: '0 2px',
                      } : {}),
                    }}>
                      {tok.text}
                    </span>
                  ))
                )}
              </span>
              {isEdited && onRevertLine && (
                <span
                  onClick={(e) => { e.stopPropagation(); onRevertLine(line.lineNumber); }}
                  style={{
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 10,
                    padding: '0 6px',
                    userSelect: 'none',
                    flexShrink: 0,
                  }}
                  title="Revert this line"
                >
                  {'\u21B6'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
