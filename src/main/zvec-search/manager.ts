import { openRootSearchEngine, type RootSearchEngine, type RootSearchEngineOptions } from './engine.js';
import { verifySearchHits } from './format.js';
import { rootIndexId, type SearchStoragePaths } from './paths.js';
import {
  SMART_SEARCH_DEFAULT_LIMIT,
  SMART_SEARCH_MAX_LIMIT,
  type SmartSearchHit,
  type SmartSearchProvider,
  type SmartSearchRequest,
  type SmartSearchResponse,
  type SmartSearchScope
} from './types.js';

const MAX_LIVE_ENGINES = 4;
const ROOT_QUERY_CONCURRENCY = 2;

export interface SmartSearchManager extends SmartSearchProvider {
  close(): Promise<void>;
}

export interface SmartSearchManagerOptions {
  storage: SearchStoragePaths;
  embedding: string;
  openEngine?: (options: RootSearchEngineOptions) => Promise<RootSearchEngine>;
}

interface LiveEngine {
  engine: RootSearchEngine;
  lastUsed: number;
  leases: number;
}

interface RankedHit {
  hit: SmartSearchHit;
  fusedScore: number;
}

export function createSmartSearchManager(options: SmartSearchManagerOptions): SmartSearchManager {
  const openEngine = options.openEngine ?? openRootSearchEngine;
  const pending = new Map<string, Promise<RootSearchEngine>>();
  const live = new Map<string, LiveEngine>();
  const activeRequests = new Set<Promise<SmartSearchResponse>>();
  let useClock = 0;
  let closing = false;
  let closeWork: Promise<void> | null = null;

  const keyFor = (scope: SmartSearchScope): string => rootIndexId(scope.root, scope.root.path);

  async function engineFor(scope: SmartSearchScope): Promise<RootSearchEngine> {
    const key = keyFor(scope);
    const current = live.get(key);
    if (current) return current.engine;
    const opening = pending.get(key);
    if (opening) return opening;

    const work = openEngine({
      root: scope.root,
      canonicalRoot: scope.root.path,
      storage: options.storage,
      embedding: options.embedding
    }).then(async (engine) => {
      if (closing) {
        await engine.close().catch(() => undefined);
        throw new Error('SMART_SEARCH_CLOSING');
      }
      live.set(key, { engine, lastUsed: ++useClock, leases: 0 });
      return engine;
    });
    pending.set(key, work);
    try {
      return await work;
    } finally {
      if (pending.get(key) === work) pending.delete(key);
    }
  }

  async function evictIdle(): Promise<void> {
    while (live.size > MAX_LIVE_ENGINES) {
      const candidate = [...live.entries()]
        .filter(([, entry]) => entry.leases === 0)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed || left[0].localeCompare(right[0]))[0];
      if (!candidate) return;
      const [key, entry] = candidate;
      live.delete(key);
      await entry.engine.close();
    }
  }

  async function searchScope(scope: SmartSearchScope, request: SmartSearchRequest): Promise<SmartSearchHit[]> {
    const key = keyFor(scope);
    const engine = await engineFor(scope);
    const entry = live.get(key);
    if (!entry || entry.engine !== engine) throw new Error('SMART_SEARCH_ENGINE_UNAVAILABLE');
    entry.leases++;
    entry.lastUsed = ++useClock;
    try {
      const raw = await engine.search(scope, request);
      // Revalidate against this exact effective root, not every root the index manager has ever seen.
      return await verifySearchHits([scope.root], raw);
    } finally {
      entry.leases = Math.max(0, entry.leases - 1);
      entry.lastUsed = ++useClock;
      await evictIdle();
    }
  }

  async function runBounded<T>(items: readonly T[], operation: (item: T) => Promise<SmartSearchHit[]>): Promise<SmartSearchHit[][]> {
    const results: SmartSearchHit[][] = new Array(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await operation(items[index]!);
      }
    };
    const count = Math.min(ROOT_QUERY_CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: count }, () => worker()));
    return results;
  }

  function merge(groups: readonly SmartSearchHit[][], limit: number): SmartSearchHit[] {
    const merged = new Map<string, RankedHit>();
    for (const hits of groups) {
      for (let rank = 0; rank < hits.length; rank++) {
        const hit = hits[rank]!;
        const key = `${hit.virtualPath}\0${hit.startLine}\0${hit.endLine}`;
        const contribution = 1 / (60 + rank);
        const existing = merged.get(key);
        if (existing) existing.fusedScore += contribution;
        else merged.set(key, { hit, fusedScore: contribution });
      }
    }
    return [...merged.values()]
      .sort(
        (left, right) =>
          right.fusedScore - left.fusedScore ||
          left.hit.virtualPath.localeCompare(right.hit.virtualPath) ||
          left.hit.startLine - right.hit.startLine ||
          left.hit.endLine - right.hit.endLine
      )
      .slice(0, limit)
      .map((entry) => entry.hit);
  }

  function search(scopes: readonly SmartSearchScope[], request: SmartSearchRequest): Promise<SmartSearchResponse> {
    if (closing) return Promise.reject(new Error('SMART_SEARCH_CLOSING'));
    const started = performance.now();
    const limit = Math.min(SMART_SEARCH_MAX_LIMIT, Math.max(1, request.limit ?? SMART_SEARCH_DEFAULT_LIMIT));
    const work = (async () => {
      const groups = await runBounded(scopes, (scope) => searchScope(scope, { ...request, limit }));
      return {
        hits: merge(groups, limit),
        rootsSearched: new Set(scopes.map(keyFor)).size,
        elapsedMs: performance.now() - started
      };
    })();
    activeRequests.add(work);
    void work.finally(() => activeRequests.delete(work)).catch(() => undefined);
    return work;
  }

  function close(): Promise<void> {
    if (closeWork) return closeWork;
    closing = true;
    closeWork = (async () => {
      await Promise.allSettled([...activeRequests]);
      await Promise.allSettled([...pending.values()]);
      const engines = [...new Set([...live.values()].map((entry) => entry.engine))];
      live.clear();
      pending.clear();
      await Promise.all(engines.map((engine) => engine.close()));
    })();
    return closeWork;
  }

  return { search, close };
}
