import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openRootSearchEngine, routesForMode } from '../src/main/zvec-search/engine.js';
import { smartSearchStoragePaths } from '../src/main/zvec-search/paths.js';

describe('smart-search root engine', () => {
  it('ignores ambient remote zvec configuration and passes only explicit local embedding options', async () => {
    const prior = {
      embedding: process.env.ZVEC_GREP_EMBEDDING,
      apiKey: process.env.ZVEC_GREP_API_KEY,
      endpoint: process.env.ZVEC_GREP_ENDPOINT
    };
    process.env.ZVEC_GREP_EMBEDDING = 'qwen/qwen3.7-text-embedding';
    process.env.ZVEC_GREP_API_KEY = 'must-not-be-used';
    process.env.ZVEC_GREP_ENDPOINT = 'https://example.invalid';
    try {
      const storage = smartSearchStoragePaths(path.join('C:', 'userData'));
      const received: Record<string, unknown>[] = [];
      const createService = vi.fn(async (options: Record<string, unknown>) => {
        received.push(options);
        return {
          info: vi.fn(async () => ({ indexed: true })),
          index: vi.fn(async () => ({})),
          context: vi.fn(async () => ({ items: [] })),
          close: vi.fn(async () => undefined)
        };
      });
      const canonicalRoot = path.resolve('D:\\work\\repo');
      const engine = await openRootSearchEngine({
        root: { name: 'repo', path: canonicalRoot },
        canonicalRoot,
        storage,
        embedding: 'local/potion-code-16m-v2',
        createService
      });
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ embedding: 'local/potion-code-16m-v2', home: storage.base });
      expect(received[0]).not.toHaveProperty('apiKey');
      expect(received[0]).not.toHaveProperty('endpoint');
      await engine.close();
    } finally {
      if (prior.embedding === undefined) delete process.env.ZVEC_GREP_EMBEDDING;
      else process.env.ZVEC_GREP_EMBEDDING = prior.embedding;
      if (prior.apiKey === undefined) delete process.env.ZVEC_GREP_API_KEY;
      else process.env.ZVEC_GREP_API_KEY = prior.apiKey;
      if (prior.endpoint === undefined) delete process.env.ZVEC_GREP_ENDPOINT;
      else process.env.ZVEC_GREP_ENDPOINT = prior.endpoint;
    }
  });

  it('refuses a non-local embedding before opening any zvec service', async () => {
    const createService = vi.fn();
    const canonicalRoot = path.resolve('D:\\work\\repo');
    await expect(
      openRootSearchEngine({
        root: { name: 'repo', path: canonicalRoot },
        canonicalRoot,
        storage: smartSearchStoragePaths(path.join('C:', 'userData')),
        embedding: 'openai/text-embedding-3-small',
        createService
      })
    ).rejects.toThrow(/local embedding/i);
    expect(createService).not.toHaveBeenCalled();
  });

  it('opens a local-only service and indexes the approved canonical root once when missing', async () => {
    const storage = smartSearchStoragePaths(path.join('C:', 'userData'));
    const createOptions: Record<string, unknown>[] = [];
    const index = vi.fn(async () => ({}));
    const context = vi.fn(async () => ({ items: [], diagnostics: {}, query: '', root: '', source: 'index', coverage: 'ranked_sample' }));
    const close = vi.fn(async () => undefined);
    const createService = vi.fn(async (options: Record<string, unknown>) => {
      createOptions.push(options);
      return {
        info: vi.fn(async () => ({ indexed: false })),
        index,
        context,
        close
      };
    });

    const canonicalRoot = path.resolve('D:\\work\\repo');
    const engine = await openRootSearchEngine({
      root: { name: 'repo', path: canonicalRoot },
      canonicalRoot,
      storage,
      embedding: 'local/potion-code-16m-v2',
      createService
    });

    expect(createOptions).toHaveLength(1);
    expect(createOptions[0]).toMatchObject({ home: storage.base, modelCacheDir: storage.models, embedding: 'local/potion-code-16m-v2' });
    expect(String(createOptions[0]!.root)).toContain(storage.indexes);
    expect(index).toHaveBeenCalledTimes(1);
    expect(index).toHaveBeenCalledWith(expect.objectContaining({ rootPaths: [canonicalRoot], follow: false }));
    await engine.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing index without rebuilding and restricts context to the validated scope', async () => {
    const storage = smartSearchStoragePaths(path.join('C:', 'userData'));
    const canonicalRoot = path.resolve('D:\\work\\repo');
    const index = vi.fn(async () => ({}));
    const context = vi.fn(async () => ({
      items: [
        {
          file: { absolutePath: path.join(canonicalRoot, 'src', 'main.ts') },
          range: { kind: 'text', startLine: 4, endLine: 9, startOffset: 0, endOffset: 10 },
          content: 'workspace authority',
          matchedBy: 'vector',
          status: 'fresh' as const,
          score: 0.8
        }
      ],
      diagnostics: {}, query: 'authority', root: canonicalRoot, source: 'index', coverage: 'ranked_sample'
    }));
    const createService = vi.fn(async () => ({
      info: vi.fn(async () => ({ indexed: true })),
      index,
      context,
      close: vi.fn(async () => undefined)
    }));
    const engine = await openRootSearchEngine({
      root: { name: 'repo', path: canonicalRoot },
      canonicalRoot,
      storage,
      embedding: 'local/potion-code-16m-v2',
      createService
    });
    const scopePath = path.join(canonicalRoot, 'src');
    const hits = await engine.search(
      { root: { name: 'repo', path: canonicalRoot }, realPath: scopePath, virtualPath: '/repo/src', kind: 'directory' },
      { query: 'authority', mode: 'semantic', limit: 5 }
    );

    expect(index).not.toHaveBeenCalled();
    expect(context).toHaveBeenCalledWith(expect.objectContaining({ includePaths: [scopePath], limit: 5, fuse: false }));
    expect(hits).toEqual([
      expect.objectContaining({ absolutePath: path.join(canonicalRoot, 'src', 'main.ts'), startLine: 4, endLine: 9, content: 'workspace authority' })
    ]);
  });

  it.each([
    ['lexical', [{ id: 'lexical', mode: 'fts', query: 'hello' }]],
    ['semantic', [{ id: 'semantic', mode: 'vector', query: 'hello' }]],
    ['hybrid', [{ id: 'lexical', mode: 'fts', query: 'hello' }, { id: 'semantic', mode: 'vector', query: 'hello' }]],
    ['auto', [{ id: 'lexical', mode: 'fts', query: 'hello' }, { id: 'semantic', mode: 'vector', query: 'hello' }]]
  ] as const)('maps %s mode without exposing upstream controls', (mode, expected) => {
    expect(routesForMode(mode, 'hello')).toEqual(expected);
  });
});
