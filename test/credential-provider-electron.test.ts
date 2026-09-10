import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`v11${value}`, 'utf8')),
    decryptStringAsync: vi.fn(async (buffer: Buffer) => ({ result: buffer.subarray(3).toString('utf8'), shouldReEncrypt: false }))
  }
}));

const { safeStorage } = await import('electron');
const { createElectronCredentialProvider } = await import('../src/main/credentials/electron-provider.js');
const { resetSecureStorageProbeForTests } = await import('../src/main/secure-storage-probe.js');

describe('Electron credential provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSecureStorageProbeForTests();
    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(true);
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue('gnome_libsecret');
    vi.mocked(safeStorage.encryptStringAsync).mockImplementation(async (value) => Buffer.from(`v11${value}`, 'utf8'));
    vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async (buffer) => ({
      result: buffer.subarray(3).toString('utf8'),
      shouldReEncrypt: false
    }));
  });

  it('round trips only opaque master-key bytes through safeStorage', async () => {
    const provider = createElectronCredentialProvider('linux');
    const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
    const protectedKey = await provider.protect(key);
    expect(protectedKey.subarray(0, 3).toString('ascii')).toBe('v11');
    expect(await provider.unprotect(protectedKey)).toEqual({ data: key, shouldReprotect: false });
    const encryptedInputs = vi.mocked(safeStorage.encryptStringAsync).mock.calls.map(([value]) => value);
    expect(encryptedInputs).toContain(key.toString('base64'));
  });

  it('forwards the host key-rotation signal without exposing the master key to callers', async () => {
    vi.mocked(safeStorage.decryptStringAsync).mockResolvedValueOnce({
      result: Buffer.alloc(32, 7).toString('base64'),
      shouldReEncrypt: true
    });
    const provider = createElectronCredentialProvider('win32');
    expect(await provider.unprotect(Buffer.from('opaque'))).toEqual({
      data: Buffer.alloc(32, 7),
      shouldReprotect: true
    });
  });

  it('refuses Linux v10 output even when the selected backend label looks secure', async () => {
    vi.mocked(safeStorage.encryptStringAsync).mockResolvedValue(Buffer.from('v10insecure', 'ascii'));
    const provider = createElectronCredentialProvider('linux');
    expect(await provider.status()).toMatchObject({ available: false, reason: 'provider_unavailable' });
    await expect(provider.protect(Buffer.alloc(32))).rejects.toThrow(/secure credential storage/i);
  });

  it('reports unavailable without decrypting when async secure storage is unavailable', async () => {
    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(false);
    const provider = createElectronCredentialProvider('linux');
    expect(await provider.status()).toMatchObject({ available: false });
    await expect(provider.unprotect(Buffer.from('v11opaque'))).rejects.toThrow(/secure credential storage/i);
    expect(safeStorage.decryptStringAsync).not.toHaveBeenCalled();
  });
});

