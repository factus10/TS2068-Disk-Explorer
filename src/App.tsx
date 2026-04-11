import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, DiskImage, FileEntry, ExtractionResult, TapPackage, ManualPackage, EditState } from './api';
import { Toolbar } from './components/Toolbar';
import { DiskInfo } from './components/DiskInfo';
import { FileTable, FileTableHandle } from './components/FileTable';
import { FileDetails } from './components/FileDetails';
import { DropZone } from './components/DropZone';
import { StatusBar } from './components/StatusBar';
import { ContentViewer } from './components/ContentViewer';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  );

  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileTableRef = useRef<FileTableHandle>(null);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

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
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }, []);

  const handleDrop = useCallback(async (filePath: string) => {
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
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }, []);

  const handleSelect = useCallback((index: number, multi: boolean) => {
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
    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Extracting...');
    const results: ExtractionResult[] = [];

    for (const idx of selectedIndices) {
      try {
        const result = await api.extractFile(disk.path, idx, destDir, editState[idx]);
        if (result) results.push(result);
      } catch {
        // continue
      }
    }

    setExtracting(false);
    setStatus(`Extracted ${results.length} file(s)`);
  }, [disk, selectedIndices]);

  const handleExtractPackage = useCallback(async () => {
    if (!disk || selectedIndices.size === 0) return;

    const pkg = packages.find((p) => selectedIndices.has(p.loader.index));
    if (!pkg) return;

    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Extracting package...');
    try {
      const depIndices = pkg.dependencies.map((d) => d.index);
      const result = await api.extractPackage(disk.path, pkg.loader.index, depIndices, destDir, editState);
      setStatus(result ? `Extracted package: ${result.filename.trim()}` : 'Package extraction failed');
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setExtracting(false);
  }, [disk, selectedIndices, packages]);

  const handleExtractAll = useCallback(async () => {
    if (!disk) return;
    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Extracting all files...');
    try {
      const results = await api.extractAll(disk.path, destDir, editState);
      setStatus(`Extracted ${results.length} file(s)`);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setExtracting(false);
  }, [disk]);

  // Listen for menu File > Open
  useEffect(() => {
    if (!api) return;
    const unsub = api.onMenuOpenFile(handleOpen);
    return unsub;
  }, [handleOpen]);

  // Listen for menu Recent Files
  useEffect(() => {
    if (!api) return;
    const unsub = api.onMenuOpenRecent((_event: any, filePath: string) => {
      handleDrop(filePath);
    });
    return unsub;
  }, [handleDrop]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Toolbar
        ref={searchInputRef}
        onOpen={handleOpen}
        onExtractSelected={handleExtractSelected}
        onExtractAll={handleExtractAll}
        onExtractPackage={handleExtractPackage}
        hasSelection={selectedIndices.size > 0}
        hasPackageSelected={selectedPackage !== null}
        hasDisk={disk !== null}
        extracting={extracting}
        autoPackagesEnabled={autoPackagesEnabled}
        onToggleAutoPackages={() => setAutoPackagesEnabled((v) => !v)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        theme={theme}
        onToggleTheme={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {disk && <DiskInfo header={disk.header} path={disk.path} />}

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
            onClose={() => setViewerEntry(null)}
            fileEdits={editState[viewerEntry.index]}
            onEditLine={(ln, text) => handleEditLine(viewerEntry.index, ln, text)}
            onRevertLine={(ln) => handleRevertLine(viewerEntry.index, ln)}
            onRevertAll={() => handleRevertAll(viewerEntry.index)}
          />
        )}
      </div>

      <StatusBar message={status} format={disk?.format} fileCount={disk?.catalog.length} />

      {disk && <DropZone onDrop={handleDrop} overlay />}
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
