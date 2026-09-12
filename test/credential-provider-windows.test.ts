import { describe, expect, it } from 'vitest';
import { createWindowsCredentialProvider } from '../src/main/credentials/windows-provider.js';

describe('Windows CLI credential provider', () => {
  // Hosted CI runs under a service account where CurrentUser DPAPI can be unavailable even
  // though the Windows API itself exists. Keep the real-user integration local; CI still covers
  // the exact provider contract through the injected CurrentUser runner below.
  if (process.platform === 'win32' && !process.env.CI) {
    it('round trips through the real CurrentUser DPAPI helper on Windows', async () => {
      const provider = createWindowsCredentialProvider();
      const key = Buffer.from(Array.from({ length: 32 }, (_, index) => (index * 7) % 256));
      const protectedKey = await provider.protect(key);
      expect(protectedKey).not.toEqual(key);
      expect(await provider.unprotect(protectedKey)).toEqual({ data: key, shouldReprotect: false });
    }, 20_000);
  }

  it('uses CurrentUser DPAPI semantics through the injected runner', async () => {
    const calls: Array<{ mode: string; data: Buffer }> = [];
    const provider = createWindowsCredentialProvider({
      platform: 'win32',
      run: async (mode, data) => {
        calls.push({ mode, data: Buffer.from(data) });
        return mode === 'protect' ? Buffer.concat([Buffer.from('dpapi:'), data]) : data.subarray(6);
      }
    });
    const key = Buffer.alloc(32, 9);
    const protectedKey = await provider.protect(key);
    expect(await provider.unprotect(protectedKey)).toEqual({ data: key, shouldReprotect: false });
    expect(calls.map((call) => call.mode)).toEqual(['protect', 'unprotect']);
    expect(calls[0]!.data).toEqual(key);
  });

  it('adopts an Electron safeStorage master key payload and requests one-time resealing', async () => {
    const key = Buffer.alloc(32, 11);
    const provider = createWindowsCredentialProvider({
      platform: 'win32',
      run: async (mode, data) => mode === 'protect' ? data : Buffer.from(key.toString('base64'), 'utf8')
    });

    expect(await provider.unprotect(Buffer.from('legacy-electron-dpapi'))).toEqual({
      data: key,
      shouldReprotect: true
    });
  });

  it('fails closed off Windows rather than emulating DPAPI', async () => {
    const provider = createWindowsCredentialProvider({ platform: 'linux', run: async () => Buffer.alloc(0) });
    expect(await provider.status()).toMatchObject({ available: false, reason: 'provider_unavailable' });
    await expect(provider.protect(Buffer.alloc(32))).rejects.toThrow(/DPAPI|Windows/i);
  });

  it('classifies helper failure without echoing protected data', async () => {
    const secret = Buffer.from('master-key-that-must-not-be-echoed');
    const provider = createWindowsCredentialProvider({
      platform: 'win32',
      run: async () => { throw new Error(`helper exploded with ${secret.toString('utf8')}`); }
    });
    await expect(provider.protect(secret)).rejects.toThrow(/^Windows credential protection failed$/);
  });
});
