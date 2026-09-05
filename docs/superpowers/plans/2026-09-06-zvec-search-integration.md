# Zvec Smart Search Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one secure, local, semantic/hybrid `search` tool to ComGu Core using the direct `@zvec/zvec-grep` engine API while preserving all existing WorkspaceScope, permission, exact-search, and privacy guarantees.

**Architecture:** ComGu remains the only filesystem authority. A lazily loaded `src/main/zvec-search/` subsystem indexes each approved root into an application-private synthetic workspace under Electron `userData`, queries zvec in-process, revalidates every returned path against the current effective call scope, and returns only virtual paths. No zvec daemon, MCP endpoint, remote embedding, or model-controlled root is introduced.

**Tech Stack:** Electron 43, TypeScript, MCP Node 2, Zod 4, `@zvec/zvec-grep` pinned package, Vitest 4, existing ComGu sandbox/WorkspaceScope infrastructure.

**Spec:** `docs/superpowers/specs/2026-09-06-zvec-search-and-performance-design.md`

## Global Constraints

- Do not change or weaken `effectiveRootsForCall`, `resolveIn`, Chat WorkspaceScope, Prime/Run scope, Worker subset scope, or retired/dormant worker fences.
- `search` uses the existing `search` capability; do not add another permission checkbox.
- Keep existing `find` and bundled `rg` behavior intact.
- Expose exactly one new model-facing tool, `search`; expose no zvec administrative tools.
- Do not start zvec's daemon or bind another network port.
- Do not accept native zvec root/home/model/provider/API-key fields from the model.
- Version 1 uses an explicit local embedding model only; no remote embedding fallback.
- Store indexes and model cache under ComGu `userData`, never inside the user's repository.
- Dynamic-import zvec on first Smart Search use; ordinary ComGu startup must not load it.
- Revalidate each returned real path against the current call scope before returning it.
- Never return native workspace/index/model-cache paths to ChatGPT.
- Default result limit is 8, maximum 20, and complete model-facing result text is capped at 96 KiB.
- Use TDD for every behavior change; do not alter implementation before the corresponding failing test exists.
- No sub-agent execution is required for this user's workflow; when this plan is executed, use the inline `executing-plans` path unless the user explicitly changes that preference.

---

## File Structure

Create these focused files:

- `src/main/zvec-search/types.ts` — ComGu-owned request/result/provider contracts; no zvec imports.
- `src/main/zvec-search/paths.ts` — application-private cache paths, stable root identity, and result-to-root ownership helpers.
- `src/main/zvec-search/loader.ts` — the only dynamic import of `@zvec/zvec-grep`; normalizes the narrow API ComGu consumes.
- `src/main/zvec-search/engine.ts` — one approved root's index/service lifecycle and local-only zvec configuration.
- `src/main/zvec-search/manager.ts` — multi-root orchestration, single-flight initialization, bounded service LRU, merge, and shutdown.
- `src/main/zvec-search/format.ts` — result path revalidation and bounded model-facing formatting.
- `src/main/zvec-search/index.ts` — process-level initialization/get/shutdown seam used by MCP and app lifecycle.

Modify these existing files:

- `package.json`, `package-lock.json` — pin zvec package.
- `src/main/mcp/kernel.ts` — make `search` identity-sensitive and add the narrow provider seam to `ToolContext`.
- `src/main/mcp/tools-core.ts` — register the one `search` tool.
- `src/main/mcp/surfaces.ts` — declare `search` on Core and update connector wording.
- `src/main/connection.ts` — supply the initialized search provider in the live MCP context and list `search` in current tools.
- `src/main/index.ts` — initialize Smart Search's userData paths and close it during shutdown.
- `src/shared/types.ts` — update Search permission detail and tool mapping.
- `src/shared/i18n/catalog.ts` — update Search permission copy in English and Thai where the shared catalogue mirrors capability descriptions.
- `electron-builder.yml` — ensure the required third-party notice ships; do not add zvec models.
- `THIRD-PARTY-NOTICES.md` — Apache-2.0 attribution for zvec dependency and any notice required by its redistributed runtime dependencies.
- `README.md` / `docs/tool-surface.md` — explain when Smart Search versus exact search is used and that it is local by default.

Create focused tests:

- `test/zvec-search-paths.test.ts`
- `test/zvec-search-loader.test.ts`
- `test/zvec-search-engine.test.ts`
- `test/zvec-search-manager.test.ts`
- `test/zvec-search-format.test.ts`
- `test/zvec-search-security.test.ts`
- `test/zvec-search-tool.test.ts`
- `test/zvec-search-lifecycle.test.ts`
- `test/zvec-search-packaging.test.ts`
- `test/fixtures/zvec-search-corpus/**`
- `scripts/benchmark-zvec-search.mjs`
- `docs/performance/2026-09-06-zvec-search-model-benchmark.md`

---

### Task 1: Pin the upstream dependency and define the adapter boundary

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/main/zvec-search/types.ts`
- Create: `test/zvec-search-loader.test.ts`

**Interfaces:**
- Consumes: the published `@zvec/zvec-grep` package only through a later loader.
- Produces: `SmartSearchRequest`, `SmartSearchMode`, `SmartSearchScope`, `SmartSearchHit`, `SmartSearchResponse`, and `SmartSearchProvider` contracts used by every later task.

- [ ] **Step 1: Add the pinned dependency without changing production code**

Run:

```powershell
npm install --save-exact @zvec/zvec-grep@0.2.1
```

Expected: `package.json` contains `"@zvec/zvec-grep": "0.2.1"` and `package-lock.json` records the exact resolved package; no zvec daemon configuration is added.

- [ ] **Step 2: Write the adapter-contract test before the type file exists**

Create `test/zvec-search-loader.test.ts` with a type/runtime smoke that imports only ComGu's adapter module and asserts the public request modes:

```ts
import { describe, expect, it } from 'vitest';
import { SMART_SEARCH_MODES, SMART_SEARCH_DEFAULT_LIMIT, SMART_SEARCH_MAX_LIMIT } from '../src/main/zvec-search/types.js';

describe('smart-search public contract', () => {
  it('keeps the model-facing modes and result limits deliberately small', () => {
    expect(SMART_SEARCH_MODES).toEqual(['auto', 'hybrid', 'lexical', 'semantic']);
    expect(SMART_SEARCH_DEFAULT_LIMIT).toBe(8);
    expect(SMART_SEARCH_MAX_LIMIT).toBe(20);
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npx vitest run test/zvec-search-loader.test.ts
```

Expected: FAIL because `src/main/zvec-search/types.ts` does not exist.

- [ ] **Step 4: Create the stable ComGu-owned contracts**

Create `src/main/zvec-search/types.ts`:

```ts
import type { Root } from '../../shared/types.js';

export const SMART_SEARCH_MODES = ['auto', 'hybrid', 'lexical', 'semantic'] as const;
export type SmartSearchMode = (typeof SMART_SEARCH_MODES)[number];
export const SMART_SEARCH_DEFAULT_LIMIT = 8;
export const SMART_SEARCH_MAX_LIMIT = 20;
export const SMART_SEARCH_MAX_OUTPUT_BYTES = 96 * 1024;

export interface SmartSearchRequest {
  query: string;
  path?: string;
  mode?: SmartSearchMode;
  include?: readonly string[];
  fileTypes?: readonly string[];
  limit?: number;
}

export interface SmartSearchScope {
  root: Root;
  realPath: string;
  virtualPath: string;
  kind: 'file' | 'directory';
}

export interface SmartSearchRawHit {
  absolutePath: string;
  startLine: number;
  endLine: number;
  content: string;
  matchedBy: string;
  score?: number;
  freshness: 'fresh' | 'possibly_stale';
}

export interface SmartSearchHit extends Omit<SmartSearchRawHit, 'absolutePath'> {
  virtualPath: string;
}

export interface SmartSearchResponse {
  hits: SmartSearchHit[];
  rootsSearched: number;
  elapsedMs: number;
}

export interface SmartSearchProvider {
  search(scopes: readonly SmartSearchScope[], request: SmartSearchRequest): Promise<SmartSearchResponse>;
}
```

Keep all upstream-specific types out of this file so zvec upgrades remain isolated.

- [ ] **Step 5: Verify GREEN and typecheck**

Run:

```powershell
npx vitest run test/zvec-search-loader.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the dependency boundary**

```powershell
git add package.json package-lock.json src/main/zvec-search/types.ts test/zvec-search-loader.test.ts
git commit -m "build(search): pin zvec search engine"
```

---

### Task 2: Build stable application-private index paths

**Files:**
- Create: `src/main/zvec-search/paths.ts`
- Create: `test/zvec-search-paths.test.ts`

**Interfaces:**
- Consumes: canonical `Root` objects already approved by ComGu.
- Produces: `SearchStoragePaths`, `smartSearchStoragePaths(userData)`, `rootIndexId(root)`, and `rootIndexPaths(storage, root)`.

- [ ] **Step 1: Write RED tests for private storage and identity isolation**

Create tests that require the following behavior:

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rootIndexId, rootIndexPaths, smartSearchStoragePaths } from '../src/main/zvec-search/paths.js';

describe('smart-search paths', () => {
  it('stores indexes below userData and never below the source repository', () => {
    const storage = smartSearchStoragePaths('C:\\Users\\u\\AppData\\Roaming\\ComGu');
    const root = { name: 'repo', path: 'D:\\work\\repo' };
    const paths = rootIndexPaths(storage, root, 'D:\\work\\repo');
    expect(paths.syntheticRoot.startsWith(storage.indexes)).toBe(true);
    expect(paths.syntheticRoot.startsWith(root.path)).toBe(false);
  });

  it('does not alias two different canonical native roots with the same virtual name', () => {
    expect(rootIndexId({ name: 'repo', path: 'D:\\a' }, 'D:\\a'))
      .not.toBe(rootIndexId({ name: 'repo', path: 'D:\\b' }, 'D:\\b'));
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run `npx vitest run test/zvec-search-paths.test.ts`.

Expected: FAIL because `paths.ts` is absent.

- [ ] **Step 3: Implement the versioned root digest and storage layout**

Create `src/main/zvec-search/paths.ts` with this contract:

```ts
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Root } from '../../shared/types.js';

export interface SearchStoragePaths {
  base: string;
  models: string;
  indexes: string;
}

export function smartSearchStoragePaths(userData: string): SearchStoragePaths {
  const base = path.join(userData, 'search');
  return { base, models: path.join(base, 'models'), indexes: path.join(base, 'indexes') };
}

export function rootIndexId(root: Root, canonicalPath: string): string {
  return createHash('sha256')
    .update('comgu-zvec-root-v1\0')
    .update(root.name)
    .update('\0')
    .update(process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath)
    .digest('hex')
    .slice(0, 32);
}

export function rootIndexPaths(storage: SearchStoragePaths, root: Root, canonicalPath: string) {
  const id = rootIndexId(root, canonicalPath);
  const container = path.join(storage.indexes, id);
  return { id, container, syntheticRoot: path.join(container, 'workspace') };
}
```

- [ ] **Step 4: Run the test and typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/main/zvec-search/paths.ts test/zvec-search-paths.test.ts
git commit -m "feat(search): isolate zvec indexes in user data"
```

---

### Task 3: Create the only lazy zvec import boundary

**Files:**
- Create: `src/main/zvec-search/loader.ts`
- Modify: `test/zvec-search-loader.test.ts`

**Interfaces:**
- Consumes: package `@zvec/zvec-grep`.
- Produces: memoized `loadZvecModule(): Promise<typeof import('@zvec/zvec-grep')>` and test-only `zvecModuleLoadedForTest(): boolean`.

- [ ] **Step 1: Extend the test to prove no eager import**

Add:

```ts
import { loadZvecModule, zvecModuleLoadedForTest } from '../src/main/zvec-search/loader.js';

it('loads zvec only on first explicit request', async () => {
  expect(zvecModuleLoadedForTest()).toBe(false);
  const first = await loadZvecModule();
  expect(typeof first.createZvecGrep).toBe('function');
  expect(zvecModuleLoadedForTest()).toBe(true);
  expect(await loadZvecModule()).toBe(first);
});
```

- [ ] **Step 2: Run and verify RED**

Expected: FAIL because loader does not exist.

- [ ] **Step 3: Implement one memoized dynamic import**

`src/main/zvec-search/loader.ts` must contain no top-level import from zvec:

```ts
let loaded: Promise<typeof import('@zvec/zvec-grep')> | null = null;

export function loadZvecModule(): Promise<typeof import('@zvec/zvec-grep')> {
  loaded ??= import('@zvec/zvec-grep');
  return loaded;
}

export function zvecModuleLoadedForTest(): boolean {
  return loaded !== null;
}
```

- [ ] **Step 4: Verify test and inspect production bundle import shape**

Run:

```powershell
npx vitest run test/zvec-search-loader.test.ts
npm run build
```

Expected: test PASS and build PASS. Inspect `out/main` to confirm zvec resides in a lazy chunk or otherwise is not evaluated by application startup before `loadZvecModule()`.

- [ ] **Step 5: Commit**

```powershell
git add src/main/zvec-search/loader.ts test/zvec-search-loader.test.ts
git commit -m "perf(search): lazy load zvec engine"
```

---

### Task 4: Implement one-root local-only engine lifecycle

**Files:**
- Create: `src/main/zvec-search/engine.ts`
- Create: `test/zvec-search-engine.test.ts`

**Interfaces:**
- Consumes: `SearchStoragePaths`, one canonical approved root, `loadZvecModule()`.
- Produces: `RootSearchEngine` with `search(scope, request)`, `close()`, and factory `openRootSearchEngine(options)`.

- [ ] **Step 1: Write RED tests with an injected fake zvec factory**

The fake must prove that the engine passes:

```ts
const selectedLocalModel = 'local/potion-code-16m-v2';
expect(createOptions).toMatchObject({
  root: syntheticRoot,
  modelCacheDir: storage.models,
  embedding: selectedLocalModel
});
expect(indexOptions.rootPaths).toEqual([canonicalApprovedRoot]);
expect(indexOptions.follow).toBe(false);
```

Also assert that a pre-existing index calls `info()` then `context()` without rebuilding, and a missing index calls `index()` exactly once.

- [ ] **Step 2: Run focused test and verify RED**

Run `npx vitest run test/zvec-search-engine.test.ts`.

- [ ] **Step 3: Implement the engine with dependency injection**

Use a narrow constructor/factory shape so tests never download a real model. Define the fakeable service contract in this file rather than leaking upstream types through the rest of ComGu:

```ts
interface ZvecServiceLike {
  info(options?: { root?: string; includeStatus?: boolean }): Promise<{ indexed: boolean }>;
  index(options: { rootPaths: readonly string[]; follow: boolean }): Promise<unknown>;
  context(options: Record<string, unknown>): Promise<{
    items: Array<{
      file: { absolutePath: string };
      range: { start: number; end: number };
      content: string;
      matchedBy: string | readonly string[];
      status: 'fresh' | 'possibly_stale';
      score?: number;
    }>;
  }>;
  close(): Promise<void>;
}

type ZvecServiceFactory = (options: {
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
```

The production factory must:

```ts
const module = await loadZvecModule();
const service = await module.createZvecGrep({
  root: indexPaths.syntheticRoot,
  modelCacheDir: storage.models,
  embedding
});
```

Before first query, ensure `storage.models` and `indexPaths.syntheticRoot` exist, inspect `service.info()`, and if absent run `service.index({ rootPaths: [canonicalRoot], follow: false })`.

Map `context()` items into `SmartSearchRawHit` and discard upstream diagnostics fields that are not part of ComGu's contract. When `scope` is narrower than the approved root, derive an indexed path filter from the already validated `scope.realPath`; a file scope matches only that file and a directory scope matches that directory recursively. The filter is derived by ComGu after sandbox resolution, never from raw model text.

- [ ] **Step 4: Map modes without exposing zvec details**

Implement a pure mapper covered by table tests:

```ts
const routesForMode = (mode: SmartSearchMode, query: string) => {
  if (mode === 'lexical') return [{ id: 'lexical', mode: 'fts' as const, query }];
  if (mode === 'semantic') return [{ id: 'semantic', mode: 'vector' as const, query }];
  return [
    { id: 'lexical', mode: 'fts' as const, query },
    { id: 'semantic', mode: 'vector' as const, query }
  ];
};
```

For `auto` and `hybrid`, pass both routes with `fuse: true`; map `include` and `fileTypes` to upstream filters. Do not use zvec's managed-rg route in this integration.

- [ ] **Step 5: Verify focused test and typecheck**

Expected: PASS with no network/model download in tests.

- [ ] **Step 6: Commit**

```powershell
git add src/main/zvec-search/engine.ts test/zvec-search-engine.test.ts
git commit -m "feat(search): add local zvec root engine"
```

---

### Task 5: Add secure result revalidation and bounded formatting

**Files:**
- Create: `src/main/zvec-search/format.ts`
- Create: `test/zvec-search-format.test.ts`
- Create: `test/zvec-search-security.test.ts`

**Interfaces:**
- Consumes: raw zvec hits and the exact `readonly Root[]` authority from the current call.
- Produces: verified `SmartSearchHit[]` and `formatSmartSearchResponse(...)`.

- [ ] **Step 1: Write security RED tests**

Cover all of these cases before implementation:

```text
inside effective root -> accepted, virtual path returned
outside every effective root -> dropped/rejected
symlink/junction resolving outside -> dropped/rejected
stale result from a root no longer in current scope -> dropped/rejected
native source path text -> absent from formatted output
index/model-cache path -> absent from formatted output
output over 96 KiB -> truncated at item boundary with explicit note
```

On Windows create a junction/symlink test only where the existing sandbox test utilities support it; otherwise reuse the repository's existing containment fixture style so CI does not require elevation.

- [ ] **Step 2: Run both tests and verify RED**

Run:

```powershell
npx vitest run test/zvec-search-format.test.ts test/zvec-search-security.test.ts
```

- [ ] **Step 3: Implement verification through the existing sandbox**

The formatter must never trust string-prefix checks. For each hit, derive the owning approved root and use the existing `resolvePath`/`resolveIn` containment semantics to prove it. Return only the resulting virtual path.

Use a contract like:

```ts
export async function verifySearchHits(
  roots: readonly Root[],
  raw: readonly SmartSearchRawHit[]
): Promise<SmartSearchHit[]>;

export function formatSmartSearchResponse(response: SmartSearchResponse): string;
```

Format each accepted hit with virtual path, range, match route, and bounded source excerpt. Stop before `SMART_SEARCH_MAX_OUTPUT_BYTES` and append `output_truncated: true` when an additional hit would cross the cap.

- [ ] **Step 4: Verify GREEN and run existing sandbox tests**

Run:

```powershell
npx vitest run test/zvec-search-format.test.ts test/zvec-search-security.test.ts test/sandbox.test.ts test/workspace-scope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/main/zvec-search/format.ts test/zvec-search-format.test.ts test/zvec-search-security.test.ts
git commit -m "security(search): revalidate zvec results in workspace scope"
```

---

### Task 6: Orchestrate multi-root search, single-flight indexing, and bounded LRU

**Files:**
- Create: `src/main/zvec-search/manager.ts`
- Create: `test/zvec-search-manager.test.ts`

**Interfaces:**
- Consumes: validated `SmartSearchScope[]`, `SmartSearchRequest`, `openRootSearchEngine`.
- Produces: `createSmartSearchManager(options)` implementing `SmartSearchProvider`, plus `close()` for app lifecycle.

- [ ] **Step 1: Write RED concurrency/lifecycle tests**

Tests must prove:

- two simultaneous first queries for the same root call the engine factory once;
- different roots may initialize concurrently, capped at two active root searches per request;
- fifth retained idle service evicts and closes the least recently used service when max retained is four;
- an in-flight service is not closed until its search releases it;
- duplicate hits merge deterministically;
- `limit` applies after cross-root merge, not separately as an unbounded total;
- `close()` waits for/settles active work and closes every retained engine once.

- [ ] **Step 2: Run and verify RED**

Run `npx vitest run test/zvec-search-manager.test.ts`.

- [ ] **Step 3: Implement a small keyed manager**

Use explicit structures:

```ts
const pending = new Map<string, Promise<RootSearchEngine>>();
const live = new Map<string, { engine: RootSearchEngine; lastUsed: number; leases: number }>();
const MAX_LIVE_ENGINES = 4;
const ROOT_QUERY_CONCURRENCY = 2;
```

Do not add a filesystem watcher in this task. Let the engine's indexed context refresh behavior own freshness for v1.

- [ ] **Step 4: Implement deterministic merge**

Normalize each root-local rank to `1 / (60 + rank)` and sum scores for identical verified `(virtualPath,startLine,endLine)` keys. Sort by fused score descending, then virtual path, then start line. This gives stable cross-root order without comparing incomparable upstream raw scores directly.

- [ ] **Step 5: Verify GREEN**

Run the focused test repeatedly with `--repeat` or a small loop to catch race-sensitive failures; expected result is deterministic PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/zvec-search/manager.ts test/zvec-search-manager.test.ts
git commit -m "feat(search): manage bounded multi-root zvec search"
```

---

### Task 7: Add process-level initialization and shutdown ownership

**Files:**
- Create: `src/main/zvec-search/index.ts`
- Create: `test/zvec-search-lifecycle.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: Electron `userData` path after bootstrap.
- Produces: `initSmartSearch(userData)`, `smartSearchProvider()`, `shutdownSmartSearch()`.

- [ ] **Step 1: Write RED lifecycle tests**

Require:

```ts
expect(() => smartSearchProvider()).toThrow(/not initialized/i);
initSmartSearch(userData, { managerFactory: fakeFactory });
expect(smartSearchProvider()).toBe(fakeProvider);
await shutdownSmartSearch();
expect(fakeManager.close).toHaveBeenCalledTimes(1);
```

Also prove repeated shutdown is idempotent.

- [ ] **Step 2: Implement the process owner**

Keep the module free of Electron imports so it is testable. Initialization takes the already resolved `userData` string and constructs storage paths. No zvec dynamic import occurs here.

- [ ] **Step 3: Wire startup only after `userData` is finalized**

In `src/main/index.ts`, after lines that initialize config/secrets/session/durable stores from `userData`, call:

```ts
initSmartSearch(userData);
```

This operation creates no model and starts no scan.

- [ ] **Step 4: Add Smart Search close to shutdown process cleanup**

Extend the existing phase 2 cleanup array rather than creating an independent quit listener:

```ts
run: () => [
  unifiedExecManager.terminateAllProcesses(),
  stopComputerHelper(),
  shutdownSmartSearch()
]
```

- [ ] **Step 5: Run lifecycle and shutdown tests**

Run:

```powershell
npx vitest run test/zvec-search-lifecycle.test.ts test/shutdown.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/zvec-search/index.ts src/main/index.ts test/zvec-search-lifecycle.test.ts
git commit -m "feat(search): own zvec lifecycle in main process"
```

---

### Task 8: Inject Smart Search into the MCP context without global authority

**Files:**
- Modify: `src/main/mcp/kernel.ts`
- Modify: `src/main/connection.ts`
- Create: `test/zvec-search-tool.test.ts`

**Interfaces:**
- Consumes: `smartSearchProvider()` initialized by main.
- Produces: optional `ToolContext.smartSearch: SmartSearchProvider` visible only to Core tool registration.

- [ ] **Step 1: Write RED tests for the provider seam and caller identity**

Test that a Core context can carry a fake `smartSearch`, and that `needsWorkspaceIdentity('search', ...)` follows the same identity-sensitive path as `find`.

An MCP-level test must simulate an active Run with no proven caller and assert `search` returns `WORKSPACE_SCOPE_REQUIRED` before the fake provider is called.

- [ ] **Step 2: Modify `ToolContext` narrowly**

In `src/main/mcp/kernel.ts` add:

```ts
import type { SmartSearchProvider } from '../zvec-search/types.js';
```

Then add this property to the existing `ToolContext` interface after `exposedFind?: boolean`:

```ts
smartSearch?: SmartSearchProvider;
```

Add `'search'` to the filesystem tool set in `needsWorkspaceIdentity`.

- [ ] **Step 3: Supply the provider from `connection.ts`**

Import `smartSearchProvider` and add it to the context returned by `startMcpServer(() => ...)`:

```ts
return {
  roots: live.roots,
  caps: effectiveCapabilities(live),
  readOnly: live.readOnly,
  privacyScreenshots: live.ui.privacyScreenshots,
  smartSearch: smartSearchProvider()
};
```

Do not put `userData` or native cache paths in ToolContext.

- [ ] **Step 4: Run tests**

Run:

```powershell
npx vitest run test/zvec-search-tool.test.ts test/mcp-workspace-scope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/main/mcp/kernel.ts src/main/connection.ts test/zvec-search-tool.test.ts
git commit -m "security(search): bind smart search to MCP call authority"
```

---

### Task 9: Register the one model-facing `search` tool

**Files:**
- Modify: `src/main/mcp/tools-core.ts`
- Modify: `src/main/mcp/surfaces.ts`
- Modify: `src/main/connection.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/i18n/catalog.ts`
- Modify: `test/zvec-search-tool.test.ts`
- Modify: `test/mcp.test.ts`

**Interfaces:**
- Consumes: `ToolContext.smartSearch`, `effectiveRootsForCall`, `resolveIn`.
- Produces: Core tool `search` gated by capability `search`.

- [ ] **Step 1: Write the exact schema assertions first**

The test must require exactly these model-facing fields:

```text
query
path?
mode?
include?
file_types?
limit?
```

Assert there is no `root`, `home`, `embedding`, `apiKey`, `endpoint`, `rebuild`, `drop`, or `server` field.

Assert `search` is annotated read-only and closed-world.

- [ ] **Step 2: Write permission and surface RED tests**

Require:

- Search permission ON -> `search` appears;
- Search permission OFF on a fresh endpoint -> `search` absent;
- permission revoked after exposure -> cached tool remains registered but handler returns `TOOL_DISABLED` according to existing monotonic exposure semantics;
- `find` retains its old command-mutual-exclusion behavior;
- `search` is present whether command execution is on or off;
- Desktop never advertises `search`.

- [ ] **Step 3: Add `search` to Core declaration and setup tool projection**

Change Core's declared list to include `search` once:

```ts
tools: ['read', 'view_image', 'find', 'search', 'apply_patch', 'exec_command', 'write_stdin', 'session', 'agents']
```

In `connection.ts` `toolsFor('core')`, add `search` whenever `caps.search` is true, independently of `find`.

- [ ] **Step 4: Update capability metadata**

Use:

```ts
search: 'Find exact text and discover related code or documents by meaning.'
```

and:

```ts
search: ['read', 'find', 'search']
```

Keep localized renderer text semantically equivalent in Thai, e.g. “ค้นหาข้อความแบบตรงตัว และค้นหาโค้ดหรือเอกสารที่เกี่ยวข้องจากความหมาย”.

- [ ] **Step 5: Register the schema and handler in `tools-core.ts`**

Use Zod bounds:

```ts
const smartSearchSchema = z.object({
  query: z.string().min(1).max(2000),
  path: pathArg.optional(),
  mode: z.enum(SMART_SEARCH_MODES).optional(),
  include: z.array(z.string().min(1).max(300)).max(20).optional(),
  file_types: z.array(z.string().min(1).max(40)).max(20).optional(),
  limit: z.number().int().min(1).max(SMART_SEARCH_MAX_LIMIT).optional()
}).strict();
```

Handler sequence is fixed. Add this helper beside the registration code so every optional `path` becomes a sandbox-validated scope before the provider sees it:

```ts
async function smartSearchScopes(roots: readonly Root[], requested?: string): Promise<SmartSearchScope[]> {
  const inputs = requested === undefined ? roots.map((root) => `/${root.name}`) : [requested];
  const scopes: SmartSearchScope[] = [];
  for (const input of inputs) {
    const resolved = await resolveIn(roots, input);
    const stat = await fs.stat(resolved.real);
    const root = roots.find(
      (candidate) =>
        resolved.virtual === `/${candidate.name}` || resolved.virtual.startsWith(`/${candidate.name}/`)
    );
    if (!root) throw new SandboxError('Smart Search path did not resolve to an effective root.');
    if (!stat.isFile() && !stat.isDirectory()) {
      throw new SandboxError('Smart Search path must be a regular file or folder.');
    }
    scopes.push({
      root,
      realPath: resolved.real,
      virtualPath: resolved.virtual,
      kind: stat.isFile() ? 'file' : 'directory'
    });
  }
  return scopes;
}
```

Import `SmartSearchScope` as a type from `../zvec-search/types.js`. Then register the handler:

```ts
reg.guarded('search', 'search', async () => {
  const roots = effectiveRootsForCall(ctx);
  if (!ctx.smartSearch) return fail('SMART_SEARCH_UNAVAILABLE: local search engine is not initialized.');
  const scopes = await smartSearchScopes(roots, input.path);
  const response = await ctx.smartSearch.search(scopes, {
    query: input.query,
    mode: input.mode,
    include: input.include,
    fileTypes: input.file_types,
    limit: input.limit
  });
  noteCount(response.hits.length);
  return ok(formatSmartSearchResponse(response));
});
```

- [ ] **Step 6: Run focused MCP tests**

Run:

```powershell
npx vitest run test/zvec-search-tool.test.ts test/mcp.test.ts
```

Expected: PASS and old `find` tests remain unchanged except expected Core tool counts/list additions.

- [ ] **Step 7: Commit**

```powershell
git add src/main/mcp/tools-core.ts src/main/mcp/surfaces.ts src/main/connection.ts src/shared/types.ts src/shared/i18n/catalog.ts test/zvec-search-tool.test.ts test/mcp.test.ts
git commit -m "feat(mcp): expose secure smart workspace search"
```

---

### Task 10: Prove local-only behavior and failure isolation

**Files:**
- Modify: `src/main/zvec-search/engine.ts`
- Modify: `test/zvec-search-engine.test.ts`
- Modify: `test/zvec-search-security.test.ts`

**Interfaces:**
- Consumes: selected explicit local embedding model.
- Produces: a search subsystem that cannot silently choose remote embedding and cannot break exact search when unavailable.

- [ ] **Step 1: Write RED tests against ambient remote configuration**

Within the test process set values such as:

```ts
process.env.ZVEC_GREP_EMBEDDING = 'qwen/qwen3.7-text-embedding';
process.env.ZVEC_GREP_API_KEY = 'must-not-be-used';
process.env.ZVEC_GREP_ENDPOINT = 'https://example.invalid';
```

Assert the injected zvec factory still receives an explicit `embedding` beginning with `local/` and no `apiKey`/`endpoint` from ComGu.

- [ ] **Step 2: Add a provider-load failure test**

Make the lazy loader throw and assert only the `search` call returns `SMART_SEARCH_UNAVAILABLE`/safe failure. Build a Core server afterward and prove `read`, existing `find` or `exec_command`, and `session` registration are unaffected.

- [ ] **Step 3: Harden the engine construction**

Set the chosen model explicitly in every `createZvecGrep` call. Do not read a zvec default model in ComGu code. Do not pass remote authorization flags.

- [ ] **Step 4: Verify tests**

Run:

```powershell
npx vitest run test/zvec-search-engine.test.ts test/zvec-search-security.test.ts test/zvec-search-tool.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/main/zvec-search/engine.ts test/zvec-search-engine.test.ts test/zvec-search-security.test.ts
git commit -m "security(search): force local embedding policy"
```

---

### Task 11: Benchmark Thai/English retrieval and choose the default local model

**Files:**
- Create: `test/fixtures/zvec-search-corpus/**`
- Create: `scripts/benchmark-zvec-search.mjs`
- Create: `docs/performance/2026-09-06-zvec-search-model-benchmark.md`
- Modify: `src/main/zvec-search/engine.ts`

**Interfaces:**
- Consumes: two candidate models and a frozen query/expected-file manifest.
- Produces: one measured `DEFAULT_SMART_SEARCH_EMBEDDING` constant.

- [ ] **Step 1: Freeze the corpus before running either model**

Create at least 12 small source/docs files representing authentication, workspace scope, terminal authority, session persistence, shutdown, and UI config flows. Add `queries.json` with 20 entries of this exact shape:

```json
{
  "id": "th-workspace-authority",
  "language": "th",
  "query": "ส่วนไหนเป็นตัวจำกัด worker ไม่ให้ออกนอก workspace ที่ prime อนุญาต",
  "expectedFiles": ["security/workspace-scope.ts", "security/worker-authority.ts"]
}
```

Use 10 Thai and 10 English questions. Do not change expected files after seeing model results unless the fixture itself is factually wrong; record such a correction in git history.

- [ ] **Step 2: Implement the benchmark runner**

For each model:

```text
local/potion-code-16m-v2
local/potion-multilingual-128m
```

the script must build a fresh temporary index, run every query, and output JSON containing top1/top5 hit, elapsedMs, indexMs, indexBytes, and RSS delta.

- [ ] **Step 3: Run both candidates on the same machine and environment**

Run:

```powershell
node scripts/benchmark-zvec-search.mjs --embedding local/potion-code-16m-v2 --out .bench-zvec-code.json
node scripts/benchmark-zvec-search.mjs --embedding local/potion-multilingual-128m --out .bench-zvec-multilingual.json
```

Expected: both complete with 20 query records. If a first-run model download occurs, report download time separately from index/query timing.

- [ ] **Step 4: Select by the fixed gate**

Choose the smallest model that achieves:

- overall top-5 target-file hit rate >= 90%;
- Thai top-5 >= 80%;
- English top-5 >= 80%.

If both meet the gate, choose the smaller/lower-RSS model. If only one meets it, choose that one. If neither meets it, run the same frozen corpus once with `local/multilingual-e5-small`. If that third candidate also misses the gate, stop the Smart Search release at this task and record the failed quality gate instead of selecting a weak default.

- [ ] **Step 5: Record results and freeze the constant**

Write the measured table into `docs/performance/2026-09-06-zvec-search-model-benchmark.md`. Set `DEFAULT_SMART_SEARCH_EMBEDDING` to exactly one of these literals according to the measured decision above: `local/potion-code-16m-v2`, `local/potion-multilingual-128m`, or `local/multilingual-e5-small`. If none passes, do not set a release default and do not proceed to packaging/release tasks until the quality design is revised.

- [ ] **Step 6: Commit**

```powershell
git add test/fixtures/zvec-search-corpus scripts/benchmark-zvec-search.mjs docs/performance/2026-09-06-zvec-search-model-benchmark.md src/main/zvec-search/engine.ts
git commit -m "perf(search): select measured local embedding model"
```

---

### Task 12: Add Apache attribution and packaging smoke

**Files:**
- Create or Modify: `THIRD-PARTY-NOTICES.md`
- Modify: `electron-builder.yml`
- Create: `test/zvec-search-packaging.test.ts`
- Modify: `README.md`
- Modify: `docs/tool-surface.md`

**Interfaces:**
- Consumes: pinned package metadata/license.
- Produces: compliant packaged notice, no bundled embedding model, documented usage boundary.

- [ ] **Step 1: Write packaging RED tests**

Test the packaging config statically for:

- `THIRD-PARTY-NOTICES.md` included as an extra resource;
- no `search/models` directory bundled;
- no zvec daemon executable/server configuration added;
- package version pinned, not a range.

- [ ] **Step 2: Add the notice**

Include at minimum:

```text
zvec-grep
Copyright its respective contributors
Licensed under the Apache License, Version 2.0
Source: https://github.com/zvec-ai/zvec-grep
```

Then inspect the installed package's license files and append any attribution required by redistributed transitive assets. Do not delete the project's existing MIT license.

- [ ] **Step 3: Include the notice in packaging**

Add an `extraResources` entry mapping the notice to `THIRD-PARTY-NOTICES.md` for all platforms.

- [ ] **Step 4: Document user behavior**

README/tool-surface docs must state:

- exact literal/regex search -> `find`/`rg`;
- conceptual/cross-file search -> `search`;
- Smart Search initializes on first use;
- local model/index stay on the machine;
- model download is separate from base installation;
- no zvec URL/daemon setup is required.

- [ ] **Step 5: Package Windows x64 and inspect**

Run:

```powershell
npm run dist:x64
```

Expected: installer and unpacked app build successfully; notice exists in packaged resources; the base package does not contain downloaded model files.

- [ ] **Step 6: Commit**

```powershell
git add THIRD-PARTY-NOTICES.md electron-builder.yml test/zvec-search-packaging.test.ts README.md docs/tool-surface.md
git commit -m "docs(search): ship local search notices and guidance"
```

---

### Task 13: Run the security and regression gate

**Files:**
- Modify only if a failing test exposes a real integration defect; do not weaken tests to make this task green.

**Interfaces:**
- Consumes: completed Tasks 1-12.
- Produces: verified integration candidate.

- [ ] **Step 1: Run all Smart Search tests**

```powershell
npx vitest run test/zvec-search-*.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run workspace and terminal security suites**

```powershell
npx vitest run test/terminal-workspace-security.test.ts test/workspace-scope.test.ts test/chat-workspace-scope.test.ts
```

Expected: all PASS with no scope widening.

- [ ] **Step 3: Run full CI-equivalent verification**

```powershell
npm run verify:ci
```

Expected: exit 0.

- [ ] **Step 4: Run build and diff hygiene**

```powershell
npm run typecheck
npm run build
git diff --check
```

Expected: exit 0 for all commands.

- [ ] **Step 5: Perform packaged first-use smoke**

Launch the packaged Windows x64 application with isolated test `userData`, approve a fixture workspace, connect to the local Core endpoint, and verify in order:

1. `tools/list` contains `search` and the expected existing tools;
2. no model files exist before first `search`;
3. first `search` creates only app-private model/index state;
4. repository `git status` remains unchanged by indexing;
5. second `search` reuses the index and returns virtual paths;
6. an out-of-scope query cannot surface a canary path/content;
7. exact `find` or `rg` still works;
8. app shutdown exits cleanly with no zvec daemon/process left behind.

- [ ] **Step 6: Commit only real verification fixes, then record the verified SHA**

If no fix is needed, do not create an empty commit. Record the final tested SHA in the release checklist when implementation is later published.

---

## Plan Self-Review Checklist

- Spec coverage: direct API, one tool, authority, result revalidation, private index, lazy load, local-only model, multi-root behavior, shutdown, packaging, benchmark, and rollback all have explicit tasks.
- Incompleteness scan: implementation steps contain concrete types, paths, commands, limits, and acceptance rules; no unresolved implementation marker remains.
- Type consistency: `SmartSearchRequest`, `SmartSearchProvider`, `SmartSearchResponse`, `RootSearchEngine`, storage functions, and lifecycle functions are named once and reused consistently across tasks.
- Scope discipline: this plan does not perform the separate packaging-size optimization beyond what is required to package the new dependency correctly.
