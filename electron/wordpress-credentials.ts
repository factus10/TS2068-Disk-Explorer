/**
 * Where the application password lives.
 *
 * Every other setting is a path or a flag and sits in `settings.json` in
 * plain sight, which is right for them and wrong for this: an application
 * password can create and edit posts on the reader's site, and a readable
 * file is a poor home for it. Electron's `safeStorage` encrypts against the
 * OS keychain, so what lands on disk is ciphertext that only this machine's
 * login can open.
 *
 * The password is never logged, never sent anywhere but the site it belongs
 * to, and never leaves the main process — the renderer is told whether one is
 * stored, not what it is.
 *
 * Where encryption is unavailable — a Linux session with no keyring — nothing
 * is stored at all rather than stored in the clear. That costs the reader a
 * re-entry per session, which is the right way round.
 */

import { safeStorage } from 'electron';
import { getSettings, updateSettings } from './settings';

export interface CredentialState {
  user: string;
  /** Whether a password is stored. Never the password itself. */
  hasPassword: boolean;
  /** False when the OS offers no keychain, so nothing can be kept. */
  canStore: boolean;
}

function encryptionAvailable(): boolean {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

export function credentialState(): CredentialState {
  const { wordpressUser, wordpressPassword } = getSettings();
  return {
    user: wordpressUser ?? '',
    hasPassword: Boolean(wordpressPassword),
    canStore: encryptionAvailable(),
  };
}

/**
 * Keep a credential. An empty password clears the stored one rather than
 * writing an empty string, so "forget this" is expressible.
 */
export function saveCredentials(user: string, password: string): CredentialState {
  const trimmedUser = user.trim();

  if (!password) {
    updateSettings({ wordpressUser: trimmedUser || undefined, wordpressPassword: undefined });
    return credentialState();
  }

  if (!encryptionAvailable()) {
    // Storing it in the clear would be worse than not storing it, and saying
    // so is better than appearing to have saved it.
    updateSettings({ wordpressUser: trimmedUser || undefined, wordpressPassword: undefined });
    return credentialState();
  }

  const sealed = safeStorage.encryptString(password).toString('base64');
  updateSettings({ wordpressUser: trimmedUser || undefined, wordpressPassword: sealed });
  return credentialState();
}

/**
 * The credential in usable form, for the main process only. Null when there
 * is none, or when what was stored can no longer be opened — a keychain that
 * has moved on leaves ciphertext nothing can read, and asking again is the
 * only honest answer.
 */
export function readCredentials(): { user: string; password: string } | null {
  const { wordpressUser, wordpressPassword } = getSettings();
  if (!wordpressUser || !wordpressPassword) return null;
  if (!encryptionAvailable()) return null;

  try {
    const password = safeStorage.decryptString(Buffer.from(wordpressPassword, 'base64'));
    return password ? { user: wordpressUser, password } : null;
  } catch {
    return null;
  }
}
