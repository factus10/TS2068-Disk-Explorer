import React, { useRef, useEffect, useState, useCallback } from 'react';

interface Props {
  data: number[];
  filename?: string;
}

const ICON_SIZE_BYTES = 256;
const WIDTH = 32;
const HEIGHT = 64;
const DEFAULT_SCALE = 6;

/**
 * Larken 256-byte icon format: 32 pixels wide × 64 pixels tall, 1 bit per pixel,
 * linear raster order (4 bytes per row, most-significant-bit = leftmost pixel).
 * Used by .CG files on icon collections like Icons(L).img.
 */
export function isIconData(data: number[]): boolean {
  return data.length === ICON_SIZE_BYTES;
}

function renderIcon(data: number[], invert: boolean): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let bx = 0; bx < 4; bx++) {
      const byte = data[y * 4 + bx] ?? 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + (7 - bit);
        let on = ((byte >> bit) & 1) === 1;
        if (invert) on = !on;
        const idx = (y * WIDTH + x) * 4;
        const v = on ? 0 : 255;
        rgba[idx] = v;
        rgba[idx + 1] = v;
        rgba[idx + 2] = v;
        rgba[idx + 3] = 255;
      }
    }
  }
  return rgba;
}

export function IconViewer({ data, filename }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [invert, setInvert] = useState(false);
  const [scale, setScale] = useState(DEFAULT_SCALE);

  // Draw to the on-screen canvas at display scale
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d')!;
    const rgba = renderIcon(data, invert);
    const imageData = ctx.createImageData(WIDTH, HEIGHT);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
  }, [data, invert]);

  const handleExportPng = useCallback(() => {
    const tmp = document.createElement('canvas');
    tmp.width = WIDTH;
    tmp.height = HEIGHT;
    const tmpCtx = tmp.getContext('2d')!;
    const rgba = renderIcon(data, invert);
    const imageData = tmpCtx.createImageData(WIDTH, HEIGHT);
    imageData.data.set(rgba);
    tmpCtx.putImageData(imageData, 0, 0);

    const out = document.createElement('canvas');
    out.width = WIDTH * scale;
    out.height = HEIGHT * scale;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, WIDTH * scale, HEIGHT * scale);

    const link = document.createElement('a');
    link.download = `${(filename ?? 'icon').trim()}_${scale}x.png`;
    link.href = out.toDataURL('image/png');
    link.click();
  }, [data, invert, scale, filename]);

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
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
        32 × 64 monochrome icon (256 bytes)
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: WIDTH * DEFAULT_SCALE,
          height: HEIGHT * DEFAULT_SCALE,
          imageRendering: 'pixelated',
          border: '1px solid var(--border)',
          background: '#fff',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 11 }}>
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
        {[1, 2, 4, 8].map((s) => (
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
