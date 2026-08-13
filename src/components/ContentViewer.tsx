import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api, FileEntry, BasicListing as BasicListingData, ArrayData, Ts2068Mode, FileEdits, BasicVariable, XRefResult, DisasmSettings, isScreenEntry, isTextData, RemStyle } from '../api';
import { HexView } from './HexView';
import { BasicListing } from './BasicListing';
import { ScreenViewer } from './ScreenViewer';
import { ArrayViewer } from './ArrayViewer';
import { TextView } from './TextView';
import { VariableViewer } from './VariableViewer';
import { FontViewer, isFontData } from './FontViewer';
import { IconViewer, isIconData } from './IconViewer';
import { XRefViewer, XRefEntry } from './XRefViewer';
import { DisasmViewer } from './DisasmViewer';
import type { Disassembly } from './DisasmViewer';

/** ZX81 disks and tapes both list, disassemble and export as ZX81. */
const isZX81 = (format?: string) => format === 'zx81-aerco' || format === 'zx81-tzx';

const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 360;
const MAX_WIDTH = 900;

interface Props {
  entry: FileEntry;
  diskPath: string;
  diskFormat: string;
  onClose: () => void;
  fileEdits?: FileEdits;
  onEditLine?: (lineNumber: number, text: string) => void;
  onRevertLine?: (lineNumber: number) => void;
  onRevertAll?: () => void;
  screenEntries?: FileEntry[];
  /** Disassembly choices for this file, kept by App so extraction can use them. */
  disasmSettings?: DisasmSettings;
  onChangeDisasm: (settings: DisasmSettings) => void;
}

type ViewTab = 'listing' | 'variables' | 'xref' | 'disasm' | 'screen' | 'font' | 'icon' | 'array' | 'text' | 'hex';


function getStaticTabs(entry: FileEntry): ViewTab[] {
  const tabs: ViewTab[] = [];
  if (entry.type === 'basic') { tabs.push('listing'); tabs.push('variables'); tabs.push('xref'); }
  if (entry.type === 'state' || entry.isMemoryDump) { tabs.push('listing'); tabs.push('variables'); tabs.push('xref'); }
  if (isScreenEntry(entry)) tabs.push('screen');
  if (entry.type === 'num-array' || entry.type === 'str-array') tabs.push('array');
  return tabs;
}


function decodeText(data: number[]): string {
  let text = '';
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === 0x0d) text += '\n';
    else if (b === 0x0a) continue; // skip LF after CR
    else if (b >= 0x20 && b <= 0x7e) text += String.fromCharCode(b);
    else if (b === 0x09) text += '\t';
    else text += '\u00B7'; // middle dot for non-printable
  }
  return text;
}

const FONT_SIZE_BYTES = 768;

const TAB_LABELS: Record<ViewTab, string> = {
  listing: 'Listing',
  variables: 'Variables',
  xref: 'XRef',
  disasm: 'Disasm',
  screen: 'Screen',
  font: 'Font',
  icon: 'Icon',
  array: 'Array',
  text: 'Text',
  hex: 'Hex',
};

export function ContentViewer({ entry, diskPath, diskFormat, onClose, fileEdits, onEditLine, onRevertLine, onRevertAll, screenEntries, disasmSettings, onChangeDisasm }: Props) {
  // Raw file data — loaded eagerly for text detection
  const [hexData, setHexData] = useState<number[] | null>(null);
  const [listing, setListing] = useState<BasicListingData | null>(null);
  const [arrayData, setArrayData] = useState<ArrayData | null>(null);
  const [variables, setVariables] = useState<BasicVariable[] | null>(null);
  const [xrefData, setXrefData] = useState<XRefEntry[] | null>(null);
  const [disasm, setDisasm] = useState<Disassembly | null>(null);
  // undefined means "use whatever the planner infers".
  // Held by App, not here: an extraction has to be able to reproduce what the
  // reader was looking at, and this component unmounts when the file is closed.
  const originOverride = disasmSettings?.origin;
  const exrom = disasmSettings?.exrom ?? false;
  const setOriginOverride = (origin: number | undefined) =>
    onChangeDisasm({ ...disasmSettings, origin });
  const setExrom = (on: boolean) => onChangeDisasm({ ...disasmSettings, exrom: on });
  const [loading, setLoading] = useState(false);
  const [ts2068Mode, setTs2068Mode] = useState<Ts2068Mode>('auto');
  // ZX81 only, and the mirror image of the Tokens toggle: there the question
  // is which machine's tokens to read the bytes as, here it is whether the
  // bytes in a REM are text at all.
  const [remStyle, setRemStyle] = useState<RemStyle>('characters');
  const [activeTab, setActiveTab] = useState<ViewTab>('hex');

  // The Tokens toggle chooses how to read the bytes the Spectrum and the
  // TS2068 disagree about. ZX81 BASIC is a separate dialect with its own token
  // table and ignores the setting, so the choice is meaningless there.
  const hasTokenDialects = !isZX81(diskFormat);
  // A ZX81 REM is where machine code lives on these disks, and rendering code
  // bytes through the character set produces keyword soup. Offer the bytes.
  const hasRemStyles = isZX81(diskFormat);

  // Compute available tabs (text/font/icon tabs depend on data)
  const hasText = hexData ? isTextData(hexData) : false;
  const hasFont = hexData ? isFontData(hexData) : false;
  const hasIcon = hexData ? isIconData(hexData) : false;
  // A SCREEN$ is stored as CODE and would otherwise be offered a Disasm tab,
  // where tracing its pixels yields a confident listing of instructions that
  // never ran. Kept in step with canDisassemble in the main process.
  // A SCREEN$ and a text document are both stored as CODE and would otherwise
  // be offered a Disasm tab, where tracing them yields a confident listing of
  // instructions that never ran. Kept in step with canDisassemble in the main
  // process, which applies the same two tests once it has the bytes.
  const canDisasm = isZX81(diskFormat)
    ? entry.size > 0
    : (entry.type === 'code' || entry.type === 'module')
      && !isScreenEntry(entry) && !hasText;
  const tabs = useMemo(() => {
    const t = getStaticTabs(entry);
    if (canDisasm) t.push('disasm');
    if (hasFont && entry.type === 'code') t.push('font');
    if (hasIcon && entry.type === 'code') t.push('icon');
    if (hasText) t.push('text');
    t.push('hex');
    return t;
  }, [entry.index, entry.type, entry.size, entry.isMemoryDump, hasText, hasFont, hasIcon, canDisasm]);

  // Decoded text content (memoized)
  const textContent = useMemo(() => {
    if (!hasText || !hexData) return '';
    return decodeText(hexData);
  }, [hasText, hexData]);

  // Load hex data eagerly on entry change, then set default tab
  useEffect(() => {
    let cancelled = false;
    setHexData(null);
    setListing(null);
    setArrayData(null);
    setVariables(null);
    setXrefData(null);
    setDisasm(null);
    setOriginOverride(undefined);
    setLoading(true);

    api.getFileData(diskPath, entry.index).then((data) => {
      if (cancelled) return;
      setHexData(data);
      // Pick default tab after we know content type
      const staticTabs = getStaticTabs(entry);
      if (staticTabs.length > 0) {
        setActiveTab(staticTabs[0]);
      } else if (data && isFontData(data) && entry.type === 'code') {
        setActiveTab('font');
      } else if (data && isIconData(data) && entry.type === 'code') {
        setActiveTab('icon');
      } else if (data && isTextData(data)) {
        setActiveTab('text');
      } else {
        setActiveTab('hex');
      }
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [diskPath, entry.index]);

  // Load listing when listing tab activates or mode changes
  useEffect(() => {
    if (activeTab !== 'listing') return;
    let cancelled = false;
    setListing(null);
    setLoading(true);
    api.getBasicListing(diskPath, entry.index, ts2068Mode, remStyle).then((data) => {
      if (!cancelled) { setListing(data); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ts2068Mode, remStyle, diskPath, entry.index, activeTab]);

  // Load array data when array tab activates
  useEffect(() => {
    if (activeTab !== 'array' || arrayData) return;
    let cancelled = false;
    setLoading(true);
    api.getArrayData(diskPath, entry.index).then((data) => {
      if (!cancelled) { setArrayData(data); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, diskPath, entry.index, arrayData]);

  // Load variables when variables tab activates
  useEffect(() => {
    if (activeTab !== 'variables' || variables) return;
    let cancelled = false;
    setLoading(true);
    api.getBasicVariables(diskPath, entry.index).then((data) => {
      if (!cancelled) { setVariables(data); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, diskPath, entry.index, variables]);

  // Load xref when xref tab activates
  useEffect(() => {
    if (activeTab !== 'xref' || xrefData) return;
    let cancelled = false;
    setLoading(true);
    api.getBasicXref(diskPath, entry.index, ts2068Mode).then((data) => {
      if (!cancelled) { setXrefData(data?.entries ?? null); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, diskPath, entry.index, xrefData, ts2068Mode]);

  // Disassemble when the tab activates, and again whenever the origin changes.
  useEffect(() => {
    if (activeTab !== 'disasm') return;
    let cancelled = false;
    setDisasm(null);
    setLoading(true);
    api.getDisassembly(diskPath, entry.index, originOverride, exrom).then((d) => {
      if (!cancelled) { setDisasm(d); setLoading(false); }
    }).catch(() => { if (!cancelled) { setDisasm(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [activeTab, diskPath, entry.index, originOverride, exrom]);

  // Extract BASIC from state capture
  const isStateCapture = entry.type === 'state' || entry.isMemoryDump;
  const handleExtractBasic = useCallback(async () => {
    const destDir = await api.selectDirectory();
    if (!destDir) return;
    const result = await api.extractBasicFromState(diskPath, entry.index, destDir);
    if (result) {
      // Could show status but we don't have direct access — the filename is enough feedback
    }
  }, [diskPath, entry.index]);

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
        <div style={{ display: 'flex', gap: 6 }}>
          {isStateCapture && (
            <button
              onClick={handleExtractBasic}
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--badge-basic)',
                padding: '2px 10px',
                fontSize: 11,
              }}
            >
              Extract BASIC
            </button>
          )}
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
          {hasRemStyles && (
            <>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>REM:</span>
              {(['characters', 'hex'] as RemStyle[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setRemStyle(m)}
                  title={m === 'characters'
                    ? 'Render the REM through the ZX81 character set and token table'
                    : 'Show the bytes. A REM holding machine code has no reading as text.'}
                  style={{
                    background: remStyle === m ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: remStyle === m ? '#fff' : 'var(--text-secondary)',
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 3,
                  }}
                >
                  {m === 'characters' ? 'Characters' : 'Hex'}
                </button>
              ))}
            </>
          )}
          {hasTokenDialects && (
            <>
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
            </>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => api.printListingPdf(diskPath, entry.index, ts2068Mode, remStyle)}
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 3,
            }}
          >
            Save PDF
          </button>
        </div>
      )}

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {loading && !hexData && (
          <div style={{ padding: 12, color: 'var(--text-muted)' }}>Loading...</div>
        )}

        {activeTab === 'disasm' && (
          <DisasmViewer
            result={disasm}
            loading={loading}
            overridden={originOverride !== undefined}
            onSetOrigin={setOriginOverride}
            exrom={exrom}
            onSetExrom={setExrom}
            showExrom={!isZX81(diskFormat)}
          />
        )}
        {activeTab === 'hex' && hexData && <HexView data={hexData} />}
        {activeTab === 'text' && textContent && <TextView text={textContent} />}
        {activeTab === 'listing' && listing && (
          <BasicListing
            listing={listing}
            fileEdits={fileEdits}
            onEditLine={onEditLine}
            onRevertLine={onRevertLine}
            onRevertAll={onRevertAll}
          />
        )}
        {activeTab === 'screen' && (
          <ScreenViewer entry={entry} diskPath={diskPath} screenEntries={screenEntries} />
        )}
        {activeTab === 'variables' && variables && <VariableViewer variables={variables} />}
        {activeTab === 'xref' && xrefData && <XRefViewer entries={xrefData} />}
        {activeTab === 'font' && hexData && <FontViewer data={hexData} filename={entry.filename.trim()} />}
        {activeTab === 'icon' && hexData && <IconViewer data={hexData} filename={entry.filename.trim()} />}
        {activeTab === 'array' && arrayData && <ArrayViewer data={arrayData} />}
      </div>
      </div>
    </div>
  );
}
