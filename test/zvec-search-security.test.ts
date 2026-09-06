import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Root } from '../src/shared/types.js';
import { verifySearchHits } from '../src/main/zvec-search/format.js';
import type { SmartSearchRawHit } from '../src/main/zvec-search/types.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let base: string | null = null;

afterEach(async () => {
  if (base) await removeTempDir(base);
  base = null;
});

function raw(absolutePath: string): SmartSearchRawHit {
  return {
    absolutePath,
    startLine: 1,
    endLine: 2,
    content: 'needle',
    matchedBy: 'vector',
    freshness: 'fresh'
  };
}

describe('smart-search result authority', () => {
  it('accepts only hits that still resolve inside the current effective roots', async () => {
    base = await makeTempDir('comgu-zvec-security-');
    const approved = path.join(base, 'approved');
    const outside = path.join(base, 'outside');
    await fs.mkdir(approved, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    const insideFile = path.join(approved, 'inside.txt');
    const outsideFile = path.join(outside, 'secret.txt');
    await fs.writeFile(insideFile, 'inside');
    await fs.writeFile(outsideFile, 'secret');
    const roots: Root[] = [{ name: 'repo', path: await fs.realpath(approved) }];

    const verified = await verifySearchHits(roots, [raw(insideFile), raw(outsideFile)]);
    expect(verified).toEqual([expect.objectContaining({ virtualPath: '/repo/inside.txt', content: 'needle' })]);
    expect(JSON.stringify(verified)).not.toContain(outsideFile);
  });

  it('drops a stale hit from a root that is no longer in this call scope', async () => {
    base = await makeTempDir('comgu-zvec-stale-');
    const first = path.join(base, 'first');
    const second = path.join(base, 'second');
    await fs.mkdir(first, { recursive: true });
    await fs.mkdir(second, { recursive: true });
    const staleFile = path.join(second, 'stale.txt');
    await fs.writeFile(staleFile, 'stale');
    const roots: Root[] = [{ name: 'first', path: await fs.realpath(first) }];
    expect(await verifySearchHits(roots, [raw(staleFile)])).toEqual([]);
  });

  it('drops a native hit that reaches outside through a symlink or junction', async () => {
    base = await makeTempDir('comgu-zvec-link-');
    const approved = path.join(base, 'approved');
    const outside = path.join(base, 'outside');
    await fs.mkdir(approved, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    const link = path.join(approved, 'escape');
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const roots: Root[] = [{ name: 'repo', path: await fs.realpath(approved) }];
    expect(await verifySearchHits(roots, [raw(path.join(link, 'secret.txt'))])).toEqual([]);
  });
});
