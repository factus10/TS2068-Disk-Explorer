/**
 * The file types the app can open, in one place.
 *
 * This list decides three things that must agree: what the Open dialog
 * filters to, what the file browser draws as openable, and what counts as an
 * image when tallying a folder's contents. A folder marked as archived
 * records how many images it held, so a disagreement here would report new
 * files that cannot actually be opened.
 */

export const SUPPORTED_EXTENSIONS = [
  'img', 'dsk', 'tap', 'tzx', 'sna', 'z80', 'scr', 'mgt', 'zip',
];

const SUPPORTED = new Set(SUPPORTED_EXTENSIONS);

export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot + 1).toLowerCase() : '';
}

export function isSupportedFile(name: string): boolean {
  return SUPPORTED.has(getExtension(name));
}
