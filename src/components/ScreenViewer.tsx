import React, { useRef, useEffect, useState, useCallback } from 'react';
import { api, FileEntry } from '../api';

interface Props {
  entry: FileEntry;
  diskPath: string;
}

const WIDTH = 256;
const HEIGHT = 192;
const DEFAULT_SCALE = 2;

export function ScreenViewer({ entry, diskPath }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [invert, setInvert] = useState(false);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [rgbaData, setRgbaData] = useState<number[] | null>(null);

  // Load screen data
  useEffect(() => {
    let cancelled = false;
    api.getScreenData(diskPath, entry.index, invert).then((data) => {
      if (!cancelled) setRgbaData(data);
    });
    return () => { cancelled = true; };
  }, [diskPath, entry.index, invert]);

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

  const handleExportPng = useCallback(() => {
    if (!rgbaData) return;
    // Create offscreen canvas at export scale
    const offscreen = document.createElement('canvas');
    offscreen.width = WIDTH * scale;
    offscreen.height = HEIGHT * scale;
    const ctx = offscreen.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Draw 1x first
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = WIDTH;
    tmpCanvas.height = HEIGHT;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    const imageData = tmpCtx.createImageData(WIDTH, HEIGHT);
    for (let i = 0; i < rgbaData.length; i++) {
      imageData.data[i] = rgbaData[i];
    }
    tmpCtx.putImageData(imageData, 0, 0);

    // Scale up with nearest-neighbor
    ctx.drawImage(tmpCanvas, 0, 0, WIDTH * scale, HEIGHT * scale);

    const link = document.createElement('a');
    link.download = `${entry.filename.trim()}_${scale}x.png`;
    link.href = offscreen.toDataURL('image/png');
    link.click();
  }, [rgbaData, scale, entry.filename]);

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
      <canvas
        ref={canvasRef}
        style={{
          width: WIDTH * DEFAULT_SCALE,
          height: HEIGHT * DEFAULT_SCALE,
          imageRendering: 'pixelated',
          border: '1px solid var(--border)',
        }}
      />
      <div style={{
        display: 'flex',
        gap: 8,
        marginTop: 10,
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
            onClick={() => { setScale(s); }}
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
