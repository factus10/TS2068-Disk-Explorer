/**
 * Simple recent files storage using a JSON file in app userData.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const MAX_RECENT = 10;

function getFilePath(): string {
  return path.join(app.getPath('userData'), 'recent-files.json');
}

export function getRecent(): string[] {
  try {
    const data = fs.readFileSync(getFilePath(), 'utf-8');
    const list = JSON.parse(data);
    return Array.isArray(list) ? list.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function addRecent(filePath: string): string[] {
  const list = getRecent().filter((p) => p !== filePath);
  list.unshift(filePath);
  const trimmed = list.slice(0, MAX_RECENT);
  try {
    fs.writeFileSync(getFilePath(), JSON.stringify(trimmed, null, 2));
  } catch {
    // ignore write errors
  }
  return trimmed;
}

export function clearRecent(): void {
  try {
    fs.writeFileSync(getFilePath(), '[]');
  } catch {
    // ignore
  }
}
