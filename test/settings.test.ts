import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The module reads app.getPath('userData'), which only exists inside Electron.
let userData = '';
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const load = async () => {
  vi.resetModules();
  return import('../electron/settings');
};

beforeEach(() => { userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ts2068-settings-')); });
afterEach(() => { fs.rmSync(userData, { recursive: true, force: true }); });

describe('settings storage', () => {
  it('starts empty, and says so rather than inventing a folder', async () => {
    const { getSettings } = await load();
    expect(getSettings()).toEqual({});
  });

  it('round-trips a folder that exists', async () => {
    const { getSettings, updateSettings } = await load();
    updateSettings({ extractionDir: userData });
    expect(getSettings()).toEqual({ extractionDir: userData });
  });

  it('forgets a folder that has since gone', async () => {
    // A saved path outlives the folder it names — an unplugged drive, a
    // cleared Downloads. Reporting it as set would send an extraction
    // somewhere that is not there, or fail at the point of use; falling back
    // to asking is the recoverable option.
    const { getSettings, updateSettings } = await load();
    const gone = path.join(userData, 'temporary');
    fs.mkdirSync(gone);
    updateSettings({ extractionDir: gone });
    expect(getSettings().extractionDir).toBe(gone);
    fs.rmSync(gone, { recursive: true });
    expect(getSettings().extractionDir).toBeUndefined();
  });

  it('refuses a path that is a file rather than a folder', async () => {
    const { getSettings, updateSettings } = await load();
    const file = path.join(userData, 'not-a-folder.txt');
    fs.writeFileSync(file, 'x');
    updateSettings({ extractionDir: file });
    expect(getSettings().extractionDir).toBeUndefined();
  });

  it('clears a setting when given undefined', async () => {
    const { getSettings, updateSettings } = await load();
    updateSettings({ extractionDir: userData });
    updateSettings({ extractionDir: undefined });
    expect(getSettings()).toEqual({});
    // and does not leave a null behind in the file
    const raw = fs.readFileSync(path.join(userData, 'settings.json'), 'utf-8');
    expect(raw).not.toContain('null');
  });

  it('survives a corrupt file rather than stopping the app', async () => {
    const { getSettings } = await load();
    fs.writeFileSync(path.join(userData, 'settings.json'), '{ not json');
    expect(getSettings()).toEqual({});
  });

  it('ignores a value of the wrong type', async () => {
    const { getSettings } = await load();
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ extractionDir: 42 }));
    expect(getSettings()).toEqual({});
  });
});
