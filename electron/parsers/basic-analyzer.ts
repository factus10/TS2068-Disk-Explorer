import { readUint16BE, readUint16LE } from './utils';
import type { FileEntry, LoadReference, TapPackage } from './types';

// ZX Spectrum BASIC tokens
const TOKEN_LOAD = 0xef;
const TOKEN_CODE = 0xaf;
const TOKEN_SCREEN = 0xaa;
const TOKEN_DATA = 0xe4;
const QUOTE = 0x22;
const NEWLINE = 0x0d;
const NUM_MARKER = 0x0e;
const SLASH = 0x2f;

const SCREEN_SIZE = 6912;

/**
 * Scan BASIC program bytes for LOAD commands and extract references.
 * Handles both tape-style LOAD "name" and Oliger disk-style LOAD /"name".
 * BASIC lines: [2B lineNum BE] [2B lineLen LE] [body...] [0x0D]
 */
export function scanBasicForLoads(content: Buffer): LoadReference[] {
  const refs: LoadReference[] = [];
  let offset = 0;

  while (offset + 4 <= content.length) {
    const lineNumber = readUint16BE(content, offset);
    const lineLen = readUint16LE(content, offset + 2);
    if (lineNumber > 9999 || lineLen === 0 || offset + 4 + lineLen > content.length) break;

    const lineEnd = offset + 4 + lineLen;
    let pos = offset + 4;

    while (pos < lineEnd) {
      // Skip inline number literals (5-byte floats after 0x0E)
      if (content[pos] === NUM_MARKER && pos + 6 <= lineEnd) {
        pos += 6;
        continue;
      }

      // Look for LOAD token
      if (content[pos] === TOKEN_LOAD) {
        pos++;
        // Skip optional Oliger disk prefix "/" before the quote
        if (pos < lineEnd && content[pos] === SLASH) {
          pos++;
        }
        // Expect opening quote
        if (pos < lineEnd && content[pos] === QUOTE) {
          pos++;
          // Read filename until closing quote
          let filename = '';
          while (pos < lineEnd && content[pos] !== QUOTE && content[pos] !== NEWLINE) {
            filename += String.fromCharCode(content[pos]);
            pos++;
          }
          if (pos < lineEnd && content[pos] === QUOTE) {
            pos++; // skip closing quote
          }

          // Check for type keyword after optional spaces
          let loadType: LoadReference['loadType'] = 'any';
          let scan = pos;
          while (scan < lineEnd && content[scan] === 0x20) scan++;
          if (scan < lineEnd) {
            if (content[scan] === TOKEN_CODE) loadType = 'code';
            else if (content[scan] === TOKEN_SCREEN) loadType = 'screen';
            else if (content[scan] === TOKEN_DATA) loadType = 'data';
          }

          refs.push({ lineNumber, filename, loadType });
        }
        continue;
      }

      pos++;
    }

    offset = lineEnd;
  }

  return refs;
}

/**
 * Build TAP packages by matching LOAD references to catalog entries.
 * Returns packages for BASIC programs that have resolvable dependencies.
 */
export function buildTapPackages(
  catalog: FileEntry[],
  fileDataMap: Map<number, Buffer>,
): TapPackage[] {
  const packages: TapPackage[] = [];
  const claimedIndices = new Set<number>();

  // First pass: scan all BASIC files for LOADs
  const allEntries = flattenCatalog(catalog);
  const basicFiles = allEntries.filter(
    (e) => e.type === 'basic' && !e.isDirectory && !e.isMemoryDump,
  );

  for (const loader of basicFiles) {
    // Skip files already claimed as a dependency of another package
    if (claimedIndices.has(loader.index)) continue;

    const data = fileDataMap.get(loader.index);
    if (!data) continue;

    const refs = scanBasicForLoads(data);
    if (refs.length === 0) continue;

    const dependencies: FileEntry[] = [];
    const unresolved: LoadReference[] = [];

    const seen = new Set<number>();
    for (const ref of refs) {
      const match = findMatchingEntry(ref, loader, allEntries, claimedIndices, fileDataMap);
      if (match && !seen.has(match.index)) {
        dependencies.push(match);
        seen.add(match.index);
      } else if (!match) {
        unresolved.push(ref);
      }
    }

    if (dependencies.length > 0) {
      packages.push({ loader, dependencies, unresolved });
      for (const dep of dependencies) {
        claimedIndices.add(dep.index);
      }
    }
  }

  return packages;
}

/**
 * Find a catalog entry matching a LOAD reference.
 */
function findMatchingEntry(
  ref: LoadReference,
  loader: FileEntry,
  allEntries: FileEntry[],
  claimed: Set<number>,
  fileDataMap: Map<number, Buffer>,
): FileEntry | null {
  const candidates = allEntries.filter(
    (e) => !e.isDirectory && !e.isMemoryDump && e.index !== loader.index && !claimed.has(e.index),
  );

  if (ref.filename === '') {
    // LOAD "" — match only by naming convention (e.g. "FILE1" -> "file1 C")
    const loaderBase = loader.filename.trim().toLowerCase();
    return candidates.find((e) => {
      const entryName = e.filename.trim().toLowerCase();
      // Exact same name but different type
      const exactMatch = entryName === loaderBase;
      // Common convention: BASIC "name" has CODE companion "name C"
      const suffixMatch = entryName === loaderBase + ' c';
      return (exactMatch || suffixMatch) && matchesLoadType(e, ref.loadType, fileDataMap);
    }) ?? null;
  }

  // Match by explicit filename (case-insensitive, trimmed)
  const target = ref.filename.trim().toLowerCase();
  return candidates.find((e) => {
    const nameMatch = e.filename.trim().toLowerCase() === target;
    const typeMatch = ref.loadType === 'any' || matchesLoadType(e, ref.loadType, fileDataMap);
    return nameMatch && typeMatch;
  }) ?? null;
}

function matchesLoadType(
  entry: FileEntry,
  loadType: LoadReference['loadType'],
  fileDataMap: Map<number, Buffer>,
): boolean {
  if (loadType === 'any') return true;
  if (loadType === 'screen') {
    // SCREEN$ loads must be CODE type and exactly 6912 bytes
    const data = fileDataMap.get(entry.index);
    return entry.type === 'code' && (data?.length ?? entry.size) === SCREEN_SIZE;
  }
  if (loadType === 'code') return entry.type === 'code';
  if (loadType === 'data') return entry.type === 'num-array' || entry.type === 'str-array';
  return false;
}

function flattenCatalog(entries: FileEntry[]): FileEntry[] {
  const flat: FileEntry[] = [];
  for (const e of entries) {
    flat.push(e);
    if (e.children) flat.push(...e.children);
  }
  return flat;
}
