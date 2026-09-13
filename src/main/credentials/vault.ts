import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CredentialProvider } from './provider.js';

const KEY_FILE = 'credentials.key';
const VAULT_FILE = 'credentials.vault';
const VAULT_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AAD = Buffer.from('comgu-credential-vault-v1', 'utf8');

export type VaultSecretKey = 'openaiApiKey' | 'bridgeToken' | 'openRouterApiKey' | 'approvedExtensionOrigin';
export type CredentialVaultErrorCode = 'secure_storage_unavailable' | 'stored_credentials_unreadable';

export class CredentialVaultError extends Error {
  constructor(public readonly code: CredentialVaultErrorCode, message: string) {
    super(message);
    this.name = 'CredentialVaultError';
  }
}

export interface LegacyCredentialSource {
  read(): Promise<Record<string, string> | null>;
  markMigrated(): Promise<void>;
}

export interface CredentialVault {
  status(): Promise<
    | { available: true; readable: true; reason: 'available' }
    | { available: true; readable: false; reason: 'stored_credentials_unreadable' }
    | { available: false; readable: false; reason: 'provider_unavailable'; detail?: string }
  >;
  get(key: VaultSecretKey): Promise<string | null>;
  set(key: VaultSecretKey, value: string): Promise<void>;
  delete(key: VaultSecretKey): Promise<void>;
  /** Explicit recovery/admin operations used only by the local ComGu frontend. */
  deleteAll(): Promise<void>;
  archiveUnreadable(): Promise<string[]>;
  resetCacheForTests(): void;
}

interface VaultHooks {
  beforeVaultCommit?: () => void | Promise<void>;
  afterVaultCommit?: () => void | Promise<void>;
  beforeVaultVerify?: () => void | Promise<void>;
  afterVaultVerify?: () => void | Promise<void>;
  onPlaintextForTests?: (value: Record<string, string>) => void;
}

interface VaultOptions {
  directory: string;
  provider: CredentialProvider;
  legacy?: LegacyCredentialSource;
  hooks?: VaultHooks;
}

interface VaultEnvelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

function unavailable(): CredentialVaultError {
  return new CredentialVaultError('secure_storage_unavailable', 'Secure OS credential storage is unavailable');
}

function unreadable(): CredentialVaultError {
  return new CredentialVaultError('stored_credentials_unreadable', 'Stored credentials could not be decrypted; encrypted data was left untouched');
}

function parseSecretMap(text: string): Record<string, string> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unreadable();
  for (const field of Object.values(value)) if (typeof field !== 'string') throw unreadable();
  return value as Record<string, string>;
}

function encrypt(masterKey: Buffer, values: Record<string, string>): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
  const envelope: VaultEnvelope = {
    version: VAULT_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}

function decrypt(masterKey: Buffer, bytes: Buffer): Record<string, string> {
  let envelope: VaultEnvelope;
  try {
    const raw = JSON.parse(bytes.toString('utf8')) as Partial<VaultEnvelope>;
    if (raw.version !== VAULT_VERSION || typeof raw.iv !== 'string' || typeof raw.tag !== 'string' || typeof raw.ciphertext !== 'string') {
      throw unreadable();
    }
    envelope = raw as VaultEnvelope;
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== 16) throw unreadable();
    const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return parseSecretMap(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  } catch (error) {
    if (error instanceof CredentialVaultError) throw error;
    throw unreadable();
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicWrite(file: string, bytes: Buffer): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(tmp, bytes, { mode: 0o600 });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export function createCredentialVault(options: VaultOptions): CredentialVault {
  const keyPath = path.join(options.directory, KEY_FILE);
  const vaultPath = path.join(options.directory, VAULT_FILE);
  let cache: Record<string, string> | null = null;
  let loadInFlight: Promise<Record<string, string> | null> | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();
  let readState: 'unknown' | 'ok' | 'provider_unavailable' | 'unreadable' = 'unknown';
  let loadGeneration = 0;
  let cachedMasterKey: Buffer | null = null;
  let reprotectPending = false;

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = mutationQueue.then(operation);
    mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  };

  async function providerReady(): Promise<boolean> {
    try {
      const available = (await options.provider.status()).available;
      if (!available) readState = 'provider_unavailable';
      return available;
    } catch {
      readState = 'provider_unavailable';
      return false;
    }
  }

  async function readExisting(): Promise<Record<string, string> | null> {
    const generation = loadGeneration;
    if (!(await providerReady())) return null;
    const [keyExists, vaultExists] = await Promise.all([exists(keyPath), exists(vaultPath)]);
    if (!keyExists && !vaultExists) {
      readState = 'ok';
      return {};
    }
    if (!keyExists || !vaultExists) {
      readState = 'unreadable';
      return null;
    }
    let masterKey: Buffer;
    try {
      const unprotected = await options.provider.unprotect(await fs.readFile(keyPath));
      if (generation !== loadGeneration) return cache ?? {};
      masterKey = unprotected.data;
      cachedMasterKey = Buffer.from(masterKey);
      if (unprotected.shouldReprotect) {
        try {
          await atomicWrite(keyPath, await options.provider.protect(masterKey));
          reprotectPending = false;
        } catch {
          // The old protected key already decrypted successfully, so rotation is best-effort.
          // Keep it authoritative and retry on the next process/read rather than hiding secrets.
          reprotectPending = true;
        }
      }
    } catch {
      if (generation !== loadGeneration) return cache ?? {};
      readState = 'provider_unavailable';
      return null;
    }
    try {
      const vaultBytes = await fs.readFile(vaultPath);
      if (masterKey.length !== KEY_BYTES) throw unreadable();
      const values = decrypt(masterKey, vaultBytes);
      if (generation !== loadGeneration) return cache ?? {};
      options.hooks?.onPlaintextForTests?.({ ...values });
      readState = 'ok';
      return values;
    } catch {
      if (generation !== loadGeneration) return cache ?? {};
      readState = 'unreadable';
      return null;
    }
  }

  async function writeSnapshot(values: Record<string, string>, existingMasterKey?: Buffer): Promise<void> {
    if (!(await providerReady())) throw unavailable();
    const hadKey = await exists(keyPath);
    const hadVault = await exists(vaultPath);
    let masterKey = existingMasterKey ?? cachedMasterKey ?? undefined;
    let protectedKey: Buffer | null = null;
    if (hadKey) {
      if (!masterKey) {
        try {
          masterKey = (await options.provider.unprotect(await fs.readFile(keyPath))).data;
          cachedMasterKey = Buffer.from(masterKey);
        } catch {
          throw unavailable();
        }
        if (masterKey.length !== KEY_BYTES) throw unreadable();
      }
    } else {
      masterKey ??= randomBytes(KEY_BYTES);
      cachedMasterKey = Buffer.from(masterKey);
      try {
        protectedKey = await options.provider.protect(masterKey);
      } catch {
        throw unavailable();
      }
    }

    if (protectedKey) await atomicWrite(keyPath, protectedKey);
    try {
      await options.hooks?.beforeVaultCommit?.();
      await atomicWrite(vaultPath, encrypt(masterKey, values));
    } catch (error) {
      if (!hadKey && !hadVault) await fs.rm(keyPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function tryMigration(): Promise<Record<string, string> | null> {
    if (!options.legacy) return {};
    if (!(await providerReady())) return null;
    const [keyExists, vaultExists] = await Promise.all([exists(keyPath), exists(vaultPath)]);
    if (keyExists || vaultExists) return null;
    let legacy: Record<string, string> | null;
    try {
      legacy = await options.legacy.read();
      if (legacy === null) return {};
      for (const field of Object.values(legacy)) if (typeof field !== 'string') return null;
    } catch {
      return null;
    }

    try {
      await writeSnapshot({ ...legacy });
      await options.hooks?.afterVaultCommit?.();
      await options.hooks?.beforeVaultVerify?.();
      const verified = await readExisting();
      if (!verified || JSON.stringify(verified) !== JSON.stringify(legacy)) throw unreadable();
      await options.hooks?.afterVaultVerify?.();
      await options.legacy.markMigrated();
      cache = verified;
      readState = 'ok';
      return verified;
    } catch {
      cache = null;
      await fs.rm(vaultPath, { force: true }).catch(() => undefined);
      await fs.rm(keyPath, { force: true }).catch(() => undefined);
      return null;
    }
  }

  async function load(): Promise<Record<string, string> | null> {
    if (cache) return cache;
    if (loadInFlight) return loadInFlight;
    const loadPromise = (async () => {
      const [keyExists, vaultExists] = await Promise.all([exists(keyPath), exists(vaultPath)]);
      const values = keyExists || vaultExists ? await readExisting() : await tryMigration();
      if (values !== null) cache = values;
      return values;
    })();
    loadInFlight = loadPromise;
    try {
      return await loadPromise;
    } finally {
      if (loadInFlight === loadPromise) loadInFlight = null;
    }
  }

  async function retryReprotectIfNeeded(): Promise<void> {
    if (!reprotectPending || !cachedMasterKey) return;
    try {
      if (!(await providerReady())) return;
      await atomicWrite(keyPath, await options.provider.protect(cachedMasterKey));
      reprotectPending = false;
      readState = 'ok';
    } catch {
      reprotectPending = true;
    }
  }

      return {
    async status() {
      const providerStatus = await options.provider.status().catch(() => ({ available: false as const, reason: 'provider_unavailable' as const }));
      if (!providerStatus.available) return { ...providerStatus, readable: false };
      const values = await load();
      if (values !== null) return { available: true, readable: true, reason: 'available' };
      if (readState === 'unreadable') {
        return { available: true, readable: false, reason: 'stored_credentials_unreadable' };
      }
      return { available: false, readable: false, reason: 'provider_unavailable' };
    },
    async get(key) {
      const alreadyLoaded = cache !== null;
      const values = await load();
      if (alreadyLoaded) await retryReprotectIfNeeded();
      const value = values?.[key];
      return value && value.length > 0 ? value : null;
    },
    set(key, value) {
      return enqueue(async () => {
        if (!(await providerReady())) throw unavailable();
        const current = await load();
        if (current === null) throw readState === 'unreadable' ? unreadable() : unavailable();
        const next = { ...current };
        const trimmed = value.trim();
        if (trimmed === '') delete next[key];
        else next[key] = trimmed;
        await writeSnapshot(next);
        cache = next;
        readState = 'ok';
      });
    },
    delete(key) {
      return this.set(key, '');
    },
    deleteAll() {
      return enqueue(async () => {
        loadGeneration += 1;
        cache = {};
        cachedMasterKey = null;
        reprotectPending = false;
        readState = 'ok';
        loadInFlight = null;
        await Promise.all([
          fs.rm(vaultPath, { force: true }),
          fs.rm(keyPath, { force: true })
        ]);
      });
    },
    archiveUnreadable() {
      return enqueue(async () => {
        if (readState !== 'unreadable') {
          throw new Error('Stored credentials are not unreadable; recovery was refused');
        }
        const stamp = Date.now();
        const backups: string[] = [];
        loadGeneration += 1;
        loadInFlight = null;
        for (const file of [vaultPath, keyPath]) {
          if (!(await exists(file))) continue;
          let backup = `${file}.unreadable-${stamp}.bak`;
          for (let suffix = 1; await exists(backup); suffix += 1) {
            backup = `${file}.unreadable-${stamp}-${suffix}.bak`;
          }
          await fs.rename(file, backup);
          backups.push(backup);
        }
        cache = {};
        cachedMasterKey = null;
        reprotectPending = false;
        readState = 'ok';
        return backups;
      });
    },
    resetCacheForTests() {
      loadGeneration += 1;
      cache = null;
      cachedMasterKey = null;
      reprotectPending = false;
      loadInFlight = null;
      readState = 'unknown';
    }
  };
}

export type { CredentialProvider } from './provider.js';
