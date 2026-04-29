# Resizable Sidebar Divider (React)

A 5px-wide vertical divider with drag-to-resize. Fixes the "keeps moving after mouse release" bug and shows a hover highlight. Works in any Electron/React project.

## Bug root cause

The common "divider keeps moving after release" bug happens when `mousemove`/`mouseup` listeners are attached to the **divider element itself** (or a React `onMouseMove` handler that re-renders). When the cursor moves off the thin 1–2px divider during a fast drag, the listener stops firing and never sees `mouseup`. The fix: attach listeners to `document`, not the element.

Also attach them only during a drag, and always remove them in the `mouseup` handler.

## Complete pattern

```tsx
import React, { useState, useCallback, useRef } from 'react';

const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 180;
const MAX_WIDTH = 450;

export function SidebarWithDivider() {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();                    // don't start a text selection
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    // Define handlers inside so they capture startX/startWidth as refs.
    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX.current;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta)));
    };

    const handleMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    // Attach to DOCUMENT, not the divider element — that's what fixes the
    // "keeps moving after release" bug. When listeners are on the element,
    // a fast drag can outrun the cursor off the 5px strip and the element
    // never sees mouseup. Document always sees it.
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Global cursor + no text selection during drag
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width, flexShrink: 0 }}>
      <div style={{ flex: 1, overflow: 'hidden' /* your sidebar content */ }}>
        {/* sidebar content here */}
      </div>

      {/* The divider itself — 5px wide, always visible, highlights on hover */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          width: 5,
          cursor: 'col-resize',
          background: 'var(--border)',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          // Don't revert color if still dragging — the cursor may have
          // moved off the divider but the drag is still active.
          if (!dragging.current) {
            (e.currentTarget as HTMLElement).style.background = 'var(--border)';
          }
        }}
      />
    </div>
  );
}
```

## Key details that matter

1. **5px width** — narrow enough to feel like a divider, wide enough to be grabbable without pixel-hunting. 1–2px dividers are hostile to fast mice.
2. **`flexShrink: 0`** on both the sidebar container AND the divider — without this, the flex layout will "help" by shrinking them under pressure and the widths won't match `state`.
3. **`dragging` ref, not state** — the drag flag must be read synchronously in the mousemove handler. Using `useState` would stale-close over the handler.
4. **`document.body.style.cursor`** — forces `col-resize` cursor globally during drag, so even if the cursor briefly leaves the divider strip it still looks like a drag.
5. **`document.body.style.userSelect = 'none'`** during drag — prevents the page from highlighting text as the user drags across labels.
6. **`e.preventDefault()` in `onMouseDown`** — stops the browser from starting a text selection or drag-and-drop that would hijack the mouse.
7. **Mouse listeners on `document`, not the divider** — the fix for the hang-after-release bug. The divider is only 5px wide; at drag speeds above ~100 px/frame the cursor leaves the element entirely, and any element-level `mouseup` handler never fires. Document-level listeners always fire regardless of where the cursor is.

## Variations

- **Right-edge divider** (resize from the right instead of the left) — same code, just put the divider first in the flex row, or flip the delta sign: `startWidth.current - delta`.
- **Horizontal divider** (resize height instead of width) — swap `clientX`→`clientY`, `width`→`height`, `col-resize`→`row-resize`, and use `flexDirection: 'column'`.
- **Persist width** — wrap `setWidth` to also `localStorage.setItem('sidebarWidth', String(newWidth))` and initialize state from `localStorage.getItem('sidebarWidth')`.
- **Double-click to reset** — add `onDoubleClick={() => setWidth(DEFAULT_WIDTH)}` on the divider.
