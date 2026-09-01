import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyUserData } from '../src/main/migration.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let root = '';

afterEach(async () => {
  if (root) await removeTempDir(root);
  root = '';
});

describe('ComGu user-data migration', () => {
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
