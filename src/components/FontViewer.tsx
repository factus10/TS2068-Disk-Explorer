import React, { useRef, useEffect, useState, useCallback } from 'react';
import opentype from 'opentype.js';

interface Props {
  data: number[];
  filename?: string;
}

const CHARS_PER_ROW = 16;
const CHAR_WIDTH = 8;
const CHAR_HEIGHT = 8;
const CELL_PAD = 1; // padding between characters
const LABEL_HEIGHT = 12; // space for character label below

const FONT_SIZE = 768; // 96 chars × 8 bytes
const FIRST_CHAR = 0x20; // space
const NUM_CHARS = 96;

export function isFontData(data: number[]): boolean {
  return data.length === FONT_SIZE;
}

/**
 * Convert 8x8 bitmap font data to a TTF font using opentype.js.
 * Each pixel becomes a vector square in the glyph outline.
 */
function buildTtfFont(data: number[], familyName: string): ArrayBuffer {
  const UNITS_PER_EM = 1024;
  const PIXEL = UNITS_PER_EM / CHAR_HEIGHT; // 128 units per pixel
  const ASCENDER = UNITS_PER_EM;
  const DESCENDER = 0;

  // .notdef glyph (required)
  const notdefPath = new opentype.Path();
  notdefPath.moveTo(0, 0);
  notdefPath.lineTo(PIXEL * CHAR_WIDTH, 0);
  notdefPath.lineTo(PIXEL * CHAR_WIDTH, ASCENDER);
  notdefPath.lineTo(0, ASCENDER);
  notdefPath.close();

  const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: PIXEL * CHAR_WIDTH,
    path: notdefPath,
  });

  const glyphs: opentype.Glyph[] = [notdefGlyph];

  for (let ch = 0; ch < NUM_CHARS; ch++) {
    const charCode = FIRST_CHAR + ch;
    const path = new opentype.Path();

    // Trace each set pixel as a square
    for (let py = 0; py < CHAR_HEIGHT; py++) {
      const byte = data[ch * 8 + py];
      for (let px = 0; px < CHAR_WIDTH; px++) {
        if (!((byte >> (7 - px)) & 1)) continue;

        // Font coordinates: x goes right, y goes up (opposite of screen)
        const x = px * PIXEL;
        const y = (CHAR_HEIGHT - 1 - py) * PIXEL;

        // Draw clockwise square (required for filled shape in TTF)
        path.moveTo(x, y);
        path.lineTo(x, y + PIXEL);
        path.lineTo(x + PIXEL, y + PIXEL);
        path.lineTo(x + PIXEL, y);
        path.close();
      }
    }

    const glyph = new opentype.Glyph({
      name: charCode === 0x20 ? 'space' : `char${charCode}`,
      unicode: charCode,
      advanceWidth: PIXEL * CHAR_WIDTH,
      path,
    });

    glyphs.push(glyph);
  }

  const font = new opentype.Font({
    familyName,
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: ASCENDER,
    descender: DESCENDER,
    glyphs,
  });

  return font.toArrayBuffer();
}

export function FontViewer({ data, filename }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(3);
  const [ink, setInk] = useState('#e0e0e0');
  const [paper, setPaper] = useState('#1a1a2e');

  const cellW = CHAR_WIDTH * scale + CELL_PAD * 2;
  const cellH = CHAR_HEIGHT * scale + CELL_PAD * 2 + LABEL_HEIGHT;
  const cols = CHARS_PER_ROW;
  const rows = Math.ceil(NUM_CHARS / cols);
  const canvasW = cols * cellW;
  const canvasH = rows * cellH;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < FONT_SIZE) return;

    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvasW, canvasH);

    for (let ch = 0; ch < NUM_CHARS; ch++) {
      const col = ch % cols;
      const row = Math.floor(ch / cols);
      const x0 = col * cellW + CELL_PAD;
      const y0 = row * cellH + CELL_PAD;

      // Draw character pixels
      for (let py = 0; py < CHAR_HEIGHT; py++) {
        const byte = data[ch * 8 + py];
        for (let px = 0; px < CHAR_WIDTH; px++) {
          const isSet = (byte >> (7 - px)) & 1;
          if (isSet) {
            ctx.fillStyle = ink;
            ctx.fillRect(x0 + px * scale, y0 + py * scale, scale, scale);
          }
        }
      }

      // Draw character label
      const charCode = FIRST_CHAR + ch;
      const label = charCode >= 0x20 && charCode <= 0x7e
        ? String.fromCharCode(charCode)
        : '·';
      ctx.fillStyle = '#666680';
      ctx.font = `${Math.max(9, scale * 2.5)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x0 + (CHAR_WIDTH * scale) / 2, y0 + CHAR_HEIGHT * scale + LABEL_HEIGHT - 2);
    }
  }, [data, scale, ink, paper, canvasW, canvasH]);

  const handleExportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const baseName = (filename || 'font').replace(/\.[^.]+$/, '').trim() || 'font';
    const link = document.createElement('a');
    link.download = `${baseName}_${scale}x.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [scale, filename]);

  const handleExportTtf = useCallback(() => {
    if (data.length < FONT_SIZE) return;
    const name = (filename || 'ZXFont').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '');
    const buffer = buildTtfFont(data, name || 'ZXFont');
    const blob = new Blob([buffer], { type: 'font/ttf' });
    const link = document.createElement('a');
    link.download = `${name || 'ZXFont'}.ttf`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }, [data, filename]);

  // Sample text preview
  const [sampleText, setSampleText] = useState('The quick brown fox jumps over the lazy dog');
  const sampleCanvasRef = useRef<HTMLCanvasElement>(null);
  const sampleScale = 2;

  useEffect(() => {
    const canvas = sampleCanvasRef.current;
    if (!canvas || data.length < FONT_SIZE) return;

    const textLen = sampleText.length;
    const w = textLen * CHAR_WIDTH * sampleScale;
    const h = CHAR_HEIGHT * sampleScale;
    canvas.width = Math.max(w, 1);
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < textLen; i++) {
      const code = sampleText.charCodeAt(i);
      const charIdx = code - FIRST_CHAR;
      if (charIdx < 0 || charIdx >= NUM_CHARS) continue;

      for (let py = 0; py < CHAR_HEIGHT; py++) {
        const byte = data[charIdx * 8 + py];
        for (let px = 0; px < CHAR_WIDTH; px++) {
          if ((byte >> (7 - px)) & 1) {
            ctx.fillStyle = ink;
            ctx.fillRect((i * CHAR_WIDTH + px) * sampleScale, py * sampleScale, sampleScale, sampleScale);
          }
        }
      }
    }
  }, [data, sampleText, ink, paper]);

  return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column',
      padding: 12,
      gap: 12,
      background: 'var(--bg-primary)',
    }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Scale:</span>
        {[2, 3, 4].map((s) => (
          <button
            key={s}
            onClick={() => setScale(s)}
            style={{
              background: scale === s ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: scale === s ? '#fff' : 'var(--text-primary)',
              fontSize: 11,
              padding: '2px 8px',
            }}
          >
            {s}x
          </button>
        ))}
        <button
          onClick={handleExportPng}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--badge-basic)', fontSize: 11, padding: '2px 10px' }}
        >
          Save PNG
        </button>
        <button
          onClick={handleExportTtf}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', fontSize: 11, padding: '2px 10px' }}
        >
          Save TTF
        </button>
      </div>

      {/* Character grid */}
      <canvas
        ref={canvasRef}
        style={{ imageRendering: 'pixelated', border: '1px solid var(--border)' }}
      />

      {/* Sample text */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          placeholder="Type sample text..."
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '4px 8px',
            outline: 'none',
          }}
        />
        <canvas
          ref={sampleCanvasRef}
          style={{ imageRendering: 'pixelated', border: '1px solid var(--border)', maxWidth: '100%' }}
        />
      </div>
    </div>
  );
}
