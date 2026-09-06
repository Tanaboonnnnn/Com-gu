# ComGu Performance and Footprint Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ComGu start, idle, and execute common local-tool workflows as lightly and quickly as practical while safely removing production-package dead weight; preserve every supported security and runtime feature even when that means the final installed footprint is not smaller.

**Architecture:** Establish reproducible packaged-runtime baselines first, then make one independently reversible optimization at a time. Favor packaging-time target pruning and lazy loading over architectural feature removal. Every candidate must pass full security/regression tests plus packaged smoke and quantitative startup/RSS/tool-latency gates before it is kept.

**Tech Stack:** Electron 43, electron-builder 26, TypeScript, Node 22 runtime APIs, MXC SDK 0.8, node-pty, Sharp, tree-sitter, Vitest, PowerShell/Node benchmark scripts.

## Global Constraints

- Correctness, security, and stability outrank size.
- Installed footprint is a soft goal; do not claim failure solely because added functionality makes a release larger.
- Do not remove MXC sandbox enforcement, terminal PTY support, image decoding, extension resources, supported connection methods, or a supported release architecture to save space.
- Do not change user-visible feature behavior unless a measured performance defect requires it and a separate design is approved.
- Optimize only files/dependencies proven unnecessary in packaged runtime for the specific target.
- Never mutate `node_modules` in place as the release product source of truth; build verified target-specific staging payloads under `resources/packaging/`.
- Keep each optimization in its own commit so it can be reverted independently.
- Benchmark the packaged build, not only development Electron.
- Compare on the same machine, power mode, architecture, Electron version, fixture, and measurement script.
- A size win that fails a runtime/security/stability gate is reverted.
- No sub-agent execution is required for this user's workflow; use inline `executing-plans` when implementing unless the user later asks otherwise.

---

## File Structure

Create measurement tooling before optimization code:

- `scripts/measure-package-footprint.mjs` — deterministic file/category byte inventory for an unpacked package and installer.
- `scripts/benchmark-packaged-startup.mjs` — launches isolated packaged ComGu and records ready timing/RSS.
- `scripts/benchmark-mcp-latency.mjs` — measures tools/list and exact-search latency against an isolated packaged runtime.
- `src/main/perf-marker.ts` — test/benchmark-only opt-in ready marker with no normal-run file writes.
- `test/perf-marker.test.ts` — proves benchmark instrumentation is inert unless explicitly enabled.
- `docs/performance/2026-09-06-comgu-3.1.1-baseline.md` — immutable baseline table and environment.
- `docs/performance/2026-09-06-optimization-results.md` — before/after table for each kept/reverted candidate.

Modify packaging only through:

- `scripts/prepare-packaging-native.mjs`
- `scripts/package.mjs`
- `electron-builder.yml`
- focused packaging tests under `test/packaging-*.test.ts`

Avoid broad changes to application logic unless measurement identifies an eager-load path; those changes receive focused tests and their own commit.

---

### Task 1: Freeze reproducible package and runtime baselines

**Files:**
- Create: `scripts/measure-package-footprint.mjs`
- Create: `test/package-footprint-script.test.ts`
- Create: `docs/performance/2026-09-06-comgu-3.1.1-baseline.md`

**Interfaces:**
- Consumes: installer path plus unpacked application directory.
- Produces: stable JSON/console metrics: total bytes, app.asar bytes, app.asar.unpacked bytes, extraResources bytes, and top 30 files/directories.

- [ ] **Step 1: Write RED tests for footprint categorization**

Use a temporary fake package tree and require output such as:

```json
{
  "totalBytes": 60,
  "categories": {
    "appAsar": 10,
    "appAsarUnpacked": 20,
    "extraResources": 30
  }
}
```

The script must sort paths deterministically and use raw bytes internally; human MiB formatting is presentation only.

- [ ] **Step 2: Implement the measurement script**

Export reusable functions for tests and keep CLI parsing at the bottom. Use a deterministic byte walker rather than shell-dependent directory-size output:

```js
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export async function measureTree(root) {
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolute);
      files.push({
        path: path.relative(root, absolute).replaceAll('\\', '/'),
        bytes: info.size
      });
    }
  }

  await walk(root);
  return {
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0)
  };
}

export async function measurePackage({ installer, unpacked }) {
  const tree = await measureTree(unpacked);
  const installerBytes = (await stat(installer)).size;
  const sumPrefix = (prefix) =>
    tree.files
      .filter((file) => file.path.startsWith(prefix))
      .reduce((sum, file) => sum + file.bytes, 0);
  const appAsar = tree.files.find((file) => file.path === 'resources/app.asar')?.bytes ?? 0;
  const appAsarUnpacked = sumPrefix('resources/app.asar.unpacked/');

  return {
    installerBytes,
    totalBytes: tree.totalBytes,
    categories: {
      appAsar,
      appAsarUnpacked,
      extraResources: tree.totalBytes - appAsar - appAsarUnpacked
    },
    files: tree.files
  };
}
```

Ignore filesystem timestamps; measurement is byte-based.

- [ ] **Step 3: Verify test GREEN**

Run `npx vitest run test/package-footprint-script.test.ts`.

- [ ] **Step 4: Rebuild the unoptimized baseline from the current verified source**

Run:

```powershell
npm run dist:x64
node scripts/measure-package-footprint.mjs --installer release/ComGu-Setup-x64.exe --unpacked release/win-unpacked --json .perf-baseline-footprint.json
```

Record exact raw byte counts in the baseline document. Preserve the previously observed ~157.56 MiB installer as historical context, but the fresh script result becomes the comparison source of truth.

- [ ] **Step 5: Record environment**

In the baseline document include:

```text
git SHA
ComGu version
Electron version
Node version
Windows build
CPU architecture
RAM
power mode
package command
measurement script SHA/commit
```

- [ ] **Step 6: Commit tooling and baseline**

```powershell
git add scripts/measure-package-footprint.mjs test/package-footprint-script.test.ts docs/performance/2026-09-06-comgu-3.1.1-baseline.md
git commit -m "perf: record packaged footprint baseline"
```

---

### Task 2: Measure packaged cold startup and idle RSS without changing normal behavior

**Files:**
- Create: `src/main/perf-marker.ts`
- Create: `test/perf-marker.test.ts`
- Modify: `src/main/index.ts`
- Create: `scripts/benchmark-packaged-startup.mjs`
- Modify: `docs/performance/2026-09-06-comgu-3.1.1-baseline.md`

**Interfaces:**
- Consumes: opt-in env `COMGU_PERF_MARKER_FILE` only in benchmark launches.
- Produces: one JSON ready marker plus parent-side startup/RSS samples.

- [ ] **Step 1: Write RED tests proving instrumentation is inert by default**

Require:

```ts
expect(perfMarkerPath({})).toBeNull();
expect(perfMarkerPath({ COMGU_PERF_MARKER_FILE: 'C:\\tmp\\ready.json' })).toBe('C:\\tmp\\ready.json');
```

and prove `writePerfReadyMarker` does no write when the variable is absent.

- [ ] **Step 2: Implement the opt-in marker**

The marker JSON should contain only:

```ts
interface PerfReadyMarker {
  pid: number;
  readyAtEpochMs: number;
}
```

No user paths, config, credentials, workspace names, or session content.

- [ ] **Step 3: Emit the marker at the existing `logInfo('app started')` point**

Call `void writePerfReadyMarker(process.env)` immediately after the app has completed normal bootstrap/tray creation. The default path performs only the environment lookup and returns.

- [ ] **Step 4: Implement the parent benchmark**

`scripts/benchmark-packaged-startup.mjs` must:

1. create a fresh temporary userData/config fixture;
2. launch `release/win-unpacked/ComGu.exe` 10 times serially;
3. measure process spawn -> ready marker;
4. wait 30 seconds for runs selected for memory sampling;
5. record working set/RSS for 5 runs using an OS query from the parent, not app self-report;
6. terminate only the exact child PID tree created by the script;
7. emit median/min/max and raw samples as JSON.

- [ ] **Step 5: Capture baseline**

Run the packaged benchmark twice; if medians differ by more than 10%, investigate environmental noise before recording. Store the accepted sample set in the baseline document.

- [ ] **Step 6: Commit**

```powershell
git add src/main/perf-marker.ts src/main/index.ts test/perf-marker.test.ts scripts/benchmark-packaged-startup.mjs docs/performance/2026-09-06-comgu-3.1.1-baseline.md
git commit -m "perf: measure packaged startup and idle memory"
```

---

### Task 3: Measure MCP discovery and exact-search latency

**Files:**
- Create: `scripts/benchmark-mcp-latency.mjs`
- Create: `test/benchmark-mcp-latency.test.ts`
- Create: `test/fixtures/perf-search/**`
- Modify: `docs/performance/2026-09-06-comgu-3.1.1-baseline.md`

**Interfaces:**
- Consumes: isolated local Core MCP URL and a fixed approved fixture root.
- Produces: p50/p95 for initialize+tools/list and exact search, with raw samples.

- [ ] **Step 1: Freeze the exact-search fixture**

Create deterministic text/code files totaling at least 5 MiB and a query manifest with known literal matches. Include common ignored folders (`node_modules`, `dist`) to ensure default exclusions are represented.

- [ ] **Step 2: Write RED tests for percentile math and output schema**

Require a pure `percentile(samples, p)` helper and a JSON result containing `count`, `p50Ms`, `p95Ms`, and `samplesMs` for each operation.

- [ ] **Step 3: Implement benchmark client**

Use the MCP client transport already present in dependencies rather than shelling out to curl. Run at least 30 tools/list samples and 30 exact-search samples after 5 warmups.

- [ ] **Step 4: Record baseline**

Store p50/p95 plus raw JSON filename/hash in the baseline document.

- [ ] **Step 5: Commit**

```powershell
git add scripts/benchmark-mcp-latency.mjs test/benchmark-mcp-latency.test.ts test/fixtures/perf-search docs/performance/2026-09-06-comgu-3.1.1-baseline.md
git commit -m "perf: baseline MCP and exact search latency"
```

---

### Task 4: Stage only the target MXC architecture

**Files:**
- Modify: `scripts/prepare-packaging-native.mjs`
- Modify: `electron-builder.yml`
- Create: `test/packaging-mxc-prune.test.ts`
- Create: `docs/performance/2026-09-06-optimization-results.md`

**Interfaces:**
- Consumes: installed `@microsoft/mxc-sdk` plus explicit packaging `(platform, arch)`.
- Produces: verified staged runtime tree containing only files needed by that target architecture.

- [ ] **Step 1: Write a RED inventory test against the current package**

For a Windows x64 staged payload require:

```text
required x64 MXC runtime/helper files exist
arm64 MXC binaries do not exist
package JS/metadata required by require/import resolution exists
```

For Windows arm64 invert the architecture assertion. For macOS/Linux use the package's documented/runtime file layout rather than guessing Windows names.

- [ ] **Step 2: Add a generic verified-copy helper**

Extend `prepare-packaging-native.mjs` so MXC is copied to the target staging tree rather than broadly unpacked from ordinary `node_modules`. The source `node_modules` remains untouched.

The filter must be an explicit allowlist derived from the package's runtime loader/import graph plus the target's architecture folder; do not implement “copy everything except strings containing arm64”.

- [ ] **Step 3: Point electron-builder at staged MXC**

Exclude broad `node_modules/@microsoft/mxc-sdk/**/*` from normal packaged files and re-add the verified staged target tree under the same runtime module path.

- [ ] **Step 4: Run focused packaging test and full terminal security test**

```powershell
npx vitest run test/packaging-mxc-prune.test.ts test/terminal-workspace-security.test.ts
```

Expected: PASS.

- [ ] **Step 5: Build packaged x64 and run MXC production smoke**

Run `npm run dist:dir:x64`, then execute the existing packaged command-sandbox smoke against `release/win-unpacked`.

The smoke must cover host-preparation detection, one allowed child command inside scope, and one denied canary access outside scope.

- [ ] **Step 6: Measure and keep/revert**

Measure footprint, startup, RSS, and MCP/exact-search metrics. Keep this commit only if all hard gates pass. Record byte delta and runtime deltas in `optimization-results.md`.

- [ ] **Step 7: Commit the kept candidate**

```powershell
git add scripts/prepare-packaging-native.mjs electron-builder.yml test/packaging-mxc-prune.test.ts docs/performance/2026-09-06-optimization-results.md
git commit -m "perf(package): stage target-only MXC runtime"
```

---

### Task 5: Remove production PDB debug symbols from node-pty staging

**Files:**
- Modify: `scripts/prepare-packaging-native.mjs`
- Create: `test/packaging-node-pty-runtime.test.ts`
- Modify: `docs/performance/2026-09-06-optimization-results.md`

**Interfaces:**
- Consumes: the target-specific `node-pty/prebuilds` directory selected by `nativePrebuildDir(platform, arch)`.
- Produces: production prebuild directory containing runtime binaries/helpers but no `.pdb` files.

- [ ] **Step 1: Write RED packaged-tree test**

On Windows x64 require:

```text
conpty.node exists
conpty_console_list.node exists
conpty/OpenConsole.exe exists
conpty/conpty.dll exists when required by package version
no *.pdb exists in staged node-pty tree
```

- [ ] **Step 2: Filter PDBs only at staging copy time**

Change the `node-pty` staging copy to walk the source prebuild and copy every runtime file except names ending in `.pdb` (case-insensitive). Do not delete source PDBs from `node_modules`.

- [ ] **Step 3: Run PTY regression tests**

Run the existing unified-exec/PTY tests plus the new packaging test. Expected: PASS.

- [ ] **Step 4: Run packaged PTY smoke**

Launch packaged app, start one non-TTY command and one `tty:true` command, continue the PTY with `write_stdin`, and verify clean exit.

- [ ] **Step 5: Measure and keep/revert**

Expected size opportunity is roughly 10 MiB uncompressed on current Windows x64, but retain the change only if runtime gates pass. Record actual measured delta, not the estimate.

- [ ] **Step 6: Commit**

```powershell
git add scripts/prepare-packaging-native.mjs test/packaging-node-pty-runtime.test.ts docs/performance/2026-09-06-optimization-results.md
git commit -m "perf(package): omit node-pty debug symbols"
```

---

### Task 6: Stage runtime-only tree-sitter packages

**Files:**
- Modify: `scripts/prepare-packaging-native.mjs`
- Modify: `electron-builder.yml`
- Create: `test/packaging-tree-sitter-runtime.test.ts`
- Modify: `docs/performance/2026-09-06-optimization-results.md`

**Interfaces:**
- Consumes: `tree-sitter` and `tree-sitter-bash` package runtime imports used by ComGu apply-patch interception.
- Produces: staged native/parser runtime with compile-time C sources and unused prebuild architectures removed.

- [ ] **Step 1: Trace the actual runtime import path before choosing an allowlist**

Use repository and installed-package source to identify every file reached when `maybeParseApplyPatchForExec` loads and parses a Bash command. Record this list in a comment beside the staging allowlist so future dependency upgrades have an audit point.

- [ ] **Step 2: Write RED tests for required runtime behavior**

Tests must invoke the same parser path used by `exec_command` and prove it recognizes:

```text
apply_patch heredoc that adds `smoke.txt` with one line `ok`
`cd child && apply_patch` heredoc that adds `child/smoke.txt` with one line `ok`
ordinary shell command -> not intercepted
malformed patch invocation -> expected correctness error
```

The staged tree assertion must reject `src/parser.c`, package build directories, and foreign-architecture prebuilds.

- [ ] **Step 3: Implement explicit runtime allowlists**

Copy only package metadata/license, runtime JS, the target native `.node` prebuild, query/grammar data actually imported at runtime, and any WASM actually proven necessary by tests. If the native path does not load the package WASM, omit it; if packaged smoke proves it is needed, keep it and record why.

- [ ] **Step 4: Narrow `asarUnpack` accordingly**

Unpack only native `.node`/helper artifacts that Electron/Node must load from the real filesystem. Keep ordinary JS/JSON compressed inside ASAR where the loader supports it.

- [ ] **Step 5: Run parser, apply-patch, and package tests**

```powershell
npx vitest run test/packaging-tree-sitter-runtime.test.ts test/codex-apply-patch*.test.ts test/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 6: Packaged apply-patch smoke and measure**

From the packaged app, exercise both standalone `apply_patch` and an `exec_command` patch interception inside an approved temporary root. Verify the expected file bytes, rollback/error behavior, and no runtime module-load error.

Measure the footprint/runtime gates and keep/revert accordingly.

- [ ] **Step 7: Commit**

```powershell
git add scripts/prepare-packaging-native.mjs electron-builder.yml test/packaging-tree-sitter-runtime.test.ts docs/performance/2026-09-06-optimization-results.md
git commit -m "perf(package): trim tree-sitter runtime payload"
```

---

### Task 7: Audit and narrow ASAR unpacking without changing module behavior

**Files:**
- Modify: `electron-builder.yml`
- Create: `test/packaging-asar-contract.test.ts`
- Modify: `docs/performance/2026-09-06-optimization-results.md`

**Interfaces:**
- Consumes: final staged native packages after Tasks 4-6.
- Produces: minimal `asarUnpack` patterns required for real-filesystem native loading.

- [ ] **Step 1: Inventory why every current unpack rule exists**

For each current rule (`node-pty`, MXC, Sharp/@img, tree-sitter, tree-sitter-bash), classify files into:

```text
must be real filesystem: native .node/.dll/.exe/helper loaded by OS
may remain in ASAR: JS/JSON/package metadata read by Node/Electron
extraResource already staged: must not be duplicated in app.asar.unpacked
```

Write this mapping into the packaging test as explicit expected patterns.

- [ ] **Step 2: Write RED duplicate/runtime-path test**

The test against a packaged directory must fail when a target-native payload exists both in `app.asar.unpacked` and a staged copy where only one is load-bearing.

- [ ] **Step 3: Narrow rules one dependency at a time**

Do not replace all `asarUnpack` patterns in one edit. Make the minimum pattern change for one dependency, package, run its runtime smoke, then proceed to the next. This makes the first failing loader attributable.

- [ ] **Step 4: Run complete native feature smoke**

Packaged smoke must cover:

- Sharp image decode through `view_image`;
- node-pty TTY and `write_stdin`;
- tree-sitter apply-patch interception;
- MXC command confinement;
- application connect/disconnect.

- [ ] **Step 5: Measure and keep/revert**

Record actual installed bytes saved and startup/RSS effects. If an ASAR move causes measurable startup regression from decompression/I/O even though size improves, revert that dependency's move.

- [ ] **Step 6: Commit**

```powershell
git add electron-builder.yml test/packaging-asar-contract.test.ts docs/performance/2026-09-06-optimization-results.md
git commit -m "perf(package): narrow native ASAR unpacking"
```

---

### Task 8: Audit startup imports and enforce approved lazy boundaries

**Files:**
- Create: `scripts/trace-main-startup-imports.mjs`
- Create: `test/startup-lazy-loading.test.ts`
- Modify: `docs/performance/2026-09-06-optimization-results.md`

**Interfaces:**
- Consumes: built `out/main` module graph plus packaged startup benchmark.
- Produces: evidence that approved lazy boundaries remain intact plus a written candidate list for any separate future startup optimization.

- [ ] **Step 1: Build an import trace before changing code**

The script must list modules evaluated between process start and the app-ready marker. Classify at least the computer helper, updater, MXC terminal backend, Sharp, and session/agent code.

- [ ] **Step 2: Write assertions for known optional heavy work**

Do not assert that core security/session code is absent just because it is large; only optional code with a real deferred lifecycle is eligible. The audit should identify eager optional work without changing its lifecycle in this task.

- [ ] **Step 3: Record separately scoped lazy-load candidates**

If the trace identifies a heavy eager optional subsystem, record its module, startup cost, and likely use boundary in `optimization-results.md` and stop there for that subsystem. Changing lifecycle behavior requires its own bounded design approval rather than opportunistic refactoring inside this packaging plan.

- [ ] **Step 4: Run startup audit regression**

Run `npx vitest run test/startup-lazy-loading.test.ts` followed by the packaged startup benchmark. Record the audit result without changing production code.

- [ ] **Step 5: Record the audit and measured result**

Document startup median, idle RSS, and any separately scoped future candidate.

- [ ] **Step 6: Commit the startup audit**

```powershell
git add test/startup-lazy-loading.test.ts scripts/trace-main-startup-imports.mjs docs/performance/2026-09-06-optimization-results.md
git commit -m "perf(startup): audit lazy loading"
```

---

### Task 9: Verify no optimization changed supported behavior

**Files:**
- Create: `scripts/smoke-packaged-core.mjs` if an equivalent reusable packaged smoke does not already exist.
- Create or Modify: `test/packaged-core-smoke.test.ts`
- Modify: `docs/performance/2026-09-06-optimization-results.md`

**Interfaces:**
- Consumes: final optimized packaged application.
- Produces: one repeatable smoke command covering the critical runtime matrix.

- [ ] **Step 1: Encode the smoke matrix**

The packaged smoke must validate, using an isolated userData/root fixture:

```text
app reaches ready state
Core MCP initialize + tools/list
read text
find exact content when command is off
exec_command + bundled rg when command is on
write_stdin on a live process
apply_patch
view_image
MXC outside-root canary denial
session recording path
connect/disconnect lifecycle
clean app shutdown
```

Desktop automation is covered by its existing platform-specific tests and should not be force-driven in a headless packaged smoke.

- [ ] **Step 2: Run x64 smoke three consecutive times**

Expected: 3/3 PASS. A flaky pass is not accepted as verification.

- [ ] **Step 3: Run platform/architecture CI packaging jobs**

Use the repository's existing CI matrix for Windows x64/arm64, macOS targets, and Linux targets. Target-specific staging code must pass every architecture it claims to support; an x64-only local success is insufficient for merging generic packaging changes.

- [ ] **Step 4: Record results**

Add artifact sizes and smoke/CI run identifiers to `optimization-results.md`.

- [ ] **Step 5: Commit smoke tooling**

```powershell
git add scripts/smoke-packaged-core.mjs test/packaged-core-smoke.test.ts docs/performance/2026-09-06-optimization-results.md
git commit -m "test(package): verify optimized packaged runtime"
```

If the repo already contains an equivalent script, extend/reuse it and commit only the real paths changed.

---

### Task 10: Final quantitative gate and release recommendation

**Files:**
- Modify: `docs/performance/2026-09-06-optimization-results.md`

**Interfaces:**
- Consumes: baseline artifacts and final optimized packaged build.
- Produces: keep/revert decision for every candidate and a release-ready performance report.

- [ ] **Step 1: Rebuild final candidate from a clean dependency state**

Use the same Node/npm versions and packaging command as the baseline. Do not compare a warm incremental package with a clean baseline.

- [ ] **Step 2: Run full verification**

```powershell
npm run verify:ci
npm run typecheck
npm run build
git diff --check
npm run dist:x64
```

Expected: all exit 0.

- [ ] **Step 3: Re-run every quantitative benchmark**

Run footprint, 10-launch startup, 5-run 30-second RSS, and MCP/exact-search latency scripts with the same arguments as baseline.

- [ ] **Step 4: Apply the hard runtime gates**

Reject or revert any candidate responsible for violating:

```text
startup median <= baseline + max(100 ms, 5%)
idle RSS median <= baseline + max(20 MiB, 10%)
Core tools/list median <= baseline + 10%
exact search p50 <= baseline + 10%
exact search p95 <= baseline + 10%
```

Correctness/security test failure is an unconditional rejection regardless of performance.

- [ ] **Step 5: Report size as a result, not a pass/fail target**

The final report must include:

```text
installer bytes: before -> after -> delta
installed/unpacked bytes: before -> after -> delta
app.asar bytes
app.asar.unpacked bytes
tunnel bytes
native runtime bytes by dependency
```

If installed size grows, explain exactly which retained capability/dependency accounts for it. Do not conceal the increase by quoting only compressed installer size.

- [ ] **Step 6: Write the final recommendation**

End `optimization-results.md` with one of:

```text
RECOMMEND SHIP — all hard gates pass; retained changes are listed above.
```

or begin the conclusion with the exact line `DO NOT SHIP OPTIMIZATION SET`, then record the actual failed metric with baseline, candidate value, permitted ceiling, and the exact optimization commit SHA implicated by the one-change-at-a-time measurements. Do not use a template value in the final report.

- [ ] **Step 7: Commit the measurement report**

```powershell
git add docs/performance/2026-09-06-optimization-results.md
git commit -m "docs(perf): record final optimization results"
```

---

## Plan Self-Review Checklist

- Spec coverage: installed size, startup, memory, MCP discovery, exact search, native staging, lazy loading, packaged smoke, and cross-platform verification each have explicit tasks.
- Incompleteness scan: every optimization candidate has a concrete test, package smoke, measurement gate, and keep/revert rule; no size estimate is treated as guaranteed savings.
- Type/interface consistency: benchmark artifacts feed the same final gate; native staging remains owned by `prepare-packaging-native.mjs`; normal application behavior never depends on benchmark env variables.
- Stability discipline: tunnel, MXC confinement, PTY, Sharp, tree-sitter behavior, extension, and supported target architectures are preserved and explicitly smoked rather than removed for size.
- Independence: this plan does not require any optional search subsystem and keeps the existing exact-search behavior unchanged.
