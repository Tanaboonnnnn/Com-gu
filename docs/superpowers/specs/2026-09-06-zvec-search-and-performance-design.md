# Zvec Search Integration and Performance Design

**Date:** 2026-09-06

**Status:** Approved design basis for planning only. No production implementation is part of this document change.

## 1. Objective

Extend ComGu Core with local semantic/hybrid workspace search powered by `@zvec/zvec-grep` while preserving ComGu as the sole authorization boundary. In parallel, make ComGu lighter and faster where measurements prove it is safe, without trading away correctness, security, stability, or supported platform behavior merely to reduce bytes.

This design produces two independently executable implementation plans:

1. `docs/superpowers/plans/2026-09-06-zvec-search-integration.md`
2. `docs/superpowers/plans/2026-09-06-comgu-performance-and-footprint-optimization.md`

The search integration can ship without the footprint optimization. The optimization can also be applied and verified independently of Smart Search.

## 2. Priority Order

When two goals conflict, use this order:

1. correctness;
2. security and authority preservation;
3. stability and recoverable failure behavior;
4. search quality;
5. startup, memory, and runtime performance;
6. installed footprint;
7. installer download size.

Installed size is a soft goal, not a release blocker. A build may be larger than ComGu 3.1.1 if the added functionality is useful and the measured runtime remains healthy. No supported runtime dependency may be removed merely to win a size target.

## 3. Baseline Observations

The current ComGu 3.1.1 Windows x64 build was measured before this design:

- installer: about 157.56 MiB;
- unpacked `app.asar`: about 13.82 MiB;
- unpacked native/runtime payload: about 109.91 MiB;
- tunnel resources in the unpacked build: about 57.57 MiB;
- bundled ripgrep resources: about 4.39 MiB;
- `@microsoft/mxc-sdk`: about 65.08 MiB in the unpacked app;
- `@img/sharp-win32-x64`: about 18.31 MiB;
- `tree-sitter-bash`: about 12.50 MiB;
- `node-pty`: about 12.09 MiB.

The measurements also showed likely removable packaging-only material, including x64 packages carrying MXC payloads for the other CPU architecture, Windows PDB files in `node-pty`, and parser/build source inside `tree-sitter-bash`. Those are optimization candidates, not assumptions: every removal must be proved by packaged-runtime tests.

## 4. Search Architecture

### 4.1 Data flow

The accepted path is:

```text
ChatGPT
   |
   v
ComGu Core MCP
   |
   +-- exact search: existing find / bundled rg
   |
   +-- semantic search: new search tool
                         |
                         v
                   ComGu Smart Search adapter
                         |
                 authority + path validation
                         |
                         v
                  @zvec/zvec-grep API
                         |
                         v
                     local index
```

ComGu does **not** connect to the zvec MCP endpoint, does not start zvec's HTTP daemon, and does not expose zvec's administrative MCP tools. The integration imports the published engine API lazily and invokes it in-process.

### 4.2 Why direct API integration

Direct API integration avoids an additional localhost port, authentication layer, daemon lifecycle, health surface, and MCP-to-MCP translation layer. It also means there is no zvec URL for the user to configure or keep stable. Smart Search should feel like a built-in ComGu capability.

The integration pins one reviewed `@zvec/zvec-grep` release in `package-lock.json`. ComGu owns the adapter contract so upstream changes are localized to one subsystem.

### 4.3 Tool surface

Keep the existing `find` behavior intact. Add exactly one new Core tool:

```ts
type SmartSearchMode = 'auto' | 'hybrid' | 'lexical' | 'semantic';

interface SmartSearchRequest {
  query: string;
  path?: string;
  mode?: SmartSearchMode;
  include?: string[];
  file_types?: string[];
  limit?: number;
}
```

`search` is for concept discovery, unknown wording/location, architecture exploration, data/control flow, and cross-file synthesis. Exact names, regexes, literal occurrences, and exhaustive searches remain the job of `find` or `rg` through `exec_command`.

The schema intentionally does not contain:

- a native `root` field;
- index-create/drop/rebuild actions;
- a model/provider/API-key field;
- a server URL;
- remote embedding authorization;
- daemon controls.

Those are implementation details or administrative operations and do not belong in a model-facing primitive.

## 5. Authority Model

### 5.1 ComGu remains the authority

The search index is never authorization. Every request must derive its roots from the same call authority used by other ComGu filesystem tools:

```ts
const roots = effectiveRootsForCall(ctx);
```

The model cannot widen that set. A supplied `path` is resolved by `resolveIn(roots, path)` before any zvec call.

### 5.2 Identity requirement

`search` is a filesystem operation and therefore belongs in `needsWorkspaceIdentity(...)` alongside `read`, `view_image`, `find`, `apply_patch`, `exec_command`, and `write_stdin`.

This preserves:

- exact ChatGPT conversation workspace selection;
- manual Desktop fallback when there is no proven conversation;
- Prime/Run immutable workspace ceilings;
- Worker subset scopes;
- retired/dormant worker identity fences.

No special zvec identity system is introduced.

### 5.3 Result revalidation

Every result returned by zvec is treated as untrusted retrieval output. Before formatting a hit for the model, ComGu must:

1. canonicalize the returned absolute path;
2. resolve it against the same effective roots for the call;
3. reject symlink/junction escapes using the existing sandbox path resolver;
4. convert the verified real path to a virtual ComGu path;
5. drop or reject any result that cannot be proven inside the current scope.

Native host paths must never be returned to the model.

## 6. Index Storage and Root Identity

zvec normally keeps `.zvec-grep` below its logical root. ComGu must not dirty a user's repository merely because Search permission is enabled.

Use an application-private synthetic root for each approved root identity:

```text
<userData>/search/
  models/
  indexes/
    <stable-root-id>/
      workspace/
        .zvec-grep/
```

The zvec logical `root` is `.../<stable-root-id>/workspace`. The actual approved filesystem root is supplied through zvec's `rootPaths` index option.

The stable root id is derived from a versioned digest of the canonical approved-root identity, never from a model-controlled string. A rename of the virtual root name must not silently alias a different native directory. A change in native identity creates a new index identity rather than reusing stale data from a previously approved folder.

Indexes belonging to roots that are no longer approved may remain on disk as inert cache data, but they can never be queried because request authority is always computed from live approved roots. Cache pruning is an application-maintenance concern, not a model-facing operation.

## 7. Index Lifecycle

### 7.1 Lazy initialization

Smart Search has zero startup work before first use:

- do not import `@zvec/zvec-grep` at application startup;
- do not load an embedding model during startup;
- do not scan workspaces during startup;
- do not start a watcher or daemon during startup.

The first `search` call lazily loads the module, initializes the per-root service, and prepares an index if needed.

### 7.2 First-use indexing

For each effective root involved in a request:

1. resolve the app-private index location;
2. construct the zvec service with an explicit local embedding model and explicit model cache path;
3. call `info()`;
4. if no index exists, call `index({ rootPaths: [approvedRoot], ...safePolicy })`;
5. run the indexed query;
6. cache the live service in a bounded in-memory LRU.

Index creation must be single-flight per root so two simultaneous ChatGPT searches do not build the same index twice.

### 7.3 Refresh

Version 1 uses zvec's normal indexed refresh path rather than adding a second ComGu watcher system. Query execution requests automatic refresh where supported and the benchmark records fresh-versus-stale behavior. If upstream refresh proves too costly, a later change may add a bounded debounce or file-change feed after measuring it; this version does not invent one pre-emptively.

### 7.4 Bounded active services

Keep at most four live zvec services in memory. The least recently used idle service is closed before a fifth is retained. Concurrent searches may temporarily pin an active service so an in-flight request is never closed underneath itself.

Application shutdown closes all retained services before durable writers finish. A failure to close one search cache must be logged and must not block shutdown indefinitely.

## 8. Embedding Policy

Version 1 is local-only.

The initial candidates are:

- `local/potion-code-16m-v2` for compact code-focused retrieval;
- `local/potion-multilingual-128m` for stronger Thai/multilingual query coverage.

The implementation plan includes a fixed Thai/English benchmark corpus. The chosen default is the smallest candidate that meets the retrieval-quality gate. This decision is recorded from measurements rather than hard-coded from documentation alone.

Model files are downloaded on first Smart Search use and cached under `<userData>/search/models`. They are not bundled in the base installer and are reported separately from the application's installed footprint.

Remote embedding is out of scope for version 1. ComGu must not accept a remote model from the tool schema and must not silently select a remote provider because of ambient zvec configuration. The adapter passes an explicit `local/...` model reference.

## 9. Search Routing and Result Shape

### 9.1 Mode mapping

The adapter maps the compact ComGu modes to zvec query routes:

- `auto`: default hybrid route chosen for conceptual retrieval;
- `hybrid`: lexical + vector candidates fused by zvec;
- `lexical`: indexed lexical/BM25/FTS route only;
- `semantic`: vector route only.

`auto` is the default so the model normally states the question, not an implementation strategy.

### 9.2 Multi-root behavior

If the current WorkspaceScope contains multiple roots and no `path` narrows the request, search each effective root with concurrency 2. Merge results deterministically using normalized rank plus stable root/path ordering. Never create one combined index whose source set exceeds an individual root identity; separate indexes make scope revocation and result auditing simpler.

### 9.3 Output limits

Default `limit` is 8; maximum is 20. The formatter caps the complete text response at 96 KiB. Each result includes:

```text
/project/src/auth/service.ts:41-68
matched: semantic+lexical
source:
41  ...
```

The response ends with compact metadata: roots searched, results returned, freshness summary, and elapsed milliseconds. It must not echo model cache paths, native workspace paths, index paths, provider credentials, or zvec internal home paths.

## 10. Permissions and Product UI

Reuse the existing `search` capability and `Search files` permission. Do not add a second permission checkbox solely for semantic search.

Update the permission description from exact-search-only wording to explain that Search covers exact and meaning-based workspace search. `CAPABILITY_TOOLS.search` includes the new `search` tool while preserving `find` where its existing exposure rule applies.

The Core setup card/tool list must show `search` whenever Search permission is exposed. The Core connector remains one connector; no new tunnel ID or setup step is introduced.

## 11. Failure Behavior

Failures are local and explicit:

- missing model download/network on first use: `search` fails with an actionable message; existing exact `find`/`rg` remains available;
- index corruption: one controlled rebuild attempt may be offered/triggered by ComGu internal policy only after the error is classified as recoverable; repeated corruption returns an error rather than looping;
- zvec import/native load failure: report Smart Search unavailable; do not fail the whole MCP server;
- root revoked while a search is running: final result revalidation drops results no longer authorized;
- unsupported file or extraction failure: omit that item and include bounded diagnostics, never abort unrelated root results;
- shutdown during indexing: abort where the API permits, close the service, and leave a future call able to retry.

No failure may fall back to a remote embedding service.

## 12. Dependency and License Policy

Pin the reviewed `@zvec/zvec-grep` package version in `package-lock.json`. Record Apache-2.0 attribution in the repository's third-party notices and make sure packaged builds carry the required notice/license material.

Do not vendor the entire `zvec-ai/zvec-grep` Git repository. A future upstream upgrade should normally be a dependency version change plus adapter/test updates.

## 13. Performance and Footprint Design

### 13.1 Measure before removing

Every optimization follows:

```text
baseline -> hypothesis -> targeted change -> package -> packaged smoke -> benchmark -> keep/revert
```

No broad dependency cleanup is accepted without a measured runtime or size reason.

### 13.2 Runtime performance goals

The optimization pass targets:

- no eager Smart Search model/import cost on ordinary startup;
- no material regression in Core MCP discovery latency;
- no material regression in exact `find`/`rg` latency;
- stable or lower idle RSS where practical;
- fewer unnecessary packaged files and target-foreign native assets;
- unchanged supported feature behavior.

### 13.3 Size candidates

The first candidates are packaging-only:

1. stage only the target architecture from `@microsoft/mxc-sdk` if runtime smoke proves the SDK does not require cross-architecture helpers;
2. omit `.pdb` debug symbols from production `node-pty` payloads;
3. stage runtime-only `tree-sitter` and `tree-sitter-bash` files instead of C sources/build metadata where package-runtime tests prove the native parser loads;
4. narrow `asarUnpack` to files that actually require real filesystem presence;
5. eliminate duplicate target-native copies only after proving the loader resolves the intended packaged path.

Tunnel binaries, MXC confinement, terminal support, image decoding, extension support, and platform targets are not candidates for removal merely because they are large.

### 13.4 Benchmark gates

Use the pre-change packaged build as the baseline. The final optimization may ship only if:

- `npm run verify:ci` passes;
- `npm run typecheck` and `npm run build` pass;
- packaged Windows x64 smoke passes;
- startup median across 10 cold launches is no worse than baseline + max(100 ms, 5%);
- idle RSS median after 30 seconds across 5 launches is no worse than baseline + max(20 MiB, 10%);
- Core MCP tools/list median latency is no worse than baseline + 10%;
- exact search p50 and p95 are no worse than baseline + 10%;
- Smart Search code is not loaded before first `search` call;
- installed-footprint delta and top contributors are reported, whether positive or negative.

An optimization that saves size but violates a runtime gate is reverted.

## 14. Search Quality Gate

The search benchmark includes at least 20 fixed conceptual questions:

- 10 English queries;
- 10 Thai queries;
- code architecture, data flow, security boundary, configuration ownership, and lifecycle questions;
- expected target files defined before running the model comparison.

For each candidate embedding model record:

- top-1 and top-5 target-file hit rate;
- median and p95 query latency after warmup;
- initial index duration;
- index bytes on disk;
- process RSS delta after model load.

The selected default must achieve at least 90% top-5 target-file hit rate across the fixed corpus and at least 80% separately in both Thai and English subsets. If neither candidate meets those thresholds, keep Smart Search behind the existing Search permission but do not claim the model decision complete; evaluate the next smallest local multilingual/code candidate before release.

## 15. Testing Strategy

The integration must add focused tests for:

- tool schema and surface declaration;
- permission gating and monotonic exposure;
- workspace/chat/Prime/Worker authority;
- no arbitrary root input;
- synthetic index path outside repository;
- stable root identity and non-aliasing after root change;
- lazy module/model loading;
- single-flight first index;
- bounded LRU service lifecycle;
- multi-root merge;
- path/symlink/junction result revalidation;
- native path redaction;
- local-only embedding selection;
- failure isolation;
- shutdown cleanup;
- packaging and third-party notice presence.

Existing MCP, terminal security, workspace scope, session, agent, renderer, and packaging suites remain mandatory regression gates.

## 16. Non-Goals

This change does not:

- replace `read`;
- remove existing exact `find` or bundled `rg`;
- expose zvec's MCP daemon;
- add a third ComGu connector;
- add remote embeddings;
- add model/provider/API-key settings;
- allow GPT to rebuild/drop indexes;
- write `.zvec-grep` into user repositories;
- redesign ComGu's workspace authority;
- remove supported tunnel or sandbox features for size;
- promise a smaller installer if measurements say otherwise.

## 17. Rollback Boundary

Smart Search must be removable as one bounded subsystem: dependency, `src/main/zvec-search/`, one ToolContext seam, one MCP registration block, one surface/capability metadata update, lifecycle initialization/shutdown, tests, and notices. Existing exact search continues to work if the subsystem is disabled or reverted.

The optimization plan uses independent commits for each packaging/runtime change so any regression can be reverted without undoing unrelated improvements.
