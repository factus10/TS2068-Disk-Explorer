import type { FileEntry, TapPackage } from './types';

export interface ArchivePlan {
  /** Packages to write as a single multi-file TAP. */
  bundled: TapPackage[];
  /**
   * Every entry the export covers, in catalog order. Anything here that a
   * bundle did not swallow is written on its own, and each gets a .dis pair.
   */
  covered: FileEntry[];
}

/**
 * Decide what an archive.org export writes, given the whole catalog, the
 * packages detected in it, and an optional set of chosen catalog indices.
 *
 * The rule for a subset is that a package is bundled only when every one of
 * its members was chosen. Bundling a partly-chosen package would put files in
 * the export that the user did not pick, and dropping the loader's package
 * silently would lose the loader; so a partial package degrades to its chosen
 * members written individually.
 */
export function planArchiveExport(
  allEntries: FileEntry[],
  packages: TapPackage[],
  selection?: number[],
): ArchivePlan {
  const wanted = selection ? new Set(selection) : null;
  const isWanted = (entry: FileEntry) => !wanted || wanted.has(entry.index);

  const bundled = packages.filter(
    (pkg) => isWanted(pkg.loader) && pkg.dependencies.every(isWanted),
  );

  const covered = allEntries.filter((e) => !e.isDirectory && isWanted(e));

  return { bundled, covered };
}
