import React, { useState, useEffect, useCallback } from 'react';
import { api, DiskImage, FileEntry, ExtractionResult, TapPackage } from './api';
import { Toolbar } from './components/Toolbar';
import { DiskInfo } from './components/DiskInfo';
import { FileTable } from './components/FileTable';
import { FileDetails } from './components/FileDetails';
import { DropZone } from './components/DropZone';
import { StatusBar } from './components/StatusBar';
import { HexView } from './components/HexView';

function App() {
  const [disk, setDisk] = useState<DiskImage | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [hexData, setHexData] = useState<number[] | null>(null);
  const [hexFilename, setHexFilename] = useState('');
  const [status, setStatus] = useState('Drop a disk image or click Open');
  const [extracting, setExtracting] = useState(false);
  const [packages, setPackages] = useState<TapPackage[]>([]);

  const handleOpen = useCallback(async () => {
    try {
      const result = await api.openFileDialog();
      if (result) {
        setDisk(result);
        setSelectedIndices(new Set());
        setHexData(null);
        setStatus(`Loaded ${result.catalog.length} files`);
        const pkgs = await api.analyzePackages(result.path);
        setPackages(pkgs);
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
      setHexData(null);
      setStatus(`Loaded ${result.catalog.length} files`);
      const pkgs = await api.analyzePackages(result.path);
      setPackages(pkgs);
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

  const handleViewHex = useCallback(async (entry: FileEntry) => {
    if (!disk) return;
    try {
      const data = await api.getFileData(disk.path, entry.index);
      setHexData(data);
      setHexFilename(entry.filename);
    } catch {
      setStatus('Failed to load file data');
    }
  }, [disk]);

  const handleExtractSelected = useCallback(async () => {
    if (!disk || selectedIndices.size === 0) return;
    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Extracting...');
    const results: ExtractionResult[] = [];

    for (const idx of selectedIndices) {
      try {
        const result = await api.extractFile(disk.path, idx, destDir);
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

    // Find a package whose loader is selected
    const pkg = packages.find((p) => selectedIndices.has(p.loader.index));
    if (!pkg) return;

    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Extracting package...');
    try {
      const depIndices = pkg.dependencies.map((d) => d.index);
      const result = await api.extractPackage(disk.path, pkg.loader.index, depIndices, destDir);
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
      const results = await api.extractAll(disk.path, destDir);
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

  const selectedEntry = disk && selectedIndices.size === 1
    ? flattenEntries(disk.catalog).find((e) => selectedIndices.has(e.index)) ?? null
    : null;

  const selectedPackage = selectedEntry
    ? packages.find((p) => p.loader.index === selectedEntry.index) ?? null
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Toolbar
        onOpen={handleOpen}
        onExtractSelected={handleExtractSelected}
        onExtractAll={handleExtractAll}
        onExtractPackage={handleExtractPackage}
        hasSelection={selectedIndices.size > 0}
        hasPackageSelected={selectedPackage !== null}
        hasDisk={disk !== null}
        extracting={extracting}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {disk && <DiskInfo header={disk.header} path={disk.path} />}

          <div style={{ flex: 1, overflow: 'auto' }}>
            {disk ? (
              <FileTable
                entries={disk.catalog}
                selectedIndices={selectedIndices}
                onSelect={handleSelect}
                onViewHex={handleViewHex}
                packages={packages}
              />
            ) : (
              <DropZone onDrop={handleDrop} />
            )}
          </div>

          {selectedEntry && (
            <FileDetails
              entry={selectedEntry}
              onViewHex={() => handleViewHex(selectedEntry)}
              tapPackage={selectedPackage}
            />
          )}
        </div>

        {hexData && (
          <div style={{
            width: 420,
            borderLeft: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              padding: '6px 12px',
              background: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600, fontSize: 12 }}>Hex: {hexFilename}</span>
              <button
                onClick={() => setHexData(null)}
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
            <HexView data={hexData} />
          </div>
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
