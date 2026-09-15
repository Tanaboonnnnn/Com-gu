import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapLinuxFallbackKey,
  createLinuxCredentialProvider,
  LINUX_FALLBACK_KEY_FILE,
  type SecretToolAdapter
} from '../src/main/credentials/linux-provider.js';
import { makeTempDir, removeTempDir } from './helpers.js';

class FakeSecretTool implements SecretToolAdapter {
  available = false;
  values = new Map<string, Buffer>();
  async status() { return this.available; }
  async store(scope: string, value: Buffer) { this.values.set(scope, Buffer.from(value)); }
  async lookup(scope: string) { return this.values.get(scope) ?? null; }
}

let dir: string;
let secretTool: FakeSecretTool;

beforeEach(async () => {
  dir = await makeTempDir('clf-linux-provider-');
  secretTool = new FakeSecretTool();
});

afterEach(async () => removeTempDir(dir));

describe('Linux CLI credential provider', () => {
  it('uses a systemd credential wrapping key without writing plaintext configuration', async () => {
    const credentialsDir = path.join(dir, 'credentials');
    await fs.mkdir(credentialsDir);
    await fs.writeFile(path.join(credentialsDir, 'comgu-vault-key'), Buffer.alloc(32, 3).toString('base64'));
    const provider = createLinuxCredentialProvider({
      platform: 'linux',
      scope: 'machine-a',
      env: { CREDENTIALS_DIRECTORY: credentialsDir },
      secretTool
    });
    expect(await provider.status()).toMatchObject({ available: true, detail: 'systemd-credential' });
    const key = Buffer.alloc(32, 4);
    const wrapped = await provider.protect(key);
    expect(wrapped.toString('utf8')).not.toContain(key.toString('base64'));
    expect(await provider.unprotect(wrapped)).toEqual({ data: key, shouldReprotect: false });
    expect(await fs.readdir(dir)).toEqual(['credentials']);
  });

  it('supports a process-local injected wrapping key and never manufactures an env file', async () => {
    const provider = createLinuxCredentialProvider({
      platform: 'linux',
      scope: 'machine-b',
      env: { COMGU_CREDENTIAL_KEY: Buffer.alloc(32, 5).toString('base64') },
      secretTool
    });
    expect(await provider.status()).toMatchObject({ available: true, detail: 'environment' });
    const key = Buffer.alloc(32, 6);
    const wrapped = await provider.protect(key);
    expect(await provider.unprotect(wrapped)).toEqual({ data: key, shouldReprotect: false });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('uses Secret Service when no injected/systemd key exists', async () => {
    secretTool.available = true;
    const provider = createLinuxCredentialProvider({
      platform: 'linux',
      scope: 'machine-c',
      env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
      secretTool
    });
    expect(await provider.status()).toMatchObject({ available: true, detail: 'secret-service' });
    const key = Buffer.alloc(32, 7);
    const reference = await provider.protect(key);
    expect(reference.toString('utf8')).toBe('secret-service:v1:machine-c');
    expect(await provider.unprotect(reference)).toEqual({ data: key, shouldReprotect: false });
  });

  it('refuses persistence when no secure Linux source is available', async () => {
    const provider = createLinuxCredentialProvider({ platform: 'linux', scope: 'machine-d', env: {}, secretTool });
    expect(await provider.status()).toMatchObject({ available: false, reason: 'provider_unavailable' });
    await expect(provider.protect(Buffer.alloc(32))).rejects.toThrow(/secure Linux credential source/i);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it.runIf(process.platform === 'linux')('bootstraps a private profile fallback that survives a fresh provider', async () => {
    const fallbackKeyPath = path.join(dir, LINUX_FALLBACK_KEY_FILE);
    await bootstrapLinuxFallbackKey(dir);
    const stat = await fs.stat(fallbackKeyPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o077).toBe(0);
    expect(Buffer.from((await fs.readFile(fallbackKeyPath, 'utf8')).trim(), 'base64')).toHaveLength(32);

    const first = createLinuxCredentialProvider({ platform: 'linux', scope: 'machine-f', env: {}, secretTool, fallbackKeyPath });
    expect(await first.status()).toMatchObject({ available: true, detail: 'profile-fallback' });
    const opaque = await first.protect(Buffer.alloc(32, 9));
    const fresh = createLinuxCredentialProvider({ platform: 'linux', scope: 'machine-f', env: {}, secretTool, fallbackKeyPath });
    expect(await fresh.unprotect(opaque)).toEqual({ data: Buffer.alloc(32, 9), shouldReprotect: false });
  });

  it.runIf(process.platform === 'linux')('never replaces an existing fallback during concurrent bootstrap', async () => {
    const fallbackKeyPath = path.join(dir, LINUX_FALLBACK_KEY_FILE);
    await Promise.all(Array.from({ length: 8 }, () => bootstrapLinuxFallbackKey(dir)));
    const first = await fs.readFile(fallbackKeyPath, 'utf8');
    await bootstrapLinuxFallbackKey(dir);
    expect(await fs.readFile(fallbackKeyPath, 'utf8')).toBe(first);
  });

  it.runIf(process.platform === 'linux')('fails closed on a group-readable fallback instead of overwriting it', async () => {
    const fallbackKeyPath = path.join(dir, LINUX_FALLBACK_KEY_FILE);
    const original = `${Buffer.alloc(32, 10).toString('base64')}\n`;
    await fs.writeFile(fallbackKeyPath, original, { mode: 0o644 });
    await fs.chmod(fallbackKeyPath, 0o644);
    const provider = createLinuxCredentialProvider({ platform: 'linux', scope: 'machine-g', env: {}, secretTool, fallbackKeyPath });
    expect(await provider.status()).toMatchObject({ available: false, reason: 'provider_unavailable' });
    await expect(bootstrapLinuxFallbackKey(dir)).rejects.toThrow(/credential|permission|fallback/i);
    expect(await fs.readFile(fallbackKeyPath, 'utf8')).toBe(original);
  });

  it('fails closed on malformed fallback material', async () => {
    const fallbackKeyPath = path.join(dir, LINUX_FALLBACK_KEY_FILE);
    await fs.writeFile(fallbackKeyPath, 'not-a-32-byte-key\n', { mode: 0o600 });
    const provider = createLinuxCredentialProvider({ platform: 'linux', scope: 'machine-h', env: {}, secretTool, fallbackKeyPath });
    expect(await provider.status()).toMatchObject({ available: false, reason: 'provider_unavailable' });
  });

  it('keeps environment and Secret Service ahead of the profile fallback', async () => {
    const fallbackKeyPath = path.join(dir, LINUX_FALLBACK_KEY_FILE);
    await fs.writeFile(fallbackKeyPath, `${Buffer.alloc(32, 11).toString('base64')}\n`, { mode: 0o600 });
    const envProvider = createLinuxCredentialProvider({
      platform: 'linux', scope: 'machine-i', env: { COMGU_CREDENTIAL_KEY: Buffer.alloc(32, 12).toString('base64') }, secretTool, fallbackKeyPath
    });
    expect(await envProvider.status()).toMatchObject({ available: true, detail: 'environment' });
    secretTool.available = true;
    const secretProvider = createLinuxCredentialProvider({
      platform: 'linux', scope: 'machine-i', env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' }, secretTool, fallbackKeyPath
    });
    expect(await secretProvider.status()).toMatchObject({ available: true, detail: 'secret-service' });
  });

  it('does not activate Linux providers on another platform', async () => {
    const provider = createLinuxCredentialProvider({ platform: 'win32', scope: 'machine-e', env: {}, secretTool });
    expect(await provider.status()).toMatchObject({ available: false });
  });
});
