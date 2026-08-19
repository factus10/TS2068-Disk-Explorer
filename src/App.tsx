import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, DiskImage, FileEntry, ExtractionResult, TapPackage, ManualPackage, EditState, DisasmSettingsMap } from './api';
import { Toolbar } from './components/Toolbar';
import { DiskInfo } from './components/DiskInfo';
import { FileTable, FileTableHandle } from './components/FileTable';
import { FileDetails } from './components/FileDetails';
import { DropZone } from './components/DropZone';
import { StatusBar } from './components/StatusBar';
import { DiskMap } from './components/DiskMap';
import { ContentViewer } from './components/ContentViewer';
import { TapCreator } from './components/TapCreator';
import { Preferences } from './components/Preferences';
import { FileBrowser } from './components/FileBrowser';
import { ArchiveExportDialog, ArchiveMetadata, ArchiveFormat } from './components/ArchiveExportDialog';
import { RenamePrompt } from './components/RenamePrompt';

function buildArchiveZipName(diskBase: string, meta: ArchiveMetadata): string {
  const clean = diskBase.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim() || 'archive';
  return `${clean} (${meta.year})(${meta.publisher})(${meta.system})(${meta.country})`;
}

/** Formats whose files are exported as ZX Spectrum tape blocks. */
const TAP_FORMATS = ['larken', 'oliger-v1', 'oliger-v2', 'aerco-dos64', 'tap'];

function App() {
  const [disk, setDisk] = useState<DiskImage | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [viewerEntry, setViewerEntry] = useState<FileEntry | null>(null);
  const [status, setStatus] = useState('Drop a disk image or click Open');
  const [extracting, setExtracting] = useState(false);
  const [autoPackages, setAutoPackages] = useState<TapPackage[]>([]);
  const [autoPackagesEnabled, setAutoPackagesEnabled] = useState(true);
  const [manualPackages, setManualPackages] = useState<ManualPackage[]>([]);
  const [nextManualId, setNextManualId] = useState(1);
  const [editState, setEditState] = useState<EditState>({});
  // Disassembly choices per file, so an extraction writes the .dis the reader
  // was actually looking at rather than one built from the detected origin.
  const [disasmState, setDisasmState] = useState<DisasmSettingsMap>({});
  const [showPreferences, setShowPreferences] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  );

  // Bumped when something outside the browser changes a folder's state, so it
  // re-lists rather than showing a mark that is one export out of date.
  const [browserRefresh, setBrowserRefresh] = useState(0);
  // Per-entry archive status for the open disk, from the configured catalogue.
  const [archiveStatus, setArchiveStatus] = useState<Record<number, 'marked' | 'matched'> | null>(null);

  /** Ask the catalogue how the open disk stands. Silent when none is set. */
  const refreshArchiveStatus = useCallback(async (imagePath?: string) => {
    if (!imagePath) { setArchiveStatus(null); return; }
    try { setArchiveStatus(await api.getDiskArchiveStatus(imagePath)); }
    catch { setArchiveStatus(null); }
  }, []);
  const [showTapCreator, setShowTapCreator] = useState(false);
  const [showArchiveExport, setShowArchiveExport] = useState(false);
  const [renamePrompt, setRenamePrompt] = useState<{
    title: string;
    defaultValue: string;
    resolve: (value: string | null) => void;
  } | null>(null);

  const askForRename = useCallback((title: string, defaultValue: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setRenamePrompt({ title, defaultValue, resolve });
    });
  }, []);
  const [showBrowser, setShowBrowser] = useState(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('showBrowser') !== 'false' : true,
  );

  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileTableRef = useRef<FileTableHandle>(null);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Persist browser panel visibility
  useEffect(() => {
    localStorage.setItem('showBrowser', String(showBrowser));
  }, [showBrowser]);

  // Merge auto and manual packages into a unified TapPackage[] for display
  const packages = useMemo(() => {
    const manualIndices = new Set<number>();
    for (const mp of manualPackages) {
      for (const e of mp.entries) manualIndices.add(e.index);
    }

    const manualAsTap: TapPackage[] = manualPackages.map((mp) => ({
      loader: mp.entries[0],
      dependencies: mp.entries.slice(1),
      unresolved: [],
    }));

    if (!autoPackagesEnabled) return manualAsTap;

    const filteredAuto = autoPackages.filter((ap) => {
      if (manualIndices.has(ap.loader.index)) return false;
      return !ap.dependencies.some((d) => manualIndices.has(d.index));
    });

    return [...filteredAuto, ...manualAsTap];
  }, [autoPackages, autoPackagesEnabled, manualPackages]);

  const manualLoaderIndices = useMemo(
    () => new Set(manualPackages.map((mp) => mp.entries[0]?.index)),
    [manualPackages],
  );

  const handleOpen = useCallback(async () => {
    try {
      const result = await api.openFileDialog();
      if (result) {
        setDisk(result);
        setSelectedIndices(new Set());
        setViewerEntry(null);
        setManualPackages([]);
        setAutoPackagesEnabled(true);
        setEditState({});
        setSearchQuery('');
        setStatus(`Loaded ${result.catalog.length} files`);
        const pkgs = await api.analyzePackages(result.path);
        setAutoPackages(pkgs);
        refreshArchiveStatus(result.path);
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }, []);

  const handleDrop = useCallback(async (filePath: string) => {
    if (!filePath) return;
    try {
      setStatus('Loading...');
      const result = await api.openPath(filePath);
      setDisk(result);
      setSelectedIndices(new Set());
      setViewerEntry(null);
      setManualPackages([]);
      setAutoPackagesEnabled(true);
      setEditState({});
      setSearchQuery('');
      setStatus(`Loaded ${result.catalog.length} files`);
      const pkgs = await api.analyzePackages(result.path);
      setAutoPackages(pkgs);
      refreshArchiveStatus(result.path);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }, []);

  const lastClickedRef = useRef<number>(-1);

  const handleSelect = useCallback((index: number, multi: boolean, shift?: boolean) => {
    if (shift && lastClickedRef.current >= 0) {
      // Shift-click: select range between last clicked and current
      const rows = fileTableRef.current?.visibleRowIndices ?? [];
      const from = rows.indexOf(lastClickedRef.current);
      const to = rows.indexOf(index);
      if (from >= 0 && to >= 0) {
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        setSelectedIndices((prev) => {
          const next = new Set(multi ? prev : []);
          for (let i = lo; i <= hi; i++) next.add(rows[i]);
          return next;
        });
        return;
      }
    }
    lastClickedRef.current = index;
    setSelectedIndices((prev) => {
      const next = new Set(multi ? prev : []);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleViewContent = useCallback((entry: FileEntry) => {
    setViewerEntry(entry);
  }, []);

  const handleEditLine = useCallback((entryIndex: number, lineNumber: number, text: string) => {
    setEditState((prev) => ({
      ...prev,
      [entryIndex]: { ...prev[entryIndex], [lineNumber]: text },
    }));
  }, []);

  const handleRevertLine = useCallback((entryIndex: number, lineNumber: number) => {
    setEditState((prev) => {
      const fileEdits = { ...prev[entryIndex] };
      delete fileEdits[lineNumber];
      if (Object.keys(fileEdits).length === 0) {
        const next = { ...prev };
        delete next[entryIndex];
        return next;
      }
      return { ...prev, [entryIndex]: fileEdits };
    });
  }, []);

  const handleRevertAll = useCallback((entryIndex: number) => {
    setEditState((prev) => {
      const next = { ...prev };
      delete next[entryIndex];
      return next;
    });
  }, []);

  // Manual package handlers
  const handleCreatePackage = useCallback((targetIndex: number, draggedIndex: number) => {
    if (!disk) return;
    const all = flattenEntries(disk.catalog);
    const target = all.find((e) => e.index === targetIndex);
    const dragged = all.find((e) => e.index === draggedIndex);
    if (!target || !dragged || target.index === dragged.index) return;

    setManualPackages((prev) => {
      let updated = prev.map((mp) => ({
        ...mp,
        entries: mp.entries.filter((e) => e.index !== targetIndex && e.index !== draggedIndex),
      })).filter((mp) => mp.entries.length >= 1);

      updated = [...updated, { id: nextManualId, entries: [target, dragged] }];
      return updated;
    });
    setNextManualId((n) => n + 1);
    setStatus(`Created package: ${target.filename.trim()}`);
  }, [disk, nextManualId]);

  const handleAddToPackage = useCallback((loaderIndex: number, draggedIndex: number, insertBeforeIndex?: number) => {
    if (!disk) return;
    const all = flattenEntries(disk.catalog);
    const dragged = all.find((e) => e.index === draggedIndex);
    if (!dragged) return;

    setManualPackages((prev) => {
      let updated = prev.map((mp) => ({
        ...mp,
        entries: mp.entries.filter((e) => e.index !== draggedIndex),
      })).filter((mp) => mp.entries.length >= 1);

      return updated.map((mp) => {
        if (mp.entries[0]?.index !== loaderIndex) return mp;
        const newEntries = [...mp.entries];
        if (insertBeforeIndex !== undefined) {
          const pos = newEntries.findIndex((e) => e.index === insertBeforeIndex);
          if (pos >= 1) {
            newEntries.splice(pos, 0, dragged);
            return { ...mp, entries: newEntries };
          }
        }
        newEntries.push(dragged);
        return { ...mp, entries: newEntries };
      });
    });
  }, [disk]);

  const handleReorderInPackage = useCallback((loaderIndex: number, draggedIndex: number, insertBeforeIndex?: number) => {
    setManualPackages((prev) =>
      prev.map((mp) => {
        if (mp.entries[0]?.index !== loaderIndex) return mp;
        const entries = mp.entries.filter((e) => e.index !== draggedIndex);
        const dragged = mp.entries.find((e) => e.index === draggedIndex);
        if (!dragged) return mp;

        if (insertBeforeIndex !== undefined) {
          const pos = entries.findIndex((e) => e.index === insertBeforeIndex);
          if (pos >= 1) {
            entries.splice(pos, 0, dragged);
            return { ...mp, entries };
          }
        }
        entries.push(dragged);
        return { ...mp, entries };
      }),
    );
  }, []);

  const handleRemoveFromPackage = useCallback((loaderIndex: number, entryIndex: number) => {
    setManualPackages((prev) => {
      const updated = prev.map((mp) => {
        if (mp.entries[0]?.index !== loaderIndex) return mp;
        if (entryIndex === loaderIndex) return { ...mp, entries: [] };
        return { ...mp, entries: mp.entries.filter((e) => e.index !== entryIndex) };
      }).filter((mp) => mp.entries.length >= 2);
      return updated;
    });
  }, []);

  const handleExtractSelected = useCallback(async () => {
    if (!disk || selectedIndices.size === 0) return;

    // Single-file extracts: prompt for a custom filename so users can fix
    // mismatched directory/block names or disambiguate same-named programs.
    const all = flattenEntries(disk.catalog);
    const isSingle = selectedIndices.size === 1;
    let customNames: Map<number, string> | null = null;

    if (isSingle) {
      const idx = [...selectedIndices][0];
      const entry = all.find((e) => e.index === idx);
      if (entry) {
        const suggested = entry.filename.trim();
        const newName = await askForRename('Save file as', suggested);
        if (newName === null) return; // cancelled
        const trimmed = newName.trim();
        if (trimmed && trimmed !== suggested) {
          customNames = new Map([[idx, trimmed]]);
        }
      }
    }

    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Extracting...');
    const results: ExtractionResult[] = [];

    for (const idx of selectedIndices) {
      try {
        const customName = customNames?.get(idx);
        const result = await api.extractFile(disk.path, idx, destDir, editState[idx], customName);
        if (result) results.push(result);
      } catch {
        // continue
      }
    }

    setExtracting(false);
    setStatus(`Extracted ${results.length} file(s)`);
  }, [disk, selectedIndices, editState, askForRename, refreshArchiveStatus]);

  /**
   * Bundle the selected entries into one multi-file TAP — the loader is the
   * first of them in catalog order, the rest follow as its blocks, exactly as
   * a detected package would be written.
   */
  const handleExtractSelectedAsTap = useCallback(async () => {
    if (!disk || selectedIndices.size < 2) return;

    const chosen = flattenEntries(disk.catalog)
      .filter((e) => !e.isDirectory && selectedIndices.has(e.index));
    if (chosen.length < 2) return;

    const suggested = chosen[0].filename.trim();
    const newName = await askForRename('Save combined TAP as', suggested);
    if (newName === null) return;
    const customName = newName.trim() && newName.trim() !== suggested ? newName.trim() : undefined;

    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Building TAP...');
    try {
      const result = await api.extractPackage(
        disk.path, chosen[0].index, chosen.slice(1).map((e) => e.index),
        destDir, editState, customName,
      );
      const written = result?.outputPaths[0]?.split(/[/\\]/).pop();
      setStatus(result
        ? `Wrote ${chosen.length} file(s) to ${written}`
          + (result.marked ? ` — ${result.marked} marked archived` : '')
        : 'TAP build failed');
      if (result?.marked) { refreshArchiveStatus(disk.path); setBrowserRefresh((n) => n + 1); }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setExtracting(false);
  }, [disk, selectedIndices, editState, askForRename, refreshArchiveStatus]);

  const handleExtractPackage = useCallback(async () => {
    if (!disk || selectedIndices.size === 0) return;

    const pkg = packages.find((p) => selectedIndices.has(p.loader.index));
    if (!pkg) return;

    // Prompt for a custom filename for the .tap package
    const suggested = pkg.loader.filename.trim();
    const newName = await askForRename('Save package as', suggested);
    if (newName === null) return; // cancelled
    const customName = newName.trim() && newName.trim() !== suggested ? newName.trim() : undefined;

    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Extracting package...');
    try {
      const depIndices = pkg.dependencies.map((d) => d.index);
      const result = await api.extractPackage(disk.path, pkg.loader.index, depIndices, destDir, editState, customName);
      setStatus(result
        ? `Extracted package: ${result.filename.trim()}`
          + (result.marked ? ` — ${result.marked} marked archived` : '')
        : 'Package extraction failed');
      if (result?.marked) { refreshArchiveStatus(disk.path); setBrowserRefresh((n) => n + 1); }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setExtracting(false);
  }, [disk, selectedIndices, packages, editState, askForRename, refreshArchiveStatus]);

  /**
   * After a whole-disk export, let the main process record it and offer to
   * mark the folder if that was the last image in it. Bookkeeping must never
   * fail an export that already succeeded, so this swallows its errors.
   */
  const offerFolderMark = useCallback(async (imagePath: string) => {
    try {
      const result = await api.offerFolderArchive(imagePath);
      if (!result.marked) return;
      setStatus((prev) => `${prev} — folder marked as archived`);
      setBrowserRefresh((n) => n + 1);
    } catch { /* the export stands regardless */ }
  }, []);

  const handleExtractAll = useCallback(async () => {
    if (!disk) return;
    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Extracting all files...');
    try {
      const results = await api.extractAll(disk.path, destDir, editState, disasmState);
      setStatus(`Extracted ${results.length} file(s)`);
      // Ask now rather than at launch: there is a folder to point at and a
      // reason to care about it. Declining is remembered by not asking again
      // until they set one deliberately in Preferences.
      await api.offerDefaultExtractionDir(destDir);
      await offerFolderMark(disk.path);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setExtracting(false);
  }, [disk, editState, disasmState, offerFolderMark]);

  const handleExportArchive = useCallback(async (metadata: ArchiveMetadata) => {
    if (!disk) return;
    setShowArchiveExport(false);

    const chosen = metadata.scope === 'selected'
      ? flattenEntries(disk.catalog).filter((e) => !e.isDirectory && selectedIndices.has(e.index))
      : [];
    const entryIndices = metadata.scope === 'selected' ? chosen.map((e) => e.index) : undefined;
    if (metadata.scope === 'selected' && chosen.length === 0) {
      setStatus('Nothing selected to export');
      return;
    }

    if (metadata.format === 'image-zip' || metadata.format === 'zip') {
      // For ZIP, use save dialog to pick the .zip file path. A single selected
      // file names its own ZIP; anything wider is named for the disk.
      const diskBase = disk.path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'archive';
      const base = chosen.length === 1 ? chosen[0].filename.trim() : diskBase;
      const zipName = buildArchiveZipName(base, metadata);
      const zipPath = await api.saveZipDialog(zipName + '.zip');
      if (!zipPath) return;
      setExtracting(true);
      setStatus('Exporting archive ZIP...');
      try {
        const results = await api.exportArchive(disk.path, zipPath, metadata, editState, disasmState, entryIndices);
        const marked = results[0]?.marked ?? 0;
        setStatus((metadata.format === 'image-zip'
          ? 'Exported disk image to ZIP'
          : `Exported ${results.length} file(s) to ZIP`)
          + (marked ? ` — ${marked} marked archived` : ''));
        if (marked) { refreshArchiveStatus(disk.path); setBrowserRefresh((n) => n + 1); }
        // Only a whole-disk export means this image is done with.
        if (metadata.scope === 'disk') await offerFolderMark(disk.path);
      } catch (err: any) {
        setStatus(`Error: ${err.message}`);
      }
      setExtracting(false);
    } else {
      const destDir = await api.selectDirectory();
      if (!destDir) return;
      setExtracting(true);
      setStatus('Exporting for archive.org...');
      try {
        const results = await api.exportArchive(disk.path, destDir, metadata, editState, disasmState, entryIndices);
        const marked = results[0]?.marked ?? 0;
        setStatus(`Exported ${results.length} file(s) for archive.org`
          + (marked ? ` — ${marked} marked archived` : ''));
        if (marked) { refreshArchiveStatus(disk.path); setBrowserRefresh((n) => n + 1); }
        if (metadata.scope === 'disk') await offerFolderMark(disk.path);
      } catch (err: any) {
        setStatus(`Error: ${err.message}`);
      }
      setExtracting(false);
    }
  }, [disk, selectedIndices, editState, disasmState, offerFolderMark, refreshArchiveStatus]);

  const handleExportAllFonts = useCallback(async () => {
    if (!disk) return;
    const destDir = await api.selectDirectory();
    if (!destDir) return;
    setStatus('Exporting fonts...');
    const count = await api.exportAllFonts(disk.path, destDir);
    setStatus(`Exported ${count} font(s) as TTF`);
  }, [disk]);

  const handleExportAllScreens = useCallback(async () => {
    if (!disk) return;
    const destDir = await api.selectDirectory();
    if (!destDir) return;
    setStatus('Exporting screens...');
    const count = await api.exportAllScreens(disk.path, destDir);
    setStatus(`Exported ${count} screen(s) as PNG`);
  }, [disk]);

  // Compute whether disk has fonts/screens for conditional toolbar buttons
  const hasFonts = useMemo(() => {
    if (!disk) return false;
    return flattenEntries(disk.catalog).some((e) => e.type === 'code' && e.size === 768);
  }, [disk]);

  const hasScreens = useMemo(() => {
    if (!disk) return false;
    return flattenEntries(disk.catalog).some((e) => e.type === 'code' && e.size === 6912);
  }, [disk]);

  const screenEntries = useMemo(() => {
    if (!disk) return [];
    return flattenEntries(disk.catalog).filter((e) => e.type === 'code' && e.size === 6912);
  }, [disk]);

  const [showDiskMap, setShowDiskMap] = useState(true);
  const [diskMapBlocks, setDiskMapBlocks] = useState(0);

  // Load disk map data when disk opens
  useEffect(() => {
    if (!disk) { setDiskMapBlocks(0); return; }
    api.getDiskMap(disk.path).then((data) => {
      setDiskMapBlocks(data?.totalBlocks ?? 0);
    });
  }, [disk]);

  // Listen for menu File > Open
  useEffect(() => {
    if (!api) return;
    const unsub = api.onMenuOpenFile(handleOpen);
    return unsub;
  }, [handleOpen]);

  useEffect(() => {
    if (!api) return;
    return api.onMenuPreferences(() => setShowPreferences(true));
  }, []);

  // Listen for menu Recent Files
  useEffect(() => {
    if (!api) return;
    const unsub = api.onMenuOpenRecent((_event: any, filePath: string) => {
      handleDrop(filePath);
    });
    return unsub;
  }, [handleDrop]);

  // Listen for menu File > Create TAP
  useEffect(() => {
    if (!api) return;
    const unsub = api.onMenuCreateTap(() => setShowTapCreator(true));
    return unsub;
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl+B: toggle file browser
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setShowBrowser((v) => !v);
        return;
      }

      // Cmd/Ctrl+F: focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Don't handle keys when an input/textarea is focused
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        // Escape from search: return focus to file table
        if (e.key === 'Escape' && tag === 'INPUT') {
          (e.target as HTMLElement).blur();
          fileTableRef.current?.focus();
        }
        return;
      }

      // Escape: close viewer
      if (e.key === 'Escape') {
        if (viewerEntry) { setViewerEntry(null); return; }
      }

      if (!disk) return;
      const rows = fileTableRef.current?.visibleRowIndices ?? [];
      if (rows.length === 0) return;

      const all = flattenEntries(disk.catalog);
      const currentIdx = selectedIndices.size === 1 ? [...selectedIndices][0] : -1;
      const pos = rows.indexOf(currentIdx);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextPos = pos < rows.length - 1 ? pos + 1 : 0;
        handleSelect(rows[nextPos], false);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevPos = pos > 0 ? pos - 1 : rows.length - 1;
        handleSelect(rows[prevPos], false);
      } else if (e.key === 'Enter') {
        if (currentIdx >= 0) {
          const entry = all.find((e) => e.index === currentIdx);
          if (entry && !entry.isDirectory) handleViewContent(entry);
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        if (currentIdx >= 0) {
          fileTableRef.current?.toggleExpand(currentIdx);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [disk, selectedIndices, viewerEntry, handleSelect, handleViewContent]);

  const selectedEntry = disk && selectedIndices.size === 1
    ? flattenEntries(disk.catalog).find((e) => selectedIndices.has(e.index)) ?? null
    : null;

  // Auto-update viewer when selection changes and viewer is open
  useEffect(() => {
    if (viewerEntry && selectedEntry && selectedEntry.index !== viewerEntry.index && !selectedEntry.isDirectory) {
      setViewerEntry(selectedEntry);
    }
  }, [selectedEntry]);

  const selectedPackage = selectedEntry
    ? packages.find((p) => p.loader.index === selectedEntry.index) ?? null
    : null;

  // Bundling is only meaningful where the files are tape blocks to begin with.
  const canBundleTap = disk !== null
    && TAP_FORMATS.includes(disk.format)
    && flattenEntries(disk.catalog)
      .filter((e) => !e.isDirectory && selectedIndices.has(e.index)).length >= 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Toolbar
        ref={searchInputRef}
        onOpen={handleOpen}
        onExtractSelected={handleExtractSelected}
        onExtractSelectedAsTap={handleExtractSelectedAsTap}
        onExtractAll={handleExtractAll}
        onExtractPackage={handleExtractPackage}
        hasSelection={selectedIndices.size > 0}
        canBundleTap={canBundleTap}
        hasPackageSelected={selectedPackage !== null}
        hasDisk={disk !== null}
        extracting={extracting}
        autoPackagesEnabled={autoPackagesEnabled}
        onToggleAutoPackages={() => setAutoPackagesEnabled((v) => !v)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        theme={theme}
        onToggleTheme={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
        hasFonts={hasFonts}
        hasScreens={hasScreens}
        onExportAllFonts={handleExportAllFonts}
        onExportAllScreens={handleExportAllScreens}
        onCreateTap={() => setShowTapCreator(true)}
        onExportArchive={() => setShowArchiveExport(true)}
        showBrowser={showBrowser}
        onToggleBrowser={() => setShowBrowser((v) => !v)}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {showBrowser && (
          <FileBrowser
            onOpenFile={handleDrop}
            currentDiskPath={disk?.path ?? null}
            refreshToken={browserRefresh}
          />
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {disk && <DiskInfo header={disk.header} path={disk.path} />}
          {disk && showDiskMap && diskMapBlocks > 0 && (
            <DiskMap entries={disk.catalog} totalBlocks={diskMapBlocks} />
          )}

          <div style={{ flex: 1, overflow: 'auto' }}>
            {disk ? (
              <FileTable
                ref={fileTableRef}
                entries={disk.catalog}
                selectedIndices={selectedIndices}
                onSelect={handleSelect}
                onViewHex={handleViewContent}
                packages={packages}
                manualLoaderIndices={manualLoaderIndices}
                onCreatePackage={handleCreatePackage}
                onAddToPackage={handleAddToPackage}
                onReorderInPackage={handleReorderInPackage}
                onRemoveFromPackage={handleRemoveFromPackage}
                editedIndices={editState}
                searchQuery={searchQuery}
                archiveStatus={archiveStatus}
              />
            ) : (
              <DropZone onDrop={handleDrop} />
            )}
          </div>

          {selectedEntry && (
            <FileDetails
              entry={selectedEntry}
              onViewHex={() => handleViewContent(selectedEntry)}
              tapPackage={selectedPackage}
            />
          )}
        </div>

        {viewerEntry && disk && (
          <ContentViewer
            entry={viewerEntry}
            diskPath={disk.path}
            diskFormat={disk.format}
            onClose={() => setViewerEntry(null)}
            fileEdits={editState[viewerEntry.index]}
            onEditLine={(ln, text) => handleEditLine(viewerEntry.index, ln, text)}
            onRevertLine={(ln) => handleRevertLine(viewerEntry.index, ln)}
            onRevertAll={() => handleRevertAll(viewerEntry.index)}
            screenEntries={screenEntries}
            disasmSettings={disasmState[viewerEntry.index]}
            onChangeDisasm={(settings) =>
              setDisasmState((prev) => ({ ...prev, [viewerEntry.index]: settings }))}
          />
        )}
      </div>

      <StatusBar message={status} format={disk?.format} fileCount={disk?.catalog.length} />

      {disk && <DropZone onDrop={handleDrop} overlay />}

      {showPreferences && <Preferences onClose={() => setShowPreferences(false)} />}

      {showTapCreator && (
        <TapCreator
          onClose={() => setShowTapCreator(false)}
          onStatus={setStatus}
        />
      )}

      {showArchiveExport && (
        <ArchiveExportDialog
          diskName={disk?.header.diskName || disk?.path.split('/').pop() || ''}
          selectedCount={disk
            ? flattenEntries(disk.catalog).filter((e) => !e.isDirectory && selectedIndices.has(e.index)).length
            : 0}
          onExport={handleExportArchive}
          onCancel={() => setShowArchiveExport(false)}
        />
      )}

      {renamePrompt && (
        <RenamePrompt
          title={renamePrompt.title}
          message="Filename without extension. Tap will add .tap automatically."
          defaultValue={renamePrompt.defaultValue}
          onConfirm={(value) => {
            renamePrompt.resolve(value);
            setRenamePrompt(null);
          }}
          onCancel={() => {
            renamePrompt.resolve(null);
            setRenamePrompt(null);
          }}
        />
      )}
    </div>
  );
}

function flattenEntries(entries: FileEntry[]): FileEntry[] {
  const flat: FileEntry[] = [];
  for (const e of entries) {
    flat.push(e);
    if (e.children) flat.push(...e.children);
  }
  return flat;
}

export default App;
