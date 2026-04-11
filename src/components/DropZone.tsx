import React, { useState, useCallback, useEffect } from 'react';

interface Props {
  onDrop: (filePath: string) => void;
  overlay?: boolean;
}

export function DropZone({ onDrop, overlay = false }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent | DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent | DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent | DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      const name = file.name.toLowerCase();
      if (/\.(img|dsk|tap|tzx|sna|z80|scr|mgt)$/i.test(name)) {
        onDrop((file as any).path);
      }
    }
  }, [onDrop]);

  // For overlay mode, listen to window-level events
  useEffect(() => {
    if (!overlay) return;
    const el = document.body;
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('drop', handleDrop);
    return () => {
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('drop', handleDrop);
    };
  }, [overlay, handleDragOver, handleDragLeave, handleDrop]);

  if (overlay) {
    if (!isDragOver) return null;
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(233, 69, 96, 0.15)',
        border: '3px dashed var(--accent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '24px 48px',
          borderRadius: 12,
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--accent)',
        }}>
          Drop disk image here
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        border: isDragOver ? '2px dashed var(--accent)' : '2px dashed var(--border)',
        margin: 20,
        borderRadius: 12,
        transition: 'border-color 0.2s',
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>
        {'\uD83D\uDCBE'}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Drop a disk image here
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Supports .img, .dsk, .tap, .tzx, .sna, .z80, .scr, .mgt
      </div>
    </div>
  );
}
