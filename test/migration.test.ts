import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyUserData, resolveCompatibleUserDataPath } from '../src/main/migration.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let root = '';

afterEach(async () => {
  if (root) await removeTempDir(root);
  root = '';
});

describe('ComGu user-data migration', () => {
  it('selects compatible userData before Electron establishes the single-instance/runtime context', () => {
    const main = readFileSync(path.join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8');
    const setPath = main.indexOf("app.setPath('userData', compatibleUserData)");
    const singleInstance = main.indexOf('app.requestSingleInstanceLock()');
    const ready = main.indexOf('app.whenReady()');
    expect(setPath).toBeGreaterThan(-1);
    expect(setPath).toBeLessThan(singleInstance);
    expect(setPath).toBeLessThan(ready);
  });

  it('keeps upgraded users on the legacy userData directory so safeStorage key material stays paired with secrets.bin', async () => {
    root = await makeTempDir('comgu-userdata-');
    const legacy = path.join(root, 'chat-on-steroids');
    const current = path.join(root, 'ComGu');
    await fs.mkdir(legacy, { recursive: true });
    await fs.mkdir(current, { recursive: true });
    await fs.writeFile(path.join(legacy, 'Local State'), '{"os_crypt":{"encrypted_key":"legacy-key"}}', 'utf8');
    await fs.writeFile(path.join(legacy, 'secrets.bin'), Buffer.from([1,2,3]));
    await fs.writeFile(path.join(current, 'Local State'), '{"os_crypt":{"encrypted_key":"wrong-new-key"}}', 'utf8');

    expect(resolveCompatibleUserDataPath({ appDataDir: root, defaultUserDataDir: current })).toBe(legacy);
  });

  it('ignores an empty leftover legacy directory', async () => {
    root = await makeTempDir('comgu-userdata-');
    const legacy = path.join(root, 'chat-on-steroids');
    const current = path.join(root, 'ComGu');
    await fs.mkdir(legacy, { recursive: true });
    await fs.mkdir(current, { recursive: true });
    expect(resolveCompatibleUserDataPath({ appDataDir: root, defaultUserDataDir: current })).toBe(current);
  });

  it('uses the ComGu userData directory for a clean install with no legacy data', async () => {
    root = await makeTempDir('comgu-userdata-');
    const current = path.join(root, 'ComGu');
    await fs.mkdir(current, { recursive: true });
    expect(resolveCompatibleUserDataPath({ appDataDir: root, defaultUserDataDir: current })).toBe(current);
  });

  it('copies legacy config and ciphertext first, leaves legacy data intact, and is idempotent', async () => {
    root = await makeTempDir('comgu-migration-');
    const legacy = path.join(root, 'chat-on-steroids');
    const current = path.join(root, 'comgu');
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'config.json'), '{"legacy":true}', 'utf8');
    await fs.writeFile(path.join(legacy, 'secrets.bin'), Buffer.from([0, 1, 2, 3, 255]));

    const first = await migrateLegacyUserData({ legacyDir: legacy, destinationDir: current });
    expect(first).toMatchObject({ completed: true, copied: ['config.json', 'secrets.bin'] });
    expect(await fs.readFile(path.join(current, 'config.json'), 'utf8')).toBe('{"legacy":true}');
    expect(await fs.readFile(path.join(current, 'secrets.bin'))).toEqual(Buffer.from([0, 1, 2, 3, 255]));
    expect(await fs.readFile(path.join(legacy, 'config.json'), 'utf8')).toBe('{"legacy":true}');

    const second = await migrateLegacyUserData({ legacyDir: legacy, destinationDir: current });
    expect(second).toMatchObject({ completed: true, copied: [] });
  });

  it('never overwrites destination data and writes no completion marker after a failed copy', async () => {
    root = await makeTempDir('comgu-migration-');
    const legacy = path.join(root, 'chat-on-steroids');
    const current = path.join(root, 'comgu');
    await fs.mkdir(legacy, { recursive: true });
    await fs.mkdir(current, { recursive: true });
    await fs.writeFile(path.join(legacy, 'config.json'), 'legacy', 'utf8');
    await fs.writeFile(path.join(current, 'config.json'), 'current', 'utf8');
    await fs.mkdir(path.join(legacy, 'secrets.bin'));

    await expect(migrateLegacyUserData({ legacyDir: legacy, destinationDir: current })).rejects.toThrow();
    expect(await fs.readFile(path.join(current, 'config.json'), 'utf8')).toBe('current');
    await expect(fs.access(path.join(current, '.legacy-userdata-migrated'))).rejects.toBeDefined();
  });
});
