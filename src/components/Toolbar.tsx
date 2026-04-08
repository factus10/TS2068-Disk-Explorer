import React from 'react';

interface Props {
  onOpen: () => void;
  onExtractSelected: () => void;
  onExtractAll: () => void;
  onExtractPackage: () => void;
  hasSelection: boolean;
  hasPackageSelected: boolean;
  hasDisk: boolean;
  extracting: boolean;
  autoPackagesEnabled: boolean;
  onToggleAutoPackages: () => void;
}

export function Toolbar({
  onOpen, onExtractSelected, onExtractAll, onExtractPackage,
  hasSelection, hasPackageSelected, hasDisk, extracting,
  autoPackagesEnabled, onToggleAutoPackages,
}: Props) {
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
      <div style={{ WebkitAppRegion: 'no-drag', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={onOpen}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          Open
        </button>
        <button
          onClick={onExtractSelected}
          disabled={!hasSelection || extracting}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          Extract Selected
        </button>
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
      </div>
    </div>
  );
}
