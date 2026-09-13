/**
 * Frontend-independent credential facade.
 *
 * Logical secret-map semantics live in CredentialVault. Electron safeStorage is only an adapter
 * for protecting the vault's random master key and a migration source for legacy secrets.bin.
 * No secret value is written to config.json, argv, logs, or a plaintext fallback.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeStorage } from 'electron';
import type { SecureStorageInfo } from '../shared/types.js';
import { logError } from './logger.js';
import { probeSecureStorage } from './secure-storage-probe.js';
import {
  CredentialVaultError,
  createCredentialVault,
  type CredentialVault,
  type VaultSecretKey
} from './credentials/vault.js';
import { createElectronCredentialProvider } from './credentials/electron-provider.js';
import type { CredentialProvider } from './credentials/provider.js';

const LEGACY_FILE_NAME = 'secrets.bin';
const MIGRATION_MARKER = 'credentials.migrated';
const LINUX_BASIC_TEXT_PREFIX = Buffer.from('v10', 'ascii');

let userDataDir = '';
let legacySecretsPath = '';
let migrationMarkerPath = '';
let vault: CredentialVault | null = null;
let legacyUnreadableObserved = false;
let legacyAccessFailed = false;
let vaultUnreadableObserved = false;
let vaultAccessFailed = false;
let vaultTestHooks: { beforeVaultCommit?: () => void | Promise<void> } = {};

export type SecretKey = VaultSecretKey;
export type SecretStorageErrorCode = 'secure_storage_unavailable' | 'stored_credentials_unreadable';

export class SecretStorageError extends Error {
  constructor(
    public readonly code: SecretStorageErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SecretStorageError';
  }
}

function unavailableError(): SecretStorageError {
  return new SecretStorageError(
    'secure_storage_unavailable',
    'Secure OS credential storage is unavailable, so the key was not saved'
  );
}

function unreadableError(): SecretStorageError {
  return new SecretStorageError(
    'stored_credentials_unreadable',
    'Stored credentials could not be decrypted; the encrypted file was left untouched'
  );
}

export function secureStorageCiphertextIsProtected(
  encrypted: Buffer,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform !== 'linux' || !encrypted.subarray(0, LINUX_BASIC_TEXT_PREFIX.length).equals(LINUX_BASIC_TEXT_PREFIX);
}

export async function secureStorageStatus(platform: NodeJS.Platform = process.platform): Promise<SecureStorageInfo> {
  try {
    const probe = await probeSecureStorage(platform);
    if (!probe.asyncAvailable || probe.error === 'availability') {
      return {
        available: false,
        reason: 'provider_unavailable',
        detail:
          platform === 'linux'
            ? 'Secure credential storage is unavailable. Start or unlock a Linux desktop keyring/Secret Service (for example GNOME Keyring or KWallet), then try again.'
            : platform === 'darwin'
              ? 'macOS Keychain credential storage is unavailable. Unlock the login keychain, then try again.'
              : 'Secure operating-system credential storage is unavailable on this machine.'
      };
    }
    if (platform === 'linux') {
      if (probe.error === 'encrypt') {
        return {
          available: false,
          reason: 'provider_unavailable',
          detail: 'Secure operating-system credential storage could not be initialized.'
        };
      }
      if (!probe.protected) {
        return {
          available: false,
          reason: 'insecure_linux_fallback',
          detail:
            'Linux secure storage fell back to Electron’s insecure hard-coded-key provider. Start or unlock a desktop keyring/Secret Service (for example GNOME Keyring or KWallet), then restart ComGu.'
        };
      }
    }
    return { available: true, reason: 'available', detail: null };
  } catch {
    return {
      available: false,
      reason: 'provider_unavailable',
      detail: 'Secure operating-system credential storage could not be initialized.'
    };
  }
}

export async function isEncryptionAvailable(platform: NodeJS.Platform = process.platform): Promise<boolean> {
  return (await secureStorageStatus(platform)).available;
}

function parseLegacySecretStore(json: string): Record<string, string> {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unreadableError();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new Error(`Stored credential field ${key} is not a string`);
  }
  return parsed as Record<string, string>;
}

async function readLegacyStore(): Promise<Record<string, string> | null> {
  if (!legacySecretsPath) return null;
  let blob: Buffer;
  try {
    blob = await fs.readFile(legacySecretsPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  if (!(await isEncryptionAvailable())) {
    legacyAccessFailed = true;
    throw unavailableError();
  }
  if (!secureStorageCiphertextIsProtected(blob)) {
    legacyUnreadableObserved = true;
    legacyAccessFailed = false;
    throw unreadableError();
  }

  try {
    const decrypted = await safeStorage.decryptStringAsync(blob);
    const parsed = parseLegacySecretStore(decrypted.result);
    legacyUnreadableObserved = false;
    legacyAccessFailed = false;
    return parsed;
  } catch (error) {
    if (error instanceof SecretStorageError) {
      legacyUnreadableObserved = true;
      legacyAccessFailed = false;
    } else if (error instanceof SyntaxError || /Stored credential field/.test((error as Error).message)) {
      legacyUnreadableObserved = true;
      legacyAccessFailed = false;
    } else {
      // Electron 43 does not expose enough detail to distinguish a temporarily locked keyring
      // from app-identity/key-material mismatch. Keep the ciphertext authoritative and retryable.
      legacyAccessFailed = true;
      legacyUnreadableObserved = false;
    }
    throw error;
  }
}

async function uniqueBackup(file: string, label: 'migrated' | 'unreadable'): Promise<string> {
  const stamp = Date.now();
  let candidate = `${file}.${label}-${stamp}.bak`;
  for (let suffix = 1; ; suffix += 1) {
    try {
      await fs.access(candidate);
      candidate = `${file}.${label}-${stamp}-${suffix}.bak`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw error;
    }
  }
}

async function markLegacyMigrated(): Promise<void> {
  try {
    await fs.access(legacySecretsPath);
    const backup = await uniqueBackup(legacySecretsPath, 'migrated');
    await fs.rename(legacySecretsPath, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const tmp = `${migrationMarkerPath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    await fs.writeFile(tmp, 'credential-vault-v1\n', { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, migrationMarkerPath);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
  legacyUnreadableObserved = false;
  legacyAccessFailed = false;
}

function ensureVault(): CredentialVault {
  if (!vault) throw new Error('Credential storage path has not been initialized');
  return vault;
}

async function refreshVaultState(): Promise<void> {
  const status = await ensureVault().status();
  vaultUnreadableObserved = status.reason === 'stored_credentials_unreadable';
  vaultAccessFailed = status.reason === 'provider_unavailable';
}

function translateVaultError(error: unknown): never {
  if (error instanceof CredentialVaultError) {
    throw error.code === 'stored_credentials_unreadable' ? unreadableError() : unavailableError();
  }
  throw error;
}

export function initSecretsPath(directory: string, options: { provider?: CredentialProvider } = {}): void {
  userDataDir = directory;
  legacySecretsPath = path.join(directory, LEGACY_FILE_NAME);
  migrationMarkerPath = path.join(directory, MIGRATION_MARKER);
  legacyUnreadableObserved = false;
  legacyAccessFailed = false;
  vaultUnreadableObserved = false;
  vaultAccessFailed = false;
  vault = createCredentialVault({
    directory,
    provider: options.provider ?? createElectronCredentialProvider(process.platform),
    legacy: {
      read: readLegacyStore,
      markMigrated: markLegacyMigrated
    },
    hooks: {
      beforeVaultCommit: () => vaultTestHooks.beforeVaultCommit?.()
    }
  });
}

/** Internal deterministic test seam; production never installs these hooks. */
export function setCredentialVaultTestHooks(hooks: { beforeVaultCommit?: () => void | Promise<void> }): void {
  vaultTestHooks = hooks;
}

export async function getSecret(key: SecretKey): Promise<string | null> {
  try {
    const value = await ensureVault().get(key);
    await refreshVaultState();
    return value;
  } catch (error) {
    await refreshVaultState().catch(() => undefined);
    if (error instanceof CredentialVaultError) return null;
    return null;
  }
}

export async function hasSecret(key: SecretKey): Promise<boolean> {
  return (await getSecret(key)) !== null;
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  try {
    await ensureVault().set(key, value);
    await refreshVaultState();
  } catch (error) {
    await refreshVaultState().catch(() => undefined);
    translateVaultError(error);
  }
}

export function clearSecret(key: SecretKey): Promise<void> {
  return setSecret(key, '');
}

export function storedCredentialsUnreadable(): boolean {
  return legacyUnreadableObserved || vaultUnreadableObserved;
}

export function storedCredentialsAccessFailed(): boolean {
  return legacyAccessFailed || vaultAccessFailed;
}

export async function archiveUnreadableSecrets(): Promise<string> {
  if (vaultUnreadableObserved) {
    const backups = await ensureVault().archiveUnreadable();
    vaultUnreadableObserved = false;
    vaultAccessFailed = false;
    if (backups[0]) return backups[0];
    throw new Error('Stored credentials were unreadable but no encrypted vault file was present');
  }

  if (!legacyUnreadableObserved) throw new Error('Stored credentials are not unreadable; recovery was refused');
  if (!(await isEncryptionAvailable())) throw unavailableError();
  const backup = await uniqueBackup(legacySecretsPath, 'unreadable');
  await fs.rename(legacySecretsPath, backup);
  legacyUnreadableObserved = false;
  legacyAccessFailed = false;
  ensureVault().resetCacheForTests();
  return backup;
}

export async function deleteAllSecrets(): Promise<void> {
  try {
    await ensureVault().deleteAll();
    await Promise.all([
      fs.rm(legacySecretsPath, { force: true }),
      fs.rm(migrationMarkerPath, { force: true })
    ]);
    legacyUnreadableObserved = false;
    legacyAccessFailed = false;
    vaultUnreadableObserved = false;
    vaultAccessFailed = false;
  } catch (error) {
    logError(`Could not remove stored credentials: ${(error as Error).message}`);
    throw error;
  }
}

/** Test seam: forget decrypted state so the next read comes from protected files. */
export function resetSecretsCacheForTests(): void {
  void userDataDir;
  ensureVault().resetCacheForTests();
  legacyUnreadableObserved = false;
  legacyAccessFailed = false;
  vaultUnreadableObserved = false;
  vaultAccessFailed = false;
  vaultTestHooks = {};
}
