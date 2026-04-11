import React, { useRef, useEffect, useState, useCallback } from 'react';
import { api, FileEntry } from '../api';

interface Props {
  entry: FileEntry;
  diskPath: string;
  screenEntries?: FileEntry[]; // all screen entries on the disk for slideshow
}

const WIDTH = 256;
const HEIGHT = 192;
const DEFAULT_SCALE = 2;

export function ScreenViewer({ entry, diskPath, screenEntries }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [invert, setInvert] = useState(false);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [rgbaData, setRgbaData] = useState<number[] | null>(null);
  const [currentEntry, setCurrentEntry] = useState(entry);
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef(false);

  // Sync current entry when parent entry changes
  useEffect(() => {
    setCurrentEntry(entry);
  }, [entry.index]);

  // Load screen data
  useEffect(() => {
    let cancelled = false;
    api.getScreenData(diskPath, currentEntry.index, invert).then((data) => {
      if (!cancelled) setRgbaData(data);
    });
    return () => { cancelled = true; };
  }, [diskPath, currentEntry.index, invert]);

  // Render to canvas
  useEffect(() => {
    if (!rgbaData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(WIDTH, HEIGHT);
    for (let i = 0; i < rgbaData.length; i++) {
      imageData.data[i] = rgbaData[i];
    }
    ctx.putImageData(imageData, 0, 0);
  }, [rgbaData]);

  // Slideshow navigation
  const screens = screenEntries ?? [entry];
  const currentIdx = screens.findIndex((s) => s.index === currentEntry.index);

  const goNext = useCallback(() => {
    if (screens.length <= 1) return;
    const next = (currentIdx + 1) % screens.length;
    setCurrentEntry(screens[next]);
  }, [screens, currentIdx]);

  const goPrev = useCallback(() => {
    if (screens.length <= 1) return;
    const prev = (currentIdx - 1 + screens.length) % screens.length;
    setCurrentEntry(screens[prev]);
  }, [screens, currentIdx]);

  // Auto-play timer
  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  useEffect(() => {
    if (!autoPlay || screens.length <= 1) return;
    const timer = setInterval(() => {
      if (autoPlayRef.current) goNext();
    }, 3000);
    return () => clearInterval(timer);
  }, [autoPlay, screens.length, goNext]);

  const handleExportPng = useCallback(() => {
    if (!rgbaData) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = WIDTH * scale;
    offscreen.height = HEIGHT * scale;
    const ctx = offscreen.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = WIDTH;
    tmpCanvas.height = HEIGHT;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    const imageData = tmpCtx.createImageData(WIDTH, HEIGHT);
    for (let i = 0; i < rgbaData.length; i++) {
      imageData.data[i] = rgbaData[i];
    }
    tmpCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tmpCanvas, 0, 0, WIDTH * scale, HEIGHT * scale);

    const link = document.createElement('a');
    link.download = `${currentEntry.filename.trim()}_${scale}x.png`;
    link.href = offscreen.toDataURL('image/png');
    link.click();
  }, [rgbaData, scale, currentEntry.filename]);

  const hasSlideshow = screens.length > 1;

  return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 12,
      background: 'var(--bg-primary)',
    }}>
      {/* Slideshow title */}
      {hasSlideshow && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{currentEntry.filename.trim()}</span>
          <span style={{ marginLeft: 8 }}>{currentIdx + 1} / {screens.length}</span>
        </div>
      )}

      <canvas
        ref={canvasRef}
        style={{
          width: WIDTH * DEFAULT_SCALE,
          height: HEIGHT * DEFAULT_SCALE,
          imageRendering: 'pixelated',
          border: '1px solid var(--border)',
        }}
      />

      {/* Slideshow controls */}
      {hasSlideshow && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 11 }}>
          <button onClick={goPrev}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13, padding: '3px 10px' }}>
            {'\u25C0'}
          </button>
          <button
            onClick={() => setAutoPlay((v) => !v)}
            style={{
              background: autoPlay ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: autoPlay ? '#fff' : 'var(--text-primary)',
              fontSize: 11,
              padding: '3px 10px',
            }}
          >
            {autoPlay ? 'Stop' : 'Play'}
          </button>
          <button onClick={goNext}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13, padding: '3px 10px' }}>
            {'\u25B6'}
          </button>
        </div>
      )}

      {/* Export controls */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginTop: 8,
        alignItems: 'center',
        fontSize: 11,
      }}>
        <button
          onClick={() => setInvert((v) => !v)}
          style={{
            background: invert ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: invert ? '#fff' : 'var(--text-primary)',
            fontSize: 11,
            padding: '3px 10px',
          }}
        >
          Invert
        </button>
        <span style={{ color: 'var(--text-secondary)' }}>Export:</span>
        {[1, 2, 4].map((s) => (
          <button
            key={s}
            onClick={() => setScale(s)}
            style={{
              background: scale === s ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: scale === s ? '#fff' : 'var(--text-primary)',
              fontSize: 11,
              padding: '3px 8px',
              minWidth: 30,
            }}
          >
            {s}x
          </button>
        ))}
        <button
          onClick={handleExportPng}
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--badge-basic)',
            fontSize: 11,
            padding: '3px 10px',
          }}
        >
          Save PNG
        </button>
      </div>
    </div>
  );
}
