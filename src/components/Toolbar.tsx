import React, { forwardRef } from 'react';

interface Props {
  onOpen: () => void;
  onExtractSelected: () => void;
  onExtractSelectedAsTap: () => void;
  onMarkSelected: (archived: boolean) => void;
  /** Whether a catalogue is loaded, so marking means anything. */
  hasCatalog: boolean;
  onExtractAll: () => void;
  onExtractPackage: () => void;
  hasSelection: boolean;
  canBundleTap: boolean;
  /** Whether the selection is something ZEsarUX could be handed. */
  canRun: boolean;
  onRun: () => void;
  hasPackageSelected: boolean;
  hasDisk: boolean;
  extracting: boolean;
  autoPackagesEnabled: boolean;
  onToggleAutoPackages: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  hasFonts: boolean;
  hasScreens: boolean;
  onExportAllFonts: () => void;
  onExportAllScreens: () => void;
  onCreateTap: () => void;
  onExportArchive: () => void;
  showBrowser: boolean;
  onToggleBrowser: () => void;
}

export const Toolbar = forwardRef<HTMLInputElement, Props>(function Toolbar({
  onOpen, onExtractSelected, onExtractSelectedAsTap, onMarkSelected, hasCatalog, onExtractAll, onExtractPackage,
  hasSelection, canBundleTap, canRun, onRun, hasPackageSelected, hasDisk, extracting,
  autoPackagesEnabled, onToggleAutoPackages,
  searchQuery, onSearchChange,
  theme, onToggleTheme,
  hasFonts, hasScreens, onExportAllFonts, onExportAllScreens, onCreateTap,
  onExportArchive, showBrowser, onToggleBrowser,
}, searchRef) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      // @ts-expect-error Electron-specific CSS property
      WebkitAppRegion: 'drag',
    }}>
      <span style={{
        fontWeight: 700,
        fontSize: 14,
        color: 'var(--accent)',
        marginRight: 12,
        letterSpacing: 0.5,
      }}>
        TS-2068 Disk Browser
      </span>

      {/* @ts-expect-error Electron-specific CSS property */}
      <div style={{ WebkitAppRegion: 'no-drag', display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
        <button
          onClick={onToggleBrowser}
          style={{
            background: showBrowser ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: showBrowser ? '#fff' : 'var(--text-secondary)',
            fontSize: 13,
            padding: '4px 8px',
            minWidth: 28,
          }}
          title={showBrowser ? 'Hide file browser (Cmd/Ctrl+B)' : 'Show file browser (Cmd/Ctrl+B)'}
        >
          {'\uD83D\uDCC1'}
        </button>
        <button
          onClick={onOpen}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          Open
        </button>
        <button
          onClick={onRun}
          disabled={!canRun || extracting}
          style={{
            background: canRun ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: canRun ? '#fff' : 'var(--text-muted)',
          }}
          title={canRun
            ? 'Run the selection in ZEsarUX, edits and all (Cmd/Ctrl+R)'
            : 'Select a program on a TS2068 or ZX81 disk to run it'}
        >
          {'\u25B6'} Run
        </button>
        <button
          onClick={onExtractSelected}
          disabled={!hasSelection || extracting}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          Extract Selected
        </button>
        {canBundleTap && (
          <button
            onClick={onExtractSelectedAsTap}
            disabled={extracting}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}
            title="Bundle the selected files into one multi-file TAP (first in catalog order becomes the loader)"
          >
            Selected as TAP
          </button>
        )}
        {hasCatalog && hasSelection && (
          <>
            <button
              onClick={() => onMarkSelected(true)}
              disabled={extracting}
              style={{ background: 'var(--bg-tertiary)', color: 'var(--badge-basic)' }}
              title="Mark the selected programs archived — reaches every copy, on every disk"
            >
              {'\u2714'} Archived
            </button>
            <button
              onClick={() => onMarkSelected(false)}
              disabled={extracting}
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 11 }}
              title="Unmark the selected programs"
            >
              Unmark
            </button>
          </>
        )}
        {hasPackageSelected && (
          <button
            onClick={onExtractPackage}
            disabled={extracting}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}
          >
            Extract as Package
          </button>
        )}
        <button
          onClick={onExtractAll}
          disabled={!hasDisk || extracting}
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {extracting ? 'Extracting...' : 'Extract All'}
        </button>

        {hasDisk && (
          <>
            <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            <button
              onClick={onToggleAutoPackages}
              style={{
                background: autoPackagesEnabled ? 'var(--bg-tertiary)' : 'var(--accent)',
                color: autoPackagesEnabled ? 'var(--text-secondary)' : '#fff',
                fontSize: 11,
              }}
              title={autoPackagesEnabled
                ? 'Auto TAP packages ON — click to disable and show flat file list'
                : 'Auto TAP packages OFF — showing flat file list for manual assembly'}
            >
              {autoPackagesEnabled ? 'Auto PKG' : 'Manual PKG'}
            </button>
          </>
        )}

        {hasDisk && (hasFonts || hasScreens) && (
          <>
            <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            {hasFonts && (
              <button
                onClick={onExportAllFonts}
                disabled={extracting}
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 11 }}
                title="Export all fonts as TTF files"
              >
                All Fonts
              </button>
            )}
            {hasScreens && (
              <button
                onClick={onExportAllScreens}
                disabled={extracting}
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 11 }}
                title="Export all screens as PNG files"
              >
                All Screens
              </button>
            )}
          </>
        )}

        <button
          onClick={onCreateTap}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 11 }}
          title="Create TAP from external files (Cmd/Ctrl+Shift+A)"
        >
          Create TAP
        </button>
        {hasDisk && (
          <button
            onClick={onExportArchive}
            disabled={extracting}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 11 }}
            title="Export all files with archive.org naming conventions"
          >
            Archive.org
          </button>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Search */}
        {hasDisk && (
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter files..."
            style={{
              width: 180,
              fontFamily: 'monospace',
              fontSize: 11,
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 8px',
              outline: 'none',
            }}
          />
        )}

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            padding: '4px 8px',
            minWidth: 28,
          }}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? '\u2600' : '\u263D'}
        </button>
      </div>
    </div>
  );
});
