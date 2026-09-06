import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';
// @ts-ignore Build/measurement scripts are intentionally plain ESM JavaScript.
import { measurePackage, measureTree } from '../scripts/measure-package-footprint.mjs';

let temp: string | undefined;

afterEach(async () => {
  if (temp) await removeTempDir(temp);
  temp = undefined;
});

describe('package footprint measurement', () => {
  it('categorizes byte counts deterministically without filesystem timestamps', async () => {
    temp = await makeTempDir('comgu-footprint-');
    const unpacked = path.join(temp, 'win-unpacked');
    const installer = path.join(temp, 'ComGu-Setup-x64.exe');
    await fs.mkdir(path.join(unpacked, 'resources', 'app.asar.unpacked'), { recursive: true });
    await fs.mkdir(path.join(unpacked, 'resources', 'extension'), { recursive: true });
    await fs.writeFile(path.join(unpacked, 'resources', 'app.asar'), Buffer.alloc(10));
    await fs.writeFile(path.join(unpacked, 'resources', 'app.asar.unpacked', 'native.bin'), Buffer.alloc(20));
    await fs.writeFile(path.join(unpacked, 'resources', 'extension', 'content.js'), Buffer.alloc(30));
    await fs.writeFile(installer, Buffer.alloc(7));

    const tree = await measureTree(unpacked);
    expect(tree.files.map((entry: { path: string }) => entry.path)).toEqual([
      'resources/app.asar',
      'resources/app.asar.unpacked/native.bin',
      'resources/extension/content.js'
    ]);
    expect(tree.totalBytes).toBe(60);

    const result = await measurePackage({ installer, unpacked });
    expect(result.installerBytes).toBe(7);
    expect(result.totalBytes).toBe(60);
    expect(result.categories).toEqual({
      appAsar: 10,
      appAsarUnpacked: 20,
      extraResources: 30
    });
  });
});
