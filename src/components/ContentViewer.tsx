import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api, FileEntry, BasicListing as BasicListingData, ArrayData, Ts2068Mode } from '../api';
import { HexView } from './HexView';
import { BasicListing } from './BasicListing';
import { ScreenViewer } from './ScreenViewer';
import { ArrayViewer } from './ArrayViewer';

const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 360;
const MAX_WIDTH = 900;

interface Props {
  entry: FileEntry;
  diskPath: string;
  onClose: () => void;
}

type ViewTab = 'listing' | 'screen' | 'array' | 'hex';

const SCREEN_SIZE = 6912;

function getAvailableTabs(entry: FileEntry): ViewTab[] {
  const tabs: ViewTab[] = [];
  if (entry.type === 'basic') tabs.push('listing');
  if (entry.type === 'state' || entry.isMemoryDump) tabs.push('listing');
  if (entry.type === 'code' && entry.size === SCREEN_SIZE) tabs.push('screen');
  if (entry.type === 'num-array' || entry.type === 'str-array') tabs.push('array');
  tabs.push('hex');
  return tabs;
}

const TAB_LABELS: Record<ViewTab, string> = {
  listing: 'Listing',
  screen: 'Screen',
  array: 'Array',
  hex: 'Hex',
};

export function ContentViewer({ entry, diskPath, onClose }: Props) {
  const tabs = getAvailableTabs(entry);
  const [activeTab, setActiveTab] = useState<ViewTab>(tabs[0]);

  // Content state (loaded lazily per tab)
  const [hexData, setHexData] = useState<number[] | null>(null);
  const [listing, setListing] = useState<BasicListingData | null>(null);
  const [arrayData, setArrayData] = useState<ArrayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [ts2068Mode, setTs2068Mode] = useState<Ts2068Mode>('auto');

  // Reset when entry changes
  useEffect(() => {
    const newTabs = getAvailableTabs(entry);
    setActiveTab(newTabs[0]);
    setHexData(null);
    setListing(null);
    setArrayData(null);
  }, [entry.index]);

  // Re-fetch listing when mode changes
  useEffect(() => {
    if (activeTab !== 'listing') return;
    let cancelled = false;
    setListing(null);
    setLoading(true);
    api.getBasicListing(diskPath, entry.index, ts2068Mode).then((data) => {
      if (!cancelled) { setListing(data); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ts2068Mode, diskPath, entry.index, activeTab]);

  // Load data for active tab (non-listing)
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      try {
        if (activeTab === 'hex' && !hexData) {
          const data = await api.getFileData(diskPath, entry.index);
          if (!cancelled) setHexData(data);
        } else if (activeTab === 'array' && !arrayData) {
          const data = await api.getArrayData(diskPath, entry.index);
          if (!cancelled) setArrayData(data);
        }
        // listing handled by ts2068Mode effect above
        // screen tab loads its own data via ScreenViewer
      } catch {
        // ignore
      }
      if (!cancelled) setLoading(false);
    };

    if (activeTab !== 'listing') loadData();
    return () => { cancelled = true; };
  }, [activeTab, diskPath, entry.index, hexData, arrayData]);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - ev.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  const hasListing = tabs.includes('listing');

  return (
    <div style={{
      width,
      display: 'flex',
      flexDirection: 'row',
      flexShrink: 0,
    }}>
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          width: 5,
          cursor: 'col-resize',
          background: 'var(--border)',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
        onMouseLeave={(e) => { if (!dragging.current) (e.currentTarget as HTMLElement).style.background = 'var(--border)'; }}
      />
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      {/* Header */}
      <div style={{
        padding: '6px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>{entry.filename.trim()}</span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            color: 'var(--text-secondary)',
            padding: '2px 8px',
            fontSize: 11,
          }}
        >
          Close
        </button>
      </div>

      {/* Tab bar */}
      {tabs.length > 1 && (
        <div style={{
          display: 'flex',
          gap: 0,
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
        }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? 'var(--bg-primary)' : 'transparent',
                color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                borderRadius: 0,
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                padding: '5px 14px',
                fontSize: 11,
                fontWeight: activeTab === tab ? 600 : 400,
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}

      {/* TS2068 mode toggle — shown when listing tab is active */}
      {activeTab === 'listing' && hasListing && (
        <div style={{
          display: 'flex',
          gap: 4,
          padding: '4px 12px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>Tokens:</span>
          {(['auto', 'ts2068', 'spectrum'] as Ts2068Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setTs2068Mode(m)}
              style={{
                background: ts2068Mode === m ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: ts2068Mode === m ? '#fff' : 'var(--text-secondary)',
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 3,
              }}
            >
              {m === 'auto' ? 'Auto' : m === 'ts2068' ? 'TS2068' : 'Spectrum'}
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {loading && !hexData && !listing && !arrayData && activeTab !== 'screen' && (
          <div style={{ padding: 12, color: 'var(--text-muted)' }}>Loading...</div>
        )}

        {activeTab === 'hex' && hexData && <HexView data={hexData} />}
        {activeTab === 'listing' && listing && <BasicListing listing={listing} />}
        {activeTab === 'screen' && (
          <ScreenViewer entry={entry} diskPath={diskPath} />
        )}
        {activeTab === 'array' && arrayData && <ArrayViewer data={arrayData} />}
      </div>
      </div>
    </div>
  );
}
