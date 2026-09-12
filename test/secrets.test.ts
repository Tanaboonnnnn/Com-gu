/**
 * OS-backed secret store semantics that matter for release safety.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value, 'utf8')),
    decryptStringAsync: vi.fn(async (buffer: Buffer) => ({ result: buffer.toString('utf8'), shouldReEncrypt: false }))
  }
}));

const {
  archiveUnreadableSecrets,
  deleteAllSecrets,
  getSecret,
  initSecretsPath,
  resetSecretsCacheForTests,
  secureStorageCiphertextIsProtected,
  secureStorageStatus,
  setSecret,
  storedCredentialsUnreadable,
  SecretStorageError
} = await import('../src/main/secrets.js');
const { safeStorage } = await import('electron');
const { probeSecureStorage, resetSecureStorageProbeForTests } = await import('../src/main/secure-storage-probe.js');
const { formatLogAsJson, getLog, logInfo } = await import('../src/main/logger.js');
const { makeTempDir, removeTempDir } = await import('./helpers.js');

let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await makeTempDir('clf-secrets-');
  initSecretsPath(dir);
  resetSecretsCacheForTests();
  resetSecureStorageProbeForTests();
  vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(true);
  vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue('gnome_libsecret');
  vi.mocked(safeStorage.encryptStringAsync).mockImplementation(async (value) => Buffer.from(value, 'utf8'));
  vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async (buffer) => ({
    result: buffer.toString('utf8'),
    shouldReEncrypt: false
  }));
});

afterEach(async () => {
  await removeTempDir(dir);
});

describe('secret store', () => {
  it('reports Linux v10 provider evidence without exposing ciphertext', async () => {
    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(true);
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue('gnome_libsecret');
    vi.mocked(safeStorage.encryptStringAsync).mockResolvedValueOnce(Buffer.from('v10opaque', 'ascii'));

    expect(await probeSecureStorage('linux')).toEqual({
      platform: 'linux',
      asyncAvailable: true,
      selectedBackend: 'gnome_libsecret',
      probeFormat: 'v10',
      protected: false,
      error: null
    });
  });

  it('reports Linux v11 provider evidence as protected', async () => {
    vi.mocked(safeStorage.encryptStringAsync).mockResolvedValueOnce(Buffer.from('v11opaque', 'ascii'));
    expect(await probeSecureStorage('linux')).toMatchObject({
      asyncAvailable: true,
      selectedBackend: 'gnome_libsecret',
      probeFormat: 'v11',
      protected: true,
      error: null
    });
  });

  it('refuses Linux v10 hard-coded-key ciphertext instead of trusting the legacy backend label', async () => {
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue('basic_text');
    vi.mocked(safeStorage.encryptStringAsync).mockResolvedValueOnce(Buffer.from('v10fallback-ciphertext', 'ascii'));
    expect(await secureStorageStatus('linux')).toEqual({
      available: false,
      reason: 'insecure_linux_fallback',
      detail: expect.stringMatching(/hard-coded-key|fallback/i)
    });
    expect(safeStorage.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(1);
  });

  it('accepts a secure async Linux provider even when the legacy backend label is basic_text', async () => {
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue('basic_text');
    vi.mocked(safeStorage.encryptStringAsync).mockResolvedValueOnce(Buffer.from('v11protected-ciphertext', 'ascii'));

    expect(await secureStorageStatus('linux')).toEqual({ available: true, reason: 'available', detail: null });
  });

  it('refuses the async Linux v10 fallback even when the selected backend label looks secure', async () => {
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue('gnome_libsecret');
    vi.mocked(safeStorage.encryptStringAsync).mockResolvedValueOnce(Buffer.from('v10fallback-ciphertext', 'ascii'));

    expect(await secureStorageStatus('linux')).toEqual({
      available: false,
      reason: 'insecure_linux_fallback',
      detail: expect.stringMatching(/hard-coded-key|fallback/i)
    });
    expect(safeStorage.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(1);
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledWith('chat-on-steroids-safe-storage-probe');
  });

  it('classifies only Linux v10 ciphertext as the insecure hard-coded-key provider', () => {
    const v10 = Buffer.from('v10ciphertext', 'ascii');
    const v11 = Buffer.from('v11ciphertext', 'ascii');
    expect(secureStorageCiphertextIsProtected(v10, 'linux')).toBe(false);
    expect(secureStorageCiphertextIsProtected(v11, 'linux')).toBe(true);
    // v10 is a platform-specific on-disk format distinction; do not reinterpret bytes from
    // DPAPI/Keychain hosts as Linux basic_text merely because their prefix happens to match.
    expect(secureStorageCiphertextIsProtected(v10, 'win32')).toBe(true);
    expect(secureStorageCiphertextIsProtected(v10, 'darwin')).toBe(true);
  });

  it('transactionally migrates the existing Electron secret blob into the frontend-independent vault', async () => {
    const legacy = path.join(dir, 'secrets.bin');
    await fs.writeFile(
      legacy,
      Buffer.from(JSON.stringify({ openaiApiKey: 'legacy-openai', bridgeToken: 'legacy-bridge', futureSecret: 'keep-me' }), 'utf8')
    );

    expect(await getSecret('openaiApiKey')).toBe('legacy-openai');
    expect(await getSecret('bridgeToken')).toBe('legacy-bridge');
    expect(await fs.stat(path.join(dir, 'credentials.vault'))).toBeTruthy();
    expect(await fs.stat(path.join(dir, 'credentials.key'))).toBeTruthy();
    expect(await fs.readFile(path.join(dir, 'credentials.migrated'), 'utf8')).toContain('credential-vault-v1');
    await expect(fs.access(legacy)).rejects.toBeDefined();
    const migratedBackups = (await fs.readdir(dir)).filter((name) => name.startsWith('secrets.bin.migrated-'));
    expect(migratedBackups).toHaveLength(1);

    const vaultBytes = await fs.readFile(path.join(dir, 'credentials.vault'), 'utf8');
    expect(vaultBytes).not.toContain('legacy-openai');
    expect(vaultBytes).not.toContain('legacy-bridge');

    await setSecret('openRouterApiKey', 'new-secret');
    resetSecretsCacheForTests();
    expect(await getSecret('openaiApiKey')).toBe('legacy-openai');
    expect(await getSecret('openRouterApiKey')).toBe('new-secret');
  });

  it('accepts a non-Electron credential provider without touching Electron safeStorage', async () => {
    const provider = {
      async status() {
        return { available: true as const, reason: 'available' as const, detail: 'test-native' };
      },
      async protect(data: Buffer) {
        return Buffer.concat([Buffer.from('native:'), data]);
      },
      async unprotect(data: Buffer) {
        return { data: data.subarray(Buffer.byteLength('native:')), shouldReprotect: false };
      }
    };
    vi.mocked(safeStorage.encryptStringAsync).mockClear();
    vi.mocked(safeStorage.decryptStringAsync).mockClear();
    initSecretsPath(dir, { provider });

    await setSecret('openaiApiKey', 'native-provider-secret');
    resetSecretsCacheForTests();
    expect(await getSecret('openaiApiKey')).toBe('native-provider-secret');
    expect(safeStorage.encryptStringAsync).not.toHaveBeenCalled();
    expect(safeStorage.decryptStringAsync).not.toHaveBeenCalled();
  });

  it('serializes concurrent writes so one credential cannot erase another', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-token-456'),
      setSecret('openaiApiKey', 'sk-openai-789')
    ]);

    expect(await getSecret('bridgeToken')).toBe('bridge-token-456');
    expect(await getSecret('openaiApiKey')).toBe('sk-openai-789');

    // Force a disk read, not the in-process cache.
    resetSecretsCacheForTests();
    expect(await getSecret('bridgeToken')).toBe('bridge-token-456');
    expect(await getSecret('openaiApiKey')).toBe('sk-openai-789');
    expect(await fs.stat(path.join(dir, 'credentials.vault'))).toBeTruthy();
    expect(await fs.stat(path.join(dir, 'credentials.key'))).toBeTruthy();
    await expect(fs.access(path.join(dir, 'secrets.bin'))).rejects.toBeDefined();
  });

  it('single-flights an async cache miss so a late read cannot publish stale credentials after a write', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-before-load-race'),
      setSecret('openaiApiKey', 'sk-before-load-race')
    ]);
    resetSecretsCacheForTests();

    let releaseDecrypt: () => void = () => {};
    let markDecryptStarted: () => void = () => {};
    const decryptStarted = new Promise<void>((resolve) => {
      markDecryptStarted = resolve;
    });
    const decryptGate = new Promise<void>((resolve) => {
      releaseDecrypt = resolve;
    });
    vi.mocked(safeStorage.decryptStringAsync).mockImplementationOnce(async (buffer) => {
      markDecryptStarted();
      await decryptGate;
      return { result: buffer.toString('utf8'), shouldReEncrypt: false };
    });

    const read = getSecret('bridgeToken');
    await decryptStarted;
    const write = setSecret('openRouterApiKey', 'or-written-during-load');
    // Give the mutation a chance to reach readAll(). It must join the existing load instead of
    // starting a second decrypt of the same old ciphertext.
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseDecrypt();

    expect(await read).toBe('bridge-before-load-race');
    await write;
    expect(safeStorage.decryptStringAsync).toHaveBeenCalledTimes(1);

    // A second mutation is the destructive edge of the old race: if the late read had replaced
    // cache with its stale snapshot, this write would silently drop openRouterApiKey.
    await setSecret('openaiApiKey', 'sk-after-load-race');
    resetSecretsCacheForTests();
    expect(await getSecret('bridgeToken')).toBe('bridge-before-load-race');
    expect(await getSecret('openaiApiKey')).toBe('sk-after-load-race');
    expect(await getSecret('openRouterApiKey')).toBe('or-written-during-load');
  });

  it('does not turn a transient unavailable keyring into an empty authoritative secret store', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-token-survives-keyring-lock'),
      setSecret('openaiApiKey', 'sk-survives-keyring-lock')
    ]);
    resetSecretsCacheForTests();

    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(false);
    vi.mocked(safeStorage.decryptStringAsync).mockClear();
    expect(await getSecret('bridgeToken')).toBeNull();
    expect(safeStorage.decryptStringAsync).not.toHaveBeenCalled();
    await expect(setSecret('openRouterApiKey', 'must-not-overwrite')).rejects.toThrow(/credential storage is unavailable/i);

    // Unlocking the host store later in the same process must retry disk, not keep the
    // temporary empty view cached and risk overwriting the real encrypted blob on the next save.
    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(true);
    expect(await getSecret('bridgeToken')).toBe('bridge-token-survives-keyring-lock');
    expect(await getSecret('openaiApiKey')).toBe('sk-survives-keyring-lock');
  });

  it('does not let an in-flight decrypt resurrect credentials after the encrypted store is deleted', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-token-before-delete-race'),
      setSecret('openaiApiKey', 'sk-before-delete-race')
    ]);
    resetSecretsCacheForTests();

    let releaseDecrypt: () => void = () => {};
    let markDecryptStarted: () => void = () => {};
    const decryptStarted = new Promise<void>((resolve) => {
      markDecryptStarted = resolve;
    });
    const decryptGate = new Promise<void>((resolve) => {
      releaseDecrypt = resolve;
    });
    vi.mocked(safeStorage.decryptStringAsync).mockImplementationOnce(async (buffer) => {
      markDecryptStarted();
      await decryptGate;
      return { result: buffer.toString('utf8'), shouldReEncrypt: false };
    });

    const staleRead = getSecret('bridgeToken');
    await decryptStarted;
    await deleteAllSecrets();
    await expect(fs.access(path.join(dir, 'credentials.vault'))).rejects.toBeDefined();
    await expect(fs.access(path.join(dir, 'credentials.key'))).rejects.toBeDefined();

    releaseDecrypt();
    expect(await staleRead).toBeNull();

    // The destructive edge: a later save must compose from the deleted empty store, not from
    // plaintext the old decrypt held before deletion, otherwise it silently recreates old keys.
    await setSecret('openRouterApiKey', 'or-after-delete-race');
    resetSecretsCacheForTests();
    expect(await getSecret('bridgeToken')).toBeNull();
    expect(await getSecret('openaiApiKey')).toBeNull();
    expect(await getSecret('openRouterApiKey')).toBe('or-after-delete-race');
  });

  it('does not overwrite secrets when storage disappears between availability check and decrypt', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-token-survives-decrypt-race'),
      setSecret('openaiApiKey', 'sk-survives-decrypt-race')
    ]);
    resetSecretsCacheForTests();

    vi.mocked(safeStorage.decryptStringAsync).mockImplementationOnce(async () => {
      // Reproduce the host-only race: safeStorage was available when the read started,
      // then Keychain/Secret Service became unavailable before decryptString completed.
      vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(false);
      throw new Error('credential backend became unavailable');
    });
    await expect(setSecret('openRouterApiKey', 'must-not-replace-existing-blob')).rejects.toThrow(
      /credential storage is unavailable/i
    );

    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(true);
    expect(await getSecret('bridgeToken')).toBe('bridge-token-survives-decrypt-race');
    expect(await getSecret('openaiApiKey')).toBe('sk-survives-decrypt-race');
    expect(await getSecret('openRouterApiKey')).toBeNull();
  });

  it('treats any async decrypt rejection as non-authoritative even if availability still reports true', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-token-survives-ambiguous-decrypt-error'),
      setSecret('openaiApiKey', 'sk-survives-ambiguous-decrypt-error')
    ]);
    const file = path.join(dir, 'credentials.key');
    const before = await fs.readFile(file);
    resetSecretsCacheForTests();
    vi.mocked(safeStorage.decryptStringAsync).mockRejectedValue(new Error('provider temporarily unavailable'));

    // Electron 43.4 typings do not expose the docs' temporary-unavailability marker, so a
    // rejected decrypt must never be converted into an empty authoritative store solely because
    // isAsyncEncryptionAvailable() still says that the provider exists.
    expect(await getSecret('bridgeToken')).toBeNull();
    const failedWrite = setSecret('openRouterApiKey', 'must-not-replace-ambiguous-blob');
    await expect(failedWrite).rejects.toBeInstanceOf(SecretStorageError);
    await expect(failedWrite).rejects.toMatchObject({ code: 'secure_storage_unavailable' });
    expect(await fs.readFile(file)).toEqual(before);

    vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async (buffer) => ({
      result: buffer.toString('utf8'),
      shouldReEncrypt: false
    }));
    expect(await getSecret('bridgeToken')).toBe('bridge-token-survives-ambiguous-decrypt-error');
    expect(await getSecret('openaiApiKey')).toBe('sk-survives-ambiguous-decrypt-error');
  });

  it('does not claim an app-identity decrypt rejection is confirmed unreadable without stronger evidence', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-token-from-old-app-identity'),
      setSecret('openaiApiKey', 'sk-from-old-app-identity')
    ]);
    const file = path.join(dir, 'credentials.key');
    const before = await fs.readFile(file);
    resetSecretsCacheForTests();
    vi.mocked(safeStorage.decryptStringAsync).mockRejectedValueOnce(new Error('key belongs to previous app identity'));

    expect(await getSecret('openaiApiKey')).toBeNull();
    expect(storedCredentialsUnreadable()).toBe(false);
    await expect(archiveUnreadableSecrets()).rejects.toThrow(/not unreadable/i);
    expect(await fs.readFile(file)).toEqual(before);

    vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async (buffer) => ({
      result: buffer.toString('utf8'),
      shouldReEncrypt: false
    }));
    expect(await getSecret('openaiApiKey')).toBe('sk-from-old-app-identity');
  });

  it('keeps an ambiguous decrypt rejection retryable instead of claiming permanent unreadability', async () => {
    await setSecret('openaiApiKey', 'sk-retryable');
    resetSecretsCacheForTests();
    vi.mocked(safeStorage.decryptStringAsync).mockRejectedValueOnce(new Error('provider temporarily unavailable'));

    expect(await getSecret('openaiApiKey')).toBeNull();
    expect(storedCredentialsUnreadable()).toBe(false);
    await expect(archiveUnreadableSecrets()).rejects.toThrow(/not unreadable/i);

    vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async (buffer) => ({
      result: buffer.toString('utf8'),
      shouldReEncrypt: false
    }));
    expect(await getSecret('openaiApiKey')).toBe('sk-retryable');
  });

  it('refuses credential-store recovery unless an unreadable encrypted blob was actually observed', async () => {
    await setSecret('openaiApiKey', 'sk-readable');
    await expect(archiveUnreadableSecrets()).rejects.toThrow(/not unreadable/i);
    expect(await getSecret('openaiApiKey')).toBe('sk-readable');
  });

  it('preserves ciphertext when decrypt succeeds but the stored secret map is malformed', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-token-before-malformed-store'),
      setSecret('openaiApiKey', 'sk-before-malformed-store')
    ]);
    const file = path.join(dir, 'credentials.vault');
    // The master key still opens, but the authenticated vault envelope itself is malformed.
    // That is strong unreadable evidence and must never be replaced by a partial fresh map.
    await fs.writeFile(file, Buffer.from(JSON.stringify({ version: 1, broken: true }), 'utf8'));
    resetSecretsCacheForTests();
    const before = await fs.readFile(file);

    expect(await getSecret('bridgeToken')).toBeNull();
    const malformedWrite = setSecret('openRouterApiKey', 'must-not-replace-malformed-blob');
    await expect(malformedWrite).rejects.toBeInstanceOf(SecretStorageError);
    await expect(malformedWrite).rejects.toMatchObject({ code: 'stored_credentials_unreadable' });
    expect(await fs.readFile(file)).toEqual(before);
  });

  it('re-encrypts a successfully decrypted blob when Electron reports key rotation', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-token-rotated'),
      setSecret('openaiApiKey', 'sk-rotated')
    ]);
    resetSecretsCacheForTests();
    vi.mocked(safeStorage.encryptStringAsync).mockClear();
    vi.mocked(safeStorage.decryptStringAsync).mockImplementationOnce(async (buffer) => ({
      result: buffer.toString('utf8'),
      shouldReEncrypt: true
    }));

    expect(await getSecret('bridgeToken')).toBe('bridge-token-rotated');
    // Linux proves the selected async provider is not Chromium's hard-coded-key fallback by
    // encrypting a harmless probe before each real write. The host provider now reseals only
    // the random master key; credential names/values never cross the provider seam.
    const reseals = vi.mocked(safeStorage.encryptStringAsync).mock.calls
      .map(([value]) => value)
      .filter((value) => value !== 'chat-on-steroids-safe-storage-probe');
    expect(reseals).toHaveLength(1);
    expect(Buffer.from(reseals[0]!, 'base64')).toHaveLength(32);
    expect(reseals[0]).not.toContain('bridge-token-rotated');
    expect(reseals[0]).not.toContain('sk-rotated');

    resetSecretsCacheForTests();
    expect(await getSecret('openaiApiKey')).toBe('sk-rotated');
  });

  it('keeps the old ciphertext and readable cache when key-rotation reseal is temporarily unavailable', async () => {
    await Promise.all([
      setSecret('bridgeToken', 'bridge-token-before-failed-rotation'),
      setSecret('openaiApiKey', 'sk-before-failed-rotation')
    ]);
    const file = path.join(dir, 'credentials.key');
    const before = await fs.readFile(file);
    resetSecretsCacheForTests();
    vi.mocked(safeStorage.decryptStringAsync).mockImplementationOnce(async (buffer) => ({
      result: buffer.toString('utf8'),
      shouldReEncrypt: true
    }));
    let failNextSecretReseal = true;
    vi.mocked(safeStorage.encryptStringAsync).mockImplementation(async (value) => {
      // Linux performs this non-secret provider probe before the actual reseal. The failure
      // under test is the current key becoming unavailable for the credential blob itself.
      if (value === 'chat-on-steroids-safe-storage-probe') return Buffer.from(value, 'utf8');
      if (failNextSecretReseal) {
        failNextSecretReseal = false;
        throw new Error('new key temporarily unavailable');
      }
      return Buffer.from(value, 'utf8');
    });

    // The read already succeeded, so failed best-effort resealing must not hide the credential.
    expect(await getSecret('bridgeToken')).toBe('bridge-token-before-failed-rotation');
    expect(await fs.readFile(file)).toEqual(before);

    // A later read in the same process retries the pending rotation and keeps all fields.
    expect(await getSecret('openaiApiKey')).toBe('sk-before-failed-rotation');
    resetSecretsCacheForTests();
    expect(await getSecret('bridgeToken')).toBe('bridge-token-before-failed-rotation');
    expect(await getSecret('openaiApiKey')).toBe('sk-before-failed-rotation');
  });

  it('does not leak a credential through the diagnostics renderer/export path', () => {
    // There is no registry of live secrets to consult any more — an agent is the chat it
    // runs in, and nothing is minted for it — so the backstop is shape alone: a long opaque
    // run of token characters is masked wherever it appears.
    const secret = 'bridge-token-abcdefghijklmnopqrstuvwxyz012345';
    logInfo(`tunnel opened with ${secret} while bootstrapping`);

    const latest = getLog().at(-1)!;
    expect(latest.message).not.toContain(secret);
    expect(latest.message).toContain('***');
    expect(formatLogAsJson()).not.toContain(secret);
  });
});
