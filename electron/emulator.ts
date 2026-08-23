/**
 * Launching a program in ZEsarUX.
 *
 * Running a program is not a new kind of export. The app already knows how to
 * turn a catalog entry into the bytes a real machine would have loaded — a TAP
 * for the Spectrum-family disks, a `.p` memory image for the ZX81 — and those
 * are exactly the bytes an emulator wants. So a launch is the ordinary export
 * written somewhere temporary, handed to an emulator that has been told which
 * machine to be.
 *
 * ZEsarUX rather than Fuse for two reasons. It covers every machine these
 * disks came from (Fuse has no ZX81 and no QL), and on macOS it is the only
 * one of the two that takes command line options at all: Fuse there is a Cocoa
 * app that ignores them, so a TS2068 tape would load into whatever machine it
 * was last left set to, with no way for the app to say otherwise.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { isZX81Format, type DiskFormat } from './parsers/types';

/**
 * Which machine a disk's programs belong to. Kept coarse on purpose: the
 * TS2068 and the ZX Spectrum load the same TAP, and the ZX81 and the TS1000
 * are the same machine with different badges, so the only distinction that
 * changes what gets passed is the one between the two families.
 */
export type EmulatorMachine = 'TS2068' | 'ZX81';

/**
 * ZEsarUX machine ids. The ZX81 disks in this collection are Aerco kit sold
 * into American homes, so they run as a TS1000 — the same ROM as a ZX81, and
 * a change of one word here if that ever proves the wrong call.
 */
const MACHINE_IDS: Record<EmulatorMachine, string> = {
  TS2068: 'TS2068',
  ZX81: 'TS1000',
};

/**
 * The machine a format's programs run on, or null when there is nothing an
 * emulator could do with them. CP/M files (Aerco RP/M, Zebra) and QL files
 * are the null cases: they are data for an operating system, not a tape a
 * machine can be handed at boot.
 */
export function machineForFormat(format: DiskFormat): EmulatorMachine | null {
  if (isZX81Format(format)) return 'ZX81';
  switch (format) {
    case 'larken':
    case 'oliger-v1':
    case 'oliger-v2':
    case 'aerco-dos64':
    case 'tap':
    case 'tzx':
      return 'TS2068';
    default:
      return null;
  }
}

/**
 * A stock ZX81 has 16K at 0x4000 and a program image starts at 0x4009, so
 * this is the largest `.p` that fits one. Anything above it came out of a
 * 64K Aerco page and needs the upper banks.
 */
const ZX81_16K_LIMIT = 16 * 1024 - 9;

/**
 * Options every launch gets. `--noconfigfile` is the important one: it means
 * the reader's own `~/.zesaruxrc` is neither read nor at risk, so a program
 * launched from here behaves the same way today as it did last week whatever
 * they have since changed in the emulator.
 */
const COMMON_ARGS = ['--noconfigfile', '--nowelcomemessage', '--nosplash'];

export function emulatorArgs(
  machine: EmulatorMachine, tapePath: string, payloadSize: number,
): string[] {
  if (machine === 'ZX81') {
    // BBDOS's 64K pages hold programs a 16K machine cannot, and ZEsarUX
    // reaches past 16K only through named upper banks rather than a larger
    // --zx8081mem. Adding them is harmless to a small program, but a stock
    // machine is the more faithful default, so they go on only when the
    // image proves it needs them.
    const ram = payloadSize > ZX81_16K_LIMIT
      ? ['--zx8081mem', '16', '--zx8081ram16K8000', '--zx8081ram16KC000']
      : ['--zx8081mem', '16'];
    return [...COMMON_ARGS, '--machine', MACHINE_IDS.ZX81, ...ram, '--tape', tapePath];
  }
  return [...COMMON_ARGS, '--machine', MACHINE_IDS[machine], '--tape', tapePath];
}

/** Where ZEsarUX installs itself, per platform. */
function emulatorCandidates(): string[] {
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/zesarux.app/Contents/MacOS/zesarux',
        '/Applications/ZEsarUX.app/Contents/MacOS/zesarux',
        path.join(process.env.HOME ?? '', 'Applications/zesarux.app/Contents/MacOS/zesarux'),
      ];
    case 'win32':
      return [
        'C:\\Program Files\\ZEsarUX\\zesarux.exe',
        'C:\\Program Files (x86)\\ZEsarUX\\zesarux.exe',
      ];
    default:
      return ['/usr/bin/zesarux', '/usr/local/bin/zesarux', '/usr/games/zesarux'];
  }
}

function onPath(name: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* next */ }
  }
  return null;
}

/**
 * The emulator to use: what the reader chose if it is still there, otherwise
 * wherever ZEsarUX installed itself. Returning null is the honest answer that
 * lets the caller say "not installed" rather than fail on spawn.
 */
export function findEmulator(configured?: string): string | null {
  if (configured) {
    try {
      fs.accessSync(configured, fs.constants.X_OK);
      return configured;
    } catch { /* fall through and look for it ourselves */ }
  }
  for (const candidate of emulatorCandidates()) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* next */ }
  }
  return onPath(process.platform === 'win32' ? 'zesarux.exe' : 'zesarux');
}

/**
 * Start the emulator and forget about it. Detached and unref'd because the
 * reader closing the browser should not take the emulator with it, and
 * because nothing here wants to hear what it has to say on stdout.
 */
export function launchEmulator(exePath: string, args: string[]): void {
  const child = spawn(exePath, args, { detached: true, stdio: 'ignore' });
  child.unref();
}
