import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Root } from '../src/shared/types.js';
import { createSmartSearchManager, type SmartSearchManager } from '../src/main/zvec-search/manager.js';
import { smartSearchStoragePaths } from '../src/main/zvec-search/paths.js';
import type { RootSearchEngine } from '../src/main/zvec-search/engine.js';
import type { SmartSearchRawHit, SmartSearchScope } from '../src/main/zvec-search/types.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let base: string | null = null;

afterEach(async () => {
  if (base) await removeTempDir(base);
  base = null;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function fixtureRoots(count: number): Promise<{ roots: Root[]; scopes: SmartSearchScope[]; files: string[] }> {
  base = await makeTempDir('comgu-zvec-manager-');
  const roots: Root[] = [];
  const scopes: SmartSearchScope[] = [];
  const files: string[] = [];
  for (let index = 0; index < count; index++) {
    const dir = path.join(base, `root-${index}`);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'hit.txt');
    await fs.writeFile(file, `root ${index}`);
    const canonical = await fs.realpath(dir);
    const root: Root = { name: `root-${index}`, path: canonical };
    roots.push(root);
    scopes.push({ root, realPath: canonical, virtualPath: `/${root.name}`, kind: 'directory' });
    files.push(file);
  }
  return { roots, scopes, files };
}

function raw(file: string, line = 1): SmartSearchRawHit {
  return {
    absolutePath: file,
    startLine: line,
    endLine: line,
    content: `hit-${line}`,
    matchedBy: 'vector',
    freshness: 'fresh'
  };
}

describe('smart-search multi-root manager', () => {
  it('single-flights simultaneous first opens of the same root', async () => {
    const { scopes, files } = await fixtureRoots(1);
    const gate = deferred<void>();
    const openEngine = vi.fn(async () => {
      await gate.promise;
      return { search: vi.fn(async () => [raw(files[0]!)]), close: vi.fn(async () => undefined) } satisfies RootSearchEngine;
    });
    const manager = createSmartSearchManager({
      storage: smartSearchStoragePaths(path.join(base!, 'user-data')),
      embedding: 'local/test',
      openEngine
    });
    const first = manager.search(scopes, { query: 'x' });
    const second = manager.search(scopes, { query: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openEngine).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([first, second]);
    await manager.close();
  });

  it('caps active root searches at two while allowing different roots to overlap', async () => {
    const { scopes } = await fixtureRoots(5);
    let active = 0;
    let peak = 0;
    const releases = scopes.map(() => deferred<void>());
    const openEngine = vi.fn(async ({ root }: { root: Root }) => {
      const index = Number(root.name.split('-')[1]);
      return {
        async search() {
          active++;
          peak = Math.max(peak, active);
          await releases[index]!.promise;
          active--;
          return [];
        },
        async close() {}
      } satisfies RootSearchEngine;
    });
    const manager = createSmartSearchManager({ storage: smartSearchStoragePaths(path.join(base!, 'u')), embedding: 'local/test', openEngine });
    const work = manager.search(scopes, { query: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(active).toBe(2);
    releases[0]!.resolve();
    releases[1]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(active).toBeLessThanOrEqual(2);
    for (const release of releases) release.resolve();
    await work;
    expect(peak).toBe(2);
    await manager.close();
  });

  it('retains at most four idle engines and evicts the least recently used fifth', async () => {
    const { scopes } = await fixtureRoots(5);
    const closes = new Map<string, ReturnType<typeof vi.fn>>();
    const openEngine = vi.fn(async ({ root }: { root: Root }) => {
      const close = vi.fn(async () => undefined);
      closes.set(root.name, close);
      return { search: vi.fn(async () => []), close } satisfies RootSearchEngine;
    });
    const manager = createSmartSearchManager({ storage: smartSearchStoragePaths(path.join(base!, 'u')), embedding: 'local/test', openEngine });
    for (const scope of scopes) await manager.search([scope], { query: 'x' });
    expect(closes.get('root-0')).toHaveBeenCalledTimes(1);
    expect(closes.get('root-4')).not.toHaveBeenCalled();
    await manager.close();
  });

  it('does not evict an in-flight engine and closes it only after its lease releases', async () => {
    const { scopes } = await fixtureRoots(5);
    const gate = deferred<void>();
    const closes = new Map<string, ReturnType<typeof vi.fn>>();
    const openEngine = vi.fn(async ({ root }: { root: Root }) => {
      const close = vi.fn(async () => undefined);
      closes.set(root.name, close);
      return {
        search: vi.fn(async () => {
          if (root.name === 'root-0') await gate.promise;
          return [];
        }),
        close
      } satisfies RootSearchEngine;
    });
    const manager = createSmartSearchManager({ storage: smartSearchStoragePaths(path.join(base!, 'u')), embedding: 'local/test', openEngine });
    const held = manager.search([scopes[0]!], { query: 'held' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const scope of scopes.slice(1)) await manager.search([scope], { query: 'x' });
    expect(closes.get('root-0')).not.toHaveBeenCalled();
    gate.resolve();
    await held;
    expect(closes.get('root-0')).not.toHaveBeenCalled();
    await manager.close();
    expect(closes.get('root-0')).toHaveBeenCalledTimes(1);
  });

  it('merges duplicates deterministically and applies limit after cross-root fusion', async () => {
    const { scopes, files } = await fixtureRoots(2);
    const duplicatePath = files[0]!;
    const openEngine = vi.fn(async ({ root }: { root: Root }) => ({
      search: vi.fn(async () =>
        root.name === 'root-0'
          ? [raw(duplicatePath, 1), raw(duplicatePath, 1), raw(files[0]!, 2)]
          : [raw(files[1]!, 3)]
      ),
      close: vi.fn(async () => undefined)
    } satisfies RootSearchEngine));
    const manager = createSmartSearchManager({ storage: smartSearchStoragePaths(path.join(base!, 'u')), embedding: 'local/test', openEngine });
    const result = await manager.search(scopes, { query: 'x', limit: 2 });
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toMatchObject({ virtualPath: '/root-0/hit.txt', startLine: 1 });
    expect(result.hits[1]).toMatchObject({ virtualPath: '/root-1/hit.txt', startLine: 3 });
    await manager.close();
  });

  it('close waits for active work and closes each retained engine exactly once', async () => {
    const { scopes } = await fixtureRoots(1);
    const gate = deferred<void>();
    const closeEngine = vi.fn(async () => undefined);
    const openEngine = vi.fn(async () => ({
      search: vi.fn(async () => { await gate.promise; return []; }),
      close: closeEngine
    } satisfies RootSearchEngine));
    const manager: SmartSearchManager = createSmartSearchManager({ storage: smartSearchStoragePaths(path.join(base!, 'u')), embedding: 'local/test', openEngine });
    const search = manager.search(scopes, { query: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const closing = manager.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closeEngine).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([search, closing, manager.close()]);
    expect(closeEngine).toHaveBeenCalledTimes(1);
  });
});
