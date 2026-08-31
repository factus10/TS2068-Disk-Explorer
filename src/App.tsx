import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  api, DiskImage, FileEntry, ExtractionResult, TapPackage, ManualPackage, EditState,
  DisasmSettingsMap, DiskArchiveStatus, ProgramTarget, archiveTypeSuffix,
} from './api';
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
import { ExportPrompt, ExportChoice, loadRemembered, previewArchiveName } from './components/ExportPrompt';
import { PublishDialog } from './components/PublishDialog';
import { CatalogIngest } from './components/CatalogIngest';
import { CatalogInsights } from './components/CatalogInsights';
import { ArchiveSearch } from './components/ArchiveSearch';

function buildArchiveZipName(diskBase: string, meta: ArchiveMetadata): string {
  const clean = diskBase.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim() || 'archive';
  return `${clean} (${meta.year})(${meta.publisher})(${meta.system})(${meta.country})`;
}

/** Formats whose files are exported as ZX Spectrum tape blocks. */
const TAP_FORMATS = ['larken', 'oliger-v1', 'oliger-v2', 'aerco-dos64', 'tap'];

/** ZX81 disks and tapes, whatever they arrived in. */
const ZX81_FORMATS = ['zx81-aerco', 'zx81-tzx'];

/**
 * Formats whose programs an emulator can be handed. Mirrors machineForFormat
 * in electron/emulator.ts, which makes the real decision — this one only
 * decides whether the Run button is worth offering.
 */
const RUNNABLE_FORMATS = [...TAP_FORMATS, 'tzx', ...ZX81_FORMATS];

/**
 * What a program's own file is called. Mirrors programPayload in main.ts;
 * used here only to keep the export dialog's preview honest.
 */
function payloadExtension(format: string, entry?: FileEntry): string {
  if (ZX81_FORMATS.includes(format)) return '.p';
  if (entry && TAP_FORMATS.includes(format) && entry.type !== 'module') return '.tap';
  return entry?.type === 'module' ? '.bin' : '';
}

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
  const [archiveStatus, setArchiveStatus] = useState<DiskArchiveStatus | null>(null);

  /** Ask the catalogue how the open disk stands. Silent when none is set. */
  const refreshArchiveStatus = useCallback(async (imagePath?: string) => {
    if (!imagePath) { setArchiveStatus(null); return; }
    try { setArchiveStatus(await api.getDiskArchiveStatus(imagePath)); }
    catch { setArchiveStatus(null); }
  }, []);
  const [showTapCreator, setShowTapCreator] = useState(false);
  const [showArchiveExport, setShowArchiveExport] = useState(false);
  const [showIngest, setShowIngest] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  // The archive search window, and the query it was opened on. Null means
  // closed; an empty string means opened with nothing asked yet.
  const [archiveSearch, setArchiveSearch] = useState<{ query: string; mode: 'source' | 'name' } | null>(null);
  // The program being turned into a published record; null when the dialog is
  // closed. Publishing is per-program, unlike the extract buttons.
  const [publishing, setPublishing] = useState<{
    entryIndex: number; title: string; sourceFilename: string;
    metadata: { year: string; publisher: string };
  } | null>(null);
  /** Offered after an archive bundle is written; declining it costs one click. */
  const [publishOffer, setPublishOffer] = useState<{
    entryIndex: number; title: string; sourceFilename: string;
    metadata: { year: string; publisher: string };
  } | null>(null);
  const [wordpressUrl, setWordpressUrl] = useState<string | null>(null);
  // Set when a finding should take the browser somewhere.
  const [browseTo, setBrowseTo] = useState<string | null>(null);
  const [exportPrompt, setExportPrompt] = useState<{
    title: string;
    defaultValue?: string;
    summary?: string;
    payloadExt?: string;
    typeSuffix?: string;
    resolve: (choice: ExportChoice | null) => void;
  } | null>(null);

  /**
   * Ask what shape an export should take, and under what name. Every extract
   * button comes through here, so a program can go out as a bare TAP or as an
   * archive-named ZIP without either being a separate command to remember.
   */
  const askForExport = useCallback((opts: {
    title: string; defaultValue?: string; summary?: string;
    payloadExt?: string; typeSuffix?: string;
  }): Promise<ExportChoice | null> => {
    return new Promise((resolve) => setExportPrompt({ ...opts, resolve }));
  }, []);
  const [showBrowser, setShowBrowser] = useState(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('showBrowser') !== 'false' : true,
  );

  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileTableRef = useRef<FileTableHandle>(null);
  /**
   * What Cmd+R should do right now. Held in a ref so the menu listener is
   * installed once, rather than being torn down and rebuilt on every change
   * of selection.
   */
  const runRef = useRef<() => void>(() => {});
  const refreshMatchesRef = useRef<() => void>(() => {});
  const publishRef = useRef<() => void>(() => {});

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

    // Single-file extracts are named by hand, so users can fix mismatched
    // directory/block names or disambiguate same-named programs. A batch has
    // no one name to give, and each file keeps its own.
    const all = flattenEntries(disk.catalog);
    const isSingle = selectedIndices.size === 1;
    const soleEntry = isSingle
      ? all.find((e) => e.index === [...selectedIndices][0])
      : undefined;
    const suggested = soleEntry?.filename.trim();

    const choice = await askForExport({
      title: isSingle ? 'Save file as' : `Save ${selectedIndices.size} files`,
      ...(suggested !== undefined ? { defaultValue: suggested } : {}),
      ...(isSingle ? {} : { summary: `${selectedIndices.size} selected files` }),
      payloadExt: payloadExtension(disk.format, soleEntry),
      typeSuffix: soleEntry ? archiveTypeSuffix(soleEntry) : 'Program',
    });
    if (!choice) return;

    const customName = suggested !== undefined && choice.name.trim() && choice.name.trim() !== suggested
      ? choice.name.trim()
      : undefined;

    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus(choice.shape === 'tosec-zip' ? 'Packing...' : 'Extracting...');
    const results: ExtractionResult[] = [];

    for (const idx of selectedIndices) {
      // Only the sole entry can wear a hand-given name; in a batch each file
      // is named for itself, or several would collide on one filename.
      const nameFor = isSingle ? customName : undefined;
      try {
        const result = choice.shape === 'tosec-zip' && choice.metadata
          ? await api.exportTosec(
              disk.path, { kind: 'file', entryIndex: idx }, destDir,
              choice.metadata, editState, nameFor,
            )
          : await api.extractFile(disk.path, idx, destDir, editState[idx], nameFor);
        if (result) results.push(result);
      } catch {
        // continue
      }
    }

    setExtracting(false);
    const marked = results.reduce((n, r) => n + (r.marked ?? 0), 0);
    setStatus(`${choice.shape === 'tosec-zip' ? 'Packed' : 'Extracted'} ${results.length} file(s)`
      + (marked ? ` — ${marked} marked archived` : ''));
    if (marked) { refreshArchiveStatus(disk.path); setBrowserRefresh((n) => n + 1); }

    // Publishing belongs here rather than in a menu of its own. A record is
    // made out of exactly what the archive bundle holds, so the moment the
    // bundle exists is the moment there is something to publish — and the
    // year, publisher and machine were just answered a dialog ago.
    if (isSingle && choice.shape === 'tosec-zip' && choice.metadata && results.length === 1) {
      const index = [...selectedIndices][0];
      const entry = all.find((e) => e.index === index);
      const base = customName ?? entry?.filename.trim() ?? '';
      setPublishOffer({
        entryIndex: index,
        title: base,
        sourceFilename: `${previewArchiveName(base, choice.metadata, soleEntry ? archiveTypeSuffix(soleEntry) : 'Program')}.zip`,
        metadata: { year: choice.metadata.year, publisher: choice.metadata.publisher },
      });
    }
  }, [disk, selectedIndices, editState, askForExport, refreshArchiveStatus]);

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
    const choice = await askForExport({
      title: 'Save combined TAP as',
      defaultValue: suggested,
      payloadExt: '.tap',
    });
    if (!choice) return;
    const customName = choice.name.trim() && choice.name.trim() !== suggested
      ? choice.name.trim()
      : undefined;

    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Building TAP...');
    try {
      const target: ProgramTarget = {
        kind: 'package',
        loaderIndex: chosen[0].index,
        depIndices: chosen.slice(1).map((e) => e.index),
      };
      const result = choice.shape === 'tosec-zip' && choice.metadata
        ? await api.exportTosec(disk.path, target, destDir, choice.metadata, editState, customName)
        : await api.extractPackage(
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
  }, [disk, selectedIndices, editState, askForExport, refreshArchiveStatus]);

  /**
   * Mark the selected programs by hand. The catalogue matches on bytes, so two
   * copies that differ by a renamed file or a byte of padding look like
   * different programs; this is how you say they are not.
   */
  const handleMarkSelected = useCallback(async (archived: boolean) => {
    if (!disk || selectedIndices.size === 0) return;
    try {
      const r = await api.markEntriesArchived(disk.path, [...selectedIndices], archived);
      if (!r) { setStatus('No catalogue is set — choose one in Preferences'); return; }
      setStatus(archived
        ? `Marked ${r.changed} of ${r.total} selected program(s) archived`
          + (r.changed < r.total ? ' — the rest were already' : '')
        : `Unmarked ${r.changed} program(s)`);
      refreshArchiveStatus(disk.path);
      setBrowserRefresh((n) => n + 1);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }, [disk, selectedIndices, refreshArchiveStatus]);

  const handleExtractPackage = useCallback(async () => {
    if (!disk || selectedIndices.size === 0) return;

    const pkg = packages.find((p) => selectedIndices.has(p.loader.index));
    if (!pkg) return;

    // Name the package, and decide whether it goes out loose or archived.
    const suggested = pkg.loader.filename.trim();
    const choice = await askForExport({
      title: 'Save package as',
      defaultValue: suggested,
      payloadExt: '.tap',
    });
    if (!choice) return;
    const customName = choice.name.trim() && choice.name.trim() !== suggested
      ? choice.name.trim()
      : undefined;

    const destDir = await api.selectDirectory();
    if (!destDir) return;

    setExtracting(true);
    setStatus('Extracting package...');
    try {
      const depIndices = pkg.dependencies.map((d) => d.index);
      const result = choice.shape === 'tosec-zip' && choice.metadata
        ? await api.exportTosec(
            disk.path, { kind: 'package', loaderIndex: pkg.loader.index, depIndices },
            destDir, choice.metadata, editState, customName,
          )
        : await api.extractPackage(disk.path, pkg.loader.index, depIndices, destDir, editState, customName);
      setStatus(result
        ? `Extracted package: ${result.filename.trim()}`
          + (result.marked ? ` — ${result.marked} marked archived` : '')
        : 'Package extraction failed');
      if (result?.marked) { refreshArchiveStatus(disk.path); setBrowserRefresh((n) => n + 1); }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setExtracting(false);
  }, [disk, selectedIndices, packages, editState, askForExport, refreshArchiveStatus]);

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
      const marked = results[0]?.marked ?? 0;
      setStatus(`Extracted ${results.length} file(s)`
        + (marked ? ` — ${marked} marked archived` : ''));
      if (marked) { refreshArchiveStatus(disk.path); setBrowserRefresh((n) => n + 1); }
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

  /**
   * Refresh the list that ships with the app, from the catalogue. The
   * catalogue is upstream of everything now, so this is how the copy other
   * people see gets brought up to date.
   */
  const handleExportKnown = useCallback(async () => {
    try {
      const r = await api.exportKnownPrograms();
      if (!r) return;
      // The whole path, not just the name. A packaged app cannot write inside
      // its own bundle and quietly falls back to the catalogue folder, and a
      // bare `known-programs.csv` gives no way to tell which happened.
      setStatus(`Wrote ${r.rows} program(s) to ${r.path}`
        + ` — ${r.archived} archived, ${r.matched} matched`
        + (r.inRepo ? '' : ' — not the shipped copy; move it into electron/data/'));
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }, []);

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
    const unsubRun = api.onMenuRunEmulator(() => runRef.current());
    const unsubKnown = api.onMenuExportKnown(() => { handleExportKnown(); });
    const unsubIngest = api.onMenuIngestCatalog(() => setShowIngest(true));
    const unsubInsights = api.onMenuCatalogInsights(() => setShowInsights(true));
    const unsubCheck = api.onMenuCheckCatalogUpdate(() => {
      api.checkCatalogUpdate(false).then((r) => setStatus(r.message)).catch(() => {});
    });
    const unsubWpSearch = api.onMenuWpSearch(() => setArchiveSearch({ query: '', mode: 'source' }));
    const unsubWpRefresh = api.onMenuWpRefresh(() => { refreshMatchesRef.current(); });
    const unsubWpPublish = api.onMenuWpPublish(() => { publishRef.current(); });
    return () => {
      unsub(); unsubKnown(); unsubCheck(); unsubIngest(); unsubInsights(); unsubRun();
      unsubWpSearch(); unsubWpRefresh(); unsubWpPublish();
    };
  }, [handleExportKnown]);

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

  /**
   * What Run would launch. It follows the same reading of the selection the
   * extract buttons do — a detected package, several files as one tape, or a
   * single file — so that the thing you watch load is the thing the button
   * beside it would write out.
   */
  const runTarget = useMemo((): ProgramTarget | null => {
    if (!disk || !RUNNABLE_FORMATS.includes(disk.format)) return null;

    if (selectedIndices.size === 1 && selectedPackage) {
      return {
        kind: 'package',
        loaderIndex: selectedPackage.loader.index,
        depIndices: selectedPackage.dependencies.map((d) => d.index),
      };
    }

    const chosen = flattenEntries(disk.catalog)
      .filter((e) => !e.isDirectory && selectedIndices.has(e.index));
    if (chosen.length === 0) return null;
    if (chosen.length === 1) return { kind: 'file', entryIndex: chosen[0].index };

    // Several at once only means a tape where the files are tape blocks. On a
    // ZX81 disk each file is a whole memory image, so the first one goes and
    // the rest are ignored rather than silently glued together.
    if (!TAP_FORMATS.includes(disk.format)) {
      return { kind: 'file', entryIndex: chosen[0].index };
    }
    return {
      kind: 'package',
      loaderIndex: chosen[0].index,
      depIndices: chosen.slice(1).map((e) => e.index),
    };
  }, [disk, selectedIndices, selectedPackage]);

  const handleRun = useCallback(async () => {
    if (!disk || !runTarget) return;
    setStatus('Starting ZEsarUX...');
    try {
      const result = await api.runInEmulator(disk.path, runTarget, editState);
      setStatus(result.message);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }, [disk, runTarget, editState]);

  /**
   * Re-read the published archive and re-match the catalogue against it.
   *
   * Reading close to two thousand records takes long enough to say so as it
   * goes; the status line carries the count rather than a spinner, because
   * the number is the only part of the wait that means anything.
   */
  const handleRefreshMatches = useCallback(async () => {
    setStatus('Reading the published archive...');
    const unsub = api.onWpRefreshProgress(({ done, total }) => {
      setStatus(`Reading the published archive... ${done}${total ? ` of ${total}` : ''}`);
    });
    try {
      const r = await api.wpRefreshMatches();
      if (!r.ok) { setStatus(r.error); return; }
      setStatus(
        `Matched ${r.matched} of ${r.programs} catalogued programs `
        + `(${r.exact} on a whole name) against ${r.records} published records; `
        + `${r.listings} listings copied for searching`,
      );
      setBrowserRefresh((n) => n + 1);
      if (disk) refreshArchiveStatus(disk.path);
    } catch (err: any) {
      setStatus(`Could not refresh matches: ${err.message}`);
    } finally {
      unsub();
    }
  }, [disk, refreshArchiveStatus]);

  useEffect(() => { runRef.current = handleRun; }, [handleRun]);
  /**
   * Publishing is one program at a time. A disk's worth of records is a
   * different job with different answers per program, and doing it in bulk
   * would mean guessing most of them.
   */
  const handlePublish = useCallback(() => {
    if (!disk) { setStatus('Open a disk image first'); return; }
    if (selectedIndices.size !== 1) {
      setStatus('Select exactly one program to publish');
      return;
    }
    const index = [...selectedIndices][0];
    const entry = flattenEntries(disk.catalog).find((e) => e.index === index);
    if (!entry) return;
    const remembered = loadRemembered();
    const base = entry.filename.trim();
    setPublishing({
      entryIndex: index,
      title: base,
      sourceFilename: `${previewArchiveName(base, remembered, archiveTypeSuffix(entry))}.zip`,
      metadata: { year: remembered.year, publisher: remembered.publisher },
    });
  }, [disk, selectedIndices]);

  useEffect(() => { publishRef.current = handlePublish; }, [handlePublish]);
  useEffect(() => { refreshMatchesRef.current = handleRefreshMatches; }, [handleRefreshMatches]);

  // Which site the selected program is asked about. Re-read when Preferences
  // closes, since that is the only place it changes.
  const loadWpUrl = useCallback(() => {
    if (!api) return;
    api.wpStatus().then((w) => setWordpressUrl(w.url)).catch(() => setWordpressUrl(null));
  }, []);
  useEffect(loadWpUrl, [loadWpUrl]);

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
        onMarkSelected={handleMarkSelected}
        hasCatalog={archiveStatus !== null}
        onExtractAll={handleExtractAll}
        onExtractPackage={handleExtractPackage}
        hasSelection={selectedIndices.size > 0}
        canBundleTap={canBundleTap}
        canRun={runTarget !== null}
        onRun={handleRun}
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
            gotoPath={browseTo}
            onWentTo={() => setBrowseTo(null)}
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
                archiveStatus={archiveStatus?.entries ?? null}
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
              wordpressUrl={wordpressUrl}
              onSearchArchive={(q) => setArchiveSearch({ query: q, mode: 'name' })}
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

      <StatusBar
        message={archiveStatus && archiveStatus.total > 0
          ? `${status}   ·   ${archiveStatus.fresh} of ${archiveStatus.total} program(s) new to the collection`
          : status}
        format={disk?.format}
        fileCount={disk?.catalog.length}
      />

      {disk && <DropZone onDrop={handleDrop} overlay />}

      {showPreferences && (
        <Preferences onClose={() => { setShowPreferences(false); loadWpUrl(); }} />
      )}

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

      {showIngest && (
        <CatalogIngest
          onClose={() => setShowIngest(false)}
          onStatus={setStatus}
          onIngested={() => {
            setBrowserRefresh((n) => n + 1);
            if (disk) refreshArchiveStatus(disk.path);
          }}
        />
      )}

      {publishOffer && !publishing && (
        <div
          onClick={() => setPublishOffer(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 22, width: 420, maxWidth: '92vw',
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              Bundle written
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
              Make a draft record for <strong>{publishOffer.title}</strong> on the site as well?
              It is the same program and the same answers you have just given &mdash; the year,
              the publisher and the machine carry over.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setPublishOffer(null)}
                style={{
                  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border)', fontSize: 12, padding: '6px 12px', borderRadius: 3,
                }}
              >
                Not now
              </button>
              <button
                onClick={() => { setPublishing(publishOffer); setPublishOffer(null); }}
                style={{
                  background: 'var(--accent)', color: '#fff',
                  border: '1px solid var(--border)', fontSize: 12, padding: '6px 12px', borderRadius: 3,
                }}
              >
                Publish to WordPress...
              </button>
            </div>
          </div>
        </div>
      )}

      {publishing && disk && (
        <PublishDialog
          imagePath={disk.path}
          entryIndex={publishing.entryIndex}
          defaultTitle={publishing.title}
          sourceFilename={publishing.sourceFilename}
          {...(editState[publishing.entryIndex]
            ? { editedLines: editState[publishing.entryIndex] }
            : {})}
          metadata={publishing.metadata}
          onClose={() => setPublishing(null)}
          onStatus={setStatus}
        />
      )}

      {archiveSearch && (
        <ArchiveSearch
          onClose={() => setArchiveSearch(null)}
          initialQuery={archiveSearch.query || undefined}
          initialMode={archiveSearch.mode}
        />
      )}

      {showInsights && (
        <CatalogInsights
          onClose={() => setShowInsights(false)}
          onStatus={setStatus}
          onBrowseTo={(p) => { setBrowseTo(p); setShowBrowser(true); }}
          onChanged={() => {
            setBrowserRefresh((n) => n + 1);
            if (disk) refreshArchiveStatus(disk.path);
          }}
        />
      )}

      {exportPrompt && (
        <ExportPrompt
          title={exportPrompt.title}
          defaultValue={exportPrompt.defaultValue}
          summary={exportPrompt.summary}
          payloadExt={exportPrompt.payloadExt}
          typeSuffix={exportPrompt.typeSuffix}
          onConfirm={(choice) => {
            exportPrompt.resolve(choice);
            setExportPrompt(null);
          }}
          onCancel={() => {
            exportPrompt.resolve(null);
            setExportPrompt(null);
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
