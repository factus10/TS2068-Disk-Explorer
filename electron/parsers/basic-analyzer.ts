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

/** One `LOAD "name"` in a line, with where its name sits in the bytes. */
interface LoadSite extends LoadReference {
  nameStart: number;
  nameEnd: number;
}

/**
 * Every LOAD in one line body, `start` to `end`. Handles both tape-style
 * LOAD "name" and Oliger disk-style LOAD /"name".
 */
function loadsInLine(content: Buffer, lineNumber: number, start: number, end: number): LoadSite[] {
  const sites: LoadSite[] = [];
  let pos = start;

  while (pos < end) {
    // Skip inline number literals (5-byte floats after 0x0E)
    if (content[pos] === NUM_MARKER && pos + 6 <= end) {
      pos += 6;
      continue;
    }

    // Look for LOAD token
    if (content[pos] === TOKEN_LOAD) {
      pos++;
      // Skip optional Oliger disk prefix "/" before the quote
      if (pos < end && content[pos] === SLASH) {
        pos++;
      }
      // Expect opening quote
      if (pos < end && content[pos] === QUOTE) {
        pos++;
        // Read filename until closing quote
        const nameStart = pos;
        let filename = '';
        while (pos < end && content[pos] !== QUOTE && content[pos] !== NEWLINE) {
          filename += String.fromCharCode(content[pos]);
          pos++;
        }
        const nameEnd = pos;
        if (pos < end && content[pos] === QUOTE) {
          pos++; // skip closing quote
        }

        // Check for type keyword after optional spaces
        let loadType: LoadReference['loadType'] = 'any';
        let scan = pos;
        while (scan < end && content[scan] === 0x20) scan++;
        if (scan < end) {
          if (content[scan] === TOKEN_CODE) loadType = 'code';
          else if (content[scan] === TOKEN_SCREEN) loadType = 'screen';
          else if (content[scan] === TOKEN_DATA) loadType = 'data';
        }

        sites.push({ lineNumber, filename, loadType, nameStart, nameEnd });
      }
      continue;
    }

    pos++;
  }

  return sites;
}

/**
 * Walk the lines of a BASIC program, `limit` bytes of it.
 * BASIC lines: [2B lineNum BE] [2B lineLen LE] [body...] [0x0D]
 * Calls `visit` for each line, and returns where the walk stopped.
 */
function walkLines(
  content: Buffer, limit: number,
  visit: (lineNumber: number, offset: number, lineEnd: number, strayNewline: boolean) => void,
): number {
  let offset = 0;

  while (offset + 4 <= limit) {
    const lineNumber = readUint16BE(content, offset);
    const lineLen = readUint16LE(content, offset + 2);
    if (lineNumber > 9999 || lineLen === 0 || offset + 4 + lineLen > limit) break;

    const lineEnd = offset + 4 + lineLen;

    // Handle off-by-one line lengths (stray 0x0D between lines)
    let stray = false;
    if (lineEnd < limit && content[lineEnd] === NEWLINE && lineEnd + 5 < limit) {
      const nextLn = readUint16BE(content, lineEnd + 1);
      const nextLen = readUint16LE(content, lineEnd + 3);
      stray = nextLn > lineNumber && nextLn <= 9999 && nextLen > 0 && nextLen < 5000;
    }

    visit(lineNumber, offset, lineEnd, stray);
    offset = lineEnd + (stray ? 1 : 0);
  }

  return offset;
}

/**
 * Scan BASIC program bytes for LOAD commands and extract references.
 */
export function scanBasicForLoads(content: Buffer): LoadReference[] {
  const refs: LoadReference[] = [];
  walkLines(content, content.length, (lineNumber, offset, lineEnd) => {
    for (const site of loadsInLine(content, lineNumber, offset + 4, lineEnd)) {
      refs.push({ lineNumber: site.lineNumber, filename: site.filename, loadType: site.loadType });
    }
  });
  return refs;
}

/**
 * Give the files of a package new names on the tape, and keep the BASIC
 * among them pointing at those files.
 *
 * A tape is searched by name: `LOAD "SPRITES" CODE` skips every block until
 * one is called SPRITES. Renaming that block and nothing else writes a tape
 * whose loader waits forever, so each LOAD naming a renamed member is
 * rewritten to the new name. The rewrite is done on the bytes rather than
 * the listing, so nothing else about a line can change; a line the reader
 * has edited by hand is left to that edit, which replaces the line whole.
 *
 * Returns the entry as it should be written, and its bytes. Both are the
 * originals when nothing in the package was renamed.
 */
export function applyTapeNames(
  entry: FileEntry, data: Buffer, members: FileEntry[],
  tapeNames?: Record<number, string>,
): { entry: FileEntry; data: Buffer } {
  const renamed = members.filter((m) => isRenamed(m, tapeNames));
  if (renamed.length === 0) return { entry, data };

  let out: FileEntry = isRenamed(entry, tapeNames)
    ? { ...entry, filename: cleanTapeName(tapeNames![entry.index]) }
    : entry;
  if (entry.type !== 'basic') return { entry: out, data };

  const programLength = Math.min(
    entry.params.varsOffset ?? entry.params.param2 ?? data.length, data.length,
  );

  const parts: Buffer[] = [];
  let delta = 0;
  let changed = false;
  const stopped = walkLines(data, programLength, (lineNumber, offset, lineEnd, stray) => {
    const body: Buffer[] = [];
    let cursor = offset + 4;
    for (const site of loadsInLine(data, lineNumber, offset + 4, lineEnd)) {
      const target = site.filename === '' ? undefined : renamed.find((m) =>
        m.filename.trim().toLowerCase() === site.filename.trim().toLowerCase()
        && refersTo(site.loadType, m));
      if (!target) continue;
      changed = true;
      body.push(data.subarray(cursor, site.nameStart));
      body.push(Buffer.from(cleanTapeName(tapeNames![target.index]), 'latin1'));
      cursor = site.nameEnd;
    }
    body.push(data.subarray(cursor, lineEnd));

    const newBody = Buffer.concat(body);
    delta += newBody.length - (lineEnd - offset - 4);
    const header = Buffer.from(data.subarray(offset, offset + 4));
    header.writeUInt16LE(newBody.length, 2);
    parts.push(header, newBody);
    if (stray) parts.push(Buffer.from([NEWLINE]));
  });
  if (!changed) return { entry: out, data };
  parts.push(data.subarray(stopped));

  const newData = Buffer.concat(parts);
  const newProgramLength = programLength + delta;
  out = {
    ...out,
    size: newData.length,
    params: {
      ...out.params,
      ...(out.params.varsOffset !== undefined ? { varsOffset: newProgramLength } : {}),
      ...(out.params.param2 !== undefined ? { param2: newProgramLength } : {}),
    },
  };
  // Neither recorded: the program ran to the end of the file, and still does.
  return { entry: out, data: newData };
}

/** What can be written in a tape header's name: ten printable ASCII characters. */
export function cleanTapeName(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 10);
}

function isRenamed(entry: FileEntry, tapeNames?: Record<number, string>): boolean {
  const name = tapeNames?.[entry.index];
  if (name === undefined) return false;
  const clean = cleanTapeName(name);
  return clean !== '' && clean !== entry.filename.trim();
}

/**
 * Whether a LOAD of this kind could fetch this file. A bare LOAD "name" on
 * tape fetches a program, but an Oliger disk LOAD /"name" takes anything, and
 * package detection matches it the same way, so 'any' prefers nothing.
 */
function refersTo(loadType: LoadReference['loadType'], entry: FileEntry): boolean {
  switch (loadType) {
    case 'code':
    case 'screen': return entry.type === 'code';
    case 'data': return entry.type === 'num-array' || entry.type === 'str-array';
    default: return true;
  }
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
