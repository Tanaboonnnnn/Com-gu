import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLinuxCredentialProvider, type SecretToolAdapter } from '../src/main/credentials/linux-provider.js';
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

  it('does not activate Linux providers on another platform', async () => {
    const provider = createLinuxCredentialProvider({ platform: 'win32', scope: 'machine-e', env: {}, secretTool });
    expect(await provider.status()).toMatchObject({ available: false });
  });
});
