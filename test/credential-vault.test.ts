import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCredentialVault, type CredentialProvider } from '../src/main/credentials/vault.js';
import { makeTempDir, removeTempDir } from './helpers.js';

class MemoryProvider implements CredentialProvider {
  available = true;
  failProtect = false;
  failUnprotect = false;
  protectCalls = 0;
  unprotectCalls = 0;

  async status() {
    return this.available
      ? { available: true as const, reason: 'available' as const }
      : { available: false as const, reason: 'provider_unavailable' as const };
  }

  async protect(data: Buffer): Promise<Buffer> {
    this.protectCalls += 1;
    if (!this.available || this.failProtect) throw new Error('provider unavailable');
    return Buffer.concat([Buffer.from('protected:'), data]);
  }

  async unprotect(data: Buffer): Promise<{ data: Buffer; shouldReprotect: boolean }> {
    this.unprotectCalls += 1;
    if (!this.available || this.failUnprotect) throw new Error('provider unavailable');
    const prefix = Buffer.from('protected:');
    if (!data.subarray(0, prefix.length).equals(prefix)) throw new Error('bad protected key');
    return { data: data.subarray(prefix.length), shouldReprotect: false };
  }
}

let dir: string;
let provider: MemoryProvider;

beforeEach(async () => {
  dir = await makeTempDir('clf-vault-');
  provider = new MemoryProvider();
});

afterEach(async () => {
  await removeTempDir(dir);
});

describe('CredentialVault', () => {
  it('serializes concurrent mutations and preserves unknown string fields', async () => {
    const vault = createCredentialVault({
      directory: dir,
      provider,
      legacy: {
        async read() { return { futureSecret: 'future-1' }; },
        async markMigrated() {}
      }
    });
    await vault.get('bridgeToken');
    await Promise.all([
      vault.set('bridgeToken', 'bridge-1'),
      vault.set('openaiApiKey', 'openai-1')
    ]);

    expect(await vault.get('bridgeToken')).toBe('bridge-1');
    expect(await vault.get('openaiApiKey')).toBe('openai-1');

    let migratedSnapshot: Record<string, string> | null = null;
    const reopened = createCredentialVault({
      directory: dir,
      provider,
      hooks: { onPlaintextForTests: (value) => { migratedSnapshot = value; } }
    });
    expect(await reopened.get('bridgeToken')).toBe('bridge-1');
    expect(migratedSnapshot).toMatchObject({ futureSecret: 'future-1' });
  });

  it('never creates plaintext credential files when the provider is unavailable', async () => {
    provider.available = false;
    const vault = createCredentialVault({ directory: dir, provider });

    await expect(vault.set('openaiApiKey', 'super-secret-value')).rejects.toMatchObject({
      code: 'secure_storage_unavailable'
    });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('keeps an existing encrypted vault authoritative across a transient unprotect failure', async () => {
    const first = createCredentialVault({ directory: dir, provider });
    await first.set('openaiApiKey', 'survives');
    const beforeVault = await fs.readFile(path.join(dir, 'credentials.vault'));
    const beforeKey = await fs.readFile(path.join(dir, 'credentials.key'));

    provider.failUnprotect = true;
    const unavailable = createCredentialVault({ directory: dir, provider });
    expect(await unavailable.get('openaiApiKey')).toBeNull();
    await expect(unavailable.set('bridgeToken', 'must-not-overwrite')).rejects.toMatchObject({
      code: 'secure_storage_unavailable'
    });
    expect(await fs.readFile(path.join(dir, 'credentials.vault'))).toEqual(beforeVault);
    expect(await fs.readFile(path.join(dir, 'credentials.key'))).toEqual(beforeKey);

    provider.failUnprotect = false;
    expect(await unavailable.get('openaiApiKey')).toBe('survives');
  });

  it('classifies authenticated vault corruption as unreadable and never overwrites it', async () => {
    const first = createCredentialVault({ directory: dir, provider });
    await first.set('openaiApiKey', 'must-survive-corruption');
    const vaultPath = path.join(dir, 'credentials.vault');
    const before = await fs.readFile(vaultPath);
    const tampered = Buffer.from(before);
    tampered[tampered.length - 4] = tampered[tampered.length - 4]! ^ 1;
    await fs.writeFile(vaultPath, tampered);

    const reopened = createCredentialVault({ directory: dir, provider });
    expect(await reopened.get('openaiApiKey')).toBeNull();
    expect(await reopened.status()).toMatchObject({ available: true, readable: false, reason: 'stored_credentials_unreadable' });
    await expect(reopened.set('bridgeToken', 'must-not-overwrite')).rejects.toMatchObject({
      code: 'stored_credentials_unreadable'
    });
    expect(await fs.readFile(vaultPath)).toEqual(tampered);
  });

  it('does not let an in-flight unprotect resurrect credentials after explicit deletion', async () => {
    const first = createCredentialVault({ directory: dir, provider });
    await first.set('openaiApiKey', 'old-secret');

    let started!: () => void;
    let release!: () => void;
    const unprotectStarted = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalUnprotect = provider.unprotect.bind(provider);
    provider.unprotect = async (data) => {
      started();
      await gate;
      return originalUnprotect(data);
    };

    const reopened = createCredentialVault({ directory: dir, provider });
    const staleRead = reopened.get('openaiApiKey');
    await unprotectStarted;
    await reopened.deleteAll();
    release();
    expect(await staleRead).toBeNull();

    await reopened.set('bridgeToken', 'new-secret');
    expect(await reopened.get('openaiApiKey')).toBeNull();
    expect(await reopened.get('bridgeToken')).toBe('new-secret');
  });

  it('archives an unreadable vault only after unreadability was actually observed', async () => {
    const first = createCredentialVault({ directory: dir, provider });
    await first.set('openaiApiKey', 'old-secret');
    const vaultPath = path.join(dir, 'credentials.vault');
    await fs.writeFile(vaultPath, Buffer.from('{"version":1,"broken":true}', 'utf8'));

    const reopened = createCredentialVault({ directory: dir, provider });
    await expect(reopened.archiveUnreadable()).rejects.toThrow(/not unreadable/i);
    expect(await reopened.get('openaiApiKey')).toBeNull();
    const backups = await reopened.archiveUnreadable();
    expect(backups).toHaveLength(2);
    for (const backup of backups) expect(path.basename(backup)).toMatch(/\.unreadable-.*\.bak$/);

    await reopened.set('openaiApiKey', 'fresh-secret');
    expect(await reopened.get('openaiApiKey')).toBe('fresh-secret');
  });

  it('migrates legacy plaintext only after the new vault is written and verified', async () => {
    const legacy = path.join(dir, 'secrets.bin');
    await fs.writeFile(legacy, Buffer.from('legacy-ciphertext'));
    const events: string[] = [];
    const vault = createCredentialVault({
      directory: dir,
      provider,
      legacy: {
        async read() {
          events.push('legacy-read');
          return { openaiApiKey: 'legacy-openai', futureSecret: 'future' };
        },
        async markMigrated() {
          events.push('legacy-marked');
        }
      },
      hooks: {
        afterVaultCommit: () => {
          events.push('vault-written');
        },
        afterVaultVerify: () => {
          events.push('vault-verified');
        }
      }
    });

    expect(await vault.get('openaiApiKey')).toBe('legacy-openai');
    expect(events).toEqual(['legacy-read', 'vault-written', 'vault-verified', 'legacy-marked']);
    expect(await fs.readFile(legacy)).toEqual(Buffer.from('legacy-ciphertext'));
  });

  it('never marks migration complete when commit or verification fails', async () => {
    const marked: string[] = [];
    provider.failProtect = true;
    const commitFailure = createCredentialVault({
      directory: dir,
      provider,
      legacy: {
        async read() { return { openaiApiKey: 'legacy' }; },
        async markMigrated() { marked.push('marked'); }
      }
    });
    await expect(commitFailure.get('openaiApiKey')).resolves.toBeNull();
    expect(marked).toEqual([]);

    provider.failProtect = false;
    const verifyFailure = createCredentialVault({
      directory: dir,
      provider,
      legacy: {
        async read() { return { openaiApiKey: 'legacy' }; },
        async markMigrated() { marked.push('marked'); }
      },
      hooks: { beforeVaultVerify: async () => { throw new Error('verification failed'); } }
    });
    await expect(verifyFailure.get('openaiApiKey')).resolves.toBeNull();
    expect(marked).toEqual([]);
  });
});

