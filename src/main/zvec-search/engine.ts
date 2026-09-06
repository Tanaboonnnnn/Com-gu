import { mkdir } from 'node:fs/promises';
import type { Root } from '../../shared/types.js';
import { loadZvecModule } from './loader.js';
import { rootIndexPaths, type SearchStoragePaths } from './paths.js';
import type { SmartSearchMode, SmartSearchRawHit, SmartSearchRequest, SmartSearchScope } from './types.js';

interface ZvecContextItemLike {
  file: { absolutePath: string };
  range?: {
    kind?: string;
    startLine?: number;
    endLine?: number;
  };
  content: string;
  matchedBy: unknown;
  status: 'fresh' | 'possibly_stale';
  score?: number;
}

interface ZvecServiceLike {
  info(options?: { root?: string; includeStatus?: boolean }): Promise<{ indexed: boolean }>;
  index(options: { root?: string; rootPaths: readonly string[]; follow: boolean }): Promise<unknown>;
  context(options: Record<string, unknown>): Promise<{ items: ZvecContextItemLike[] }>;
  close(): Promise<void>;
}

export type ZvecServiceFactory = (options: {
  root: string;
  modelCacheDir: string;
  embedding: string;
}) => Promise<ZvecServiceLike>;

export interface RootSearchEngineOptions {
  root: Root;
  canonicalRoot: string;
  storage: SearchStoragePaths;
  embedding: string;
  createService?: ZvecServiceFactory;
}

export interface RootSearchEngine {
  search(scope: SmartSearchScope, request: SmartSearchRequest): Promise<readonly SmartSearchRawHit[]>;
  close(): Promise<void>;
}

export function routesForMode(mode: SmartSearchMode, query: string) {
  if (mode === 'lexical') return [{ id: 'lexical', mode: 'fts' as const, query }];
  if (mode === 'semantic') return [{ id: 'semantic', mode: 'vector' as const, query }];
  return [
    { id: 'lexical', mode: 'fts' as const, query },
    { id: 'semantic', mode: 'vector' as const, query }
  ];
}

function matchLabel(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(',');
  return String(value ?? 'unknown');
}

function lineRange(item: ZvecContextItemLike): { startLine: number; endLine: number } {
  const startLine = item.range && Number.isFinite(item.range.startLine) ? Number(item.range.startLine) : 1;
  const endLine = item.range && Number.isFinite(item.range.endLine) ? Number(item.range.endLine) : startLine;
  return { startLine: Math.max(1, startLine), endLine: Math.max(Math.max(1, startLine), endLine) };
}

export async function openRootSearchEngine(options: RootSearchEngineOptions): Promise<RootSearchEngine> {
  const { root, canonicalRoot, storage, embedding } = options;
  if (!embedding.startsWith('local/')) {
    throw new Error('Smart Search requires an explicit local embedding model.');
  }
  const indexPaths = rootIndexPaths(storage, root, canonicalRoot);
  await Promise.all([
    mkdir(storage.models, { recursive: true }),
    mkdir(indexPaths.syntheticRoot, { recursive: true })
  ]);

  const createService: ZvecServiceFactory =
    options.createService ??
    (async (serviceOptions) => {
      const module = await loadZvecModule();
      return module.createZvecGrep(serviceOptions) as Promise<ZvecServiceLike>;
    });
  const service = await createService({
    root: indexPaths.syntheticRoot,
    modelCacheDir: storage.models,
    embedding
  });

  try {
    const info = await service.info({ root: indexPaths.syntheticRoot, includeStatus: true });
    if (!info.indexed) {
      await service.index({ root: indexPaths.syntheticRoot, rootPaths: [canonicalRoot], follow: false });
    }
  } catch (error) {
    await service.close().catch(() => undefined);
    throw error;
  }

  let closed = false;
  return {
    async search(scope, request) {
      if (closed) throw new Error('SMART_SEARCH_ENGINE_CLOSED');
      const mode = request.mode ?? 'auto';
      const routes = routesForMode(mode, request.query);
      const result = await service.context({
        root: indexPaths.syntheticRoot,
        query: request.query,
        routes,
        fuse: mode === 'auto' || mode === 'hybrid',
        limit: request.limit,
        includePaths: [scope.realPath],
        ...(request.include && request.include.length > 0 ? { globs: [...request.include] } : {}),
        ...(request.fileTypes && request.fileTypes.length > 0 ? { fileTypes: [...request.fileTypes] } : {}),
        follow: false,
        autoUpdate: true
      });
      return result.items.map((item) => {
        const range = lineRange(item);
        return {
          absolutePath: item.file.absolutePath,
          ...range,
          content: item.content,
          matchedBy: matchLabel(item.matchedBy),
          ...(typeof item.score === 'number' ? { score: item.score } : {}),
          freshness: item.status
        } satisfies SmartSearchRawHit;
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await service.close();
    }
  };
}
