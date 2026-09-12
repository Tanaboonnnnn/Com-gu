# Durable Long-Running Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for this branch. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents; this branch already carries that constraint.

**Goal:** Add recoverable multi-hour Durable Runs plus lazy runtime feature loading without weakening caller/workspace security or regressing CLI/Desktop baseline startup and memory.

**Architecture:** Put long-run lifecycle rules behind one Node-only `DurableRunStore` interface and keep browser/Goal/session/agent/Desktop integrations as optional adapters. `RuntimeProfile` remains policy authority; a feature loader dynamically imports adapters only when both policy and live configuration require them. Existing session history, Compact & Resume, bridge delivery, and workspace ownership remain authoritative for their current domains.

**Tech Stack:** TypeScript, Node.js, Vitest, existing atomic `durable.ts` store, Electron adapter, Chrome-extension bridge, Vite packaging.

---

## File map

- Create `src/main/run/durable-run.ts`: deep module owning run state, leases, checkpoints, recovery, dedupe, reconciliation classification, and bounded persistence.
- Create `src/main/runtime/features.ts`: lazy feature-loader seam and adapter registry.
- Create `src/main/runtime/desktop-features.ts`: Desktop-only lazy adapter factory for bridge/session/Goal/agents.
- Modify `src/main/runtime/profile.ts`: expose feature-family policy without importing implementations.
- Modify `src/main/runtime/runtime.ts`: start/stop loaded Runtime Features while preserving one lifecycle state machine.
- Modify `src/main/connection.ts`: consume injected/lazy Desktop capability adapter without importing disabled feature families.
- Modify `src/main/goal.ts`: act as a continuation adapter for a Durable Run rather than owning long-run lifecycle decisions.
- Modify `src/main/bridge.ts`: translate settled-turn/reconnect/delivery events into Durable Run transitions; remove duplicated retry/expiry decisions once authoritative in Durable Run.
- Modify `src/main/session/continuation.ts`: preserve Compact & Resume authority but stop owning generic long-run lifetime.
- Modify `src/cli/owner.ts`: initialize only CLI-safe features and optional Durable Run status/recovery path.
- Add focused tests `test/durable-run.test.ts`, `test/runtime-features.test.ts`, `test/durable-run-bridge.test.ts`, and extend packaging/import-graph tests.
- Update `README.md`, `SECURITY.md`, `AGENTS.md`, and `docs/cli.md` after behaviour is verified.

---

### Task 1: Durable Run state machine and atomic checkpoints

**Files:**
- Create: `src/main/run/durable-run.ts`
- Test: `test/durable-run.test.ts`

- [ ] **Step 1: Write failing tests** for `open`, `observe`, `advance`, and `recover` through the public interface. Pin these behaviours: duplicate `open` returns the same active run for owner+objective, accepted transitions are durable-before-publish, completed/cancelled runs are terminal, and snapshots contain only bounded control metadata.

- [ ] **Step 2: Run RED**

Run: `npm test -- --run test/durable-run.test.ts`

Expected: FAIL because the module/interface does not exist.

- [ ] **Step 3: Implement the minimal deep module** with this external interface:

```ts
export interface DurableRunStore {
  open(objective: string, owner: string): Promise<DurableRunView>;
  observe(runId: string): DurableRunView | null;
  advance(runId: string, event: DurableRunEvent): Promise<DurableRunView>;
  recover(now?: number): Promise<DurableRunRecovery[]>;
}
```

Use one `durable-runs` snapshot through `writeDurableNow`; publish in-memory state only after the write succeeds. Cap objective/checkpoint/reason/receipt strings and total retained terminal history so the snapshot cannot grow with transcript/tool output size.

- [ ] **Step 4: Run GREEN** with `npm test -- --run test/durable-run.test.ts` and `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/main/run/durable-run.ts test/durable-run.test.ts
git commit -m "feat(run): add durable long-running state"
```

### Task 2: Lease expiry, recovery, and reconciliation safety

**Files:**
- Modify: `src/main/run/durable-run.ts`
- Test: `test/durable-run.test.ts`

- [ ] **Step 1: Add RED cases** for renewable lease, restart after expiry -> `suspended`, identity mismatch refusing lease renewal, read-only retry recovery, receipt-backed retry, ambiguous mutation -> `needs-reconciliation`, and stale recovery unable to resurrect terminal runs.

- [ ] **Step 2: Run RED** using the focused test.

- [ ] **Step 3: Implement minimal transition rules.** Timers may schedule housekeeping but durable timestamps decide state. Use a short renewable lease (15 minutes), retain non-terminal runs for at least 24 hours, and never automatically replay arbitrary mutation events.

- [ ] **Step 4: Run GREEN + typecheck + `git diff --check`.**

- [ ] **Step 5: Commit** as `feat(run): recover durable work safely`.

### Task 3: Lazy Runtime Feature loader

**Files:**
- Create: `src/main/runtime/features.ts`
- Create: `src/main/runtime/desktop-features.ts`
- Modify: `src/main/runtime/profile.ts`
- Modify: `src/main/runtime/runtime.ts`
- Test: `test/runtime-features.test.ts`

- [ ] **Step 1: Write RED tests** that assert the loader has a small interface, loads each feature once, does not load disallowed features, unloads in reverse order, and leaves disabled feature factories untouched.

- [ ] **Step 2: Add import-graph RED tests** asserting CLI/admin entrypoints exclude bridge, Goal, session recorder, agents, and Electron; Desktop startup with Goal/agents disabled does not import those modules before use.

- [ ] **Step 3: Implement the seam**:

```ts
export interface RuntimeFeature {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RuntimeFeatureLoader {
  ensure(kind: RuntimeFeatureKind): Promise<RuntimeFeature | null>;
  stopAll(): Promise<void>;
}
```

Factories are functions returning dynamic imports. `RuntimeProfile` answers only whether a family may load; live config answers whether it should load now. Do not import browser/session/Goal/agent implementation from `features.ts`.

- [ ] **Step 4: Run GREEN + typecheck + dependency tests.**

- [ ] **Step 5: Commit** as `refactor(runtime): lazy load optional features`.

### Task 4: Desktop adapter migration without eager Goal/agent loading

**Files:**
- Modify: `src/main/bridge.ts`
- Modify: Desktop bootstrap file that currently starts bridge/session/Goal/agents
- Modify: `src/main/runtime/desktop-features.ts`
- Test: `test/runtime-features.test.ts`
- Test: existing `test/bridge.test.ts`, `test/agents.test.ts`

- [ ] **Step 1: Add RED startup/import tests** proving Desktop with disabled Goal and multi-agent settings does not evaluate `goal.ts` or `agents.ts` merely by starting Core/bridge infrastructure.

- [ ] **Step 2: Move feature-specific imports behind adapters**, replacing rather than layering old eager imports. Bridge routing that needs a disabled feature must return the same disabled semantics without loading the implementation.

- [ ] **Step 3: Run focused Desktop/bridge/agent regressions** and typecheck.

- [ ] **Step 4: Commit** as `refactor(desktop): defer optional runtime features`.

### Task 5: Route settled turns through Durable Run

**Files:**
- Modify: `src/main/goal.ts`
- Modify: `src/main/bridge.ts`
- Create/Test: `test/durable-run-bridge.test.ts`

- [ ] **Step 1: Write RED integration cases**: unfinished objective -> durable `waiting` checkpoint before continuation delivery; completion -> `completed`; lost provider/network -> suspended/waiting with bounded retry metadata; duplicate settled-turn event -> no duplicate continuation.

- [ ] **Step 2: Implement a Goal continuation adapter** that derives only `continue/stop + reply`. It must not own lease expiry, retry count, run completion, or mutation reconciliation.

- [ ] **Step 3: Bridge translates page events into `advance()` events** and queues browser delivery only after the Durable Run transition is durable. Existing bridge command receipts remain the delivery dedupe authority.

- [ ] **Step 4: Remove the corresponding duplicated lifecycle decisions** from caller code once the new module is authoritative.

- [ ] **Step 5: Run focused bridge/Goal/Durable Run tests and commit** as `feat(run): continue unfinished work across turns`.

### Task 6: Reconnect and restart recovery

**Files:**
- Modify: `src/main/bridge.ts`
- Modify: `src/main/session/continuation.ts`
- Modify: Desktop bootstrap/startup recovery path
- Modify: `src/cli/owner.ts`
- Test: `test/durable-run-bridge.test.ts`
- Test: existing continuation/bridge recovery suites

- [ ] **Step 1: RED cases** for browser reload reclaiming the same run, ComGu restart restoring waiting/suspended runs without duplicate browser commands, lost identity causing suspension, and Compact & Resume still remaining the sole session-rebind authority.

- [ ] **Step 2: Initialize Durable Run state before continuation delivery**. `recover()` may request safe read/continuation work only after caller ownership is proven; ambiguous mutation recovery surfaces `needs-reconciliation` and queues no automatic mutation.

- [ ] **Step 3: Preserve existing continuation transaction semantics** and remove only generic lifetime/expiry logic that has moved to Durable Run.

- [ ] **Step 4: Run focused recovery suites + typecheck + diff-check.**

- [ ] **Step 5: Commit** as `feat(run): recover work after reconnect and restart`.

### Task 7: CLI long-run visibility without browser machinery

**Files:**
- Modify: `src/cli/owner.ts`
- Modify: CLI command/admin module
- Modify: runtime control status schema if needed
- Test: `test/cli-admin.test.ts`
- Test: packaging/import-graph tests

- [ ] **Step 1: RED tests** for CLI status exposing compact Durable Run state while proving no bridge/Goal/session/agent/Electron imports occur.

- [ ] **Step 2: Lazily initialize Durable Run core only when owner recovery/status needs it.** CLI must not attempt browser continuation; it may report `waiting`, `suspended`, or `needs-reconciliation` and keep Core/MCP running.

- [ ] **Step 3: Run CLI focused tests, package smoke, typecheck, and dependency graph checks.**

- [ ] **Step 4: Commit** as `feat(cli): expose durable run status lightly`.

### Task 8: Performance gates and no-busy-loop proof

**Files:**
- Modify/Create existing perf scripts under `scripts/`
- Test: runtime/import tests
- Update: release verification notes document

- [ ] **Step 1: Record before/after CLI owner startup and idle RSS** using the same packaged smoke methodology already used for Task 16.

- [ ] **Step 2: Record Desktop startup/idle RSS before and after with Goal/agents disabled.** If a precise historical baseline is unavailable, compare parent commit and current branch using the same script/environment rather than mixing measurement methods.

- [ ] **Step 3: Assert no perpetual timer exists while there are no non-terminal runs.** Lease housekeeping must arm on demand and `unref()` timers.

- [ ] **Step 4: Investigate any material regression before proceeding.** Do not hide it by widening a threshold.

- [ ] **Step 5: Commit** as `perf(runtime): keep durable runs dormant when idle` if code changes are needed.

### Task 9: Documentation and security consistency

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `AGENTS.md`
- Create/Modify: `docs/cli.md`
- Modify: `CONTEXT.md` only if terminology changed during implementation

- [ ] **Step 1: Document Durable Run states, reconciliation, cancellation, retention, and the fact that it does not keep one HTTP/model request open for hours.**

- [ ] **Step 2: Document lazy feature loading and cross-platform Desktop capability wording.** Remove stale Windows-only claims where Linux X11/Wayland support is now capability-gated.

- [ ] **Step 3: State security invariants explicitly:** caller identity/workspace scope unchanged; ownerless CLI managed terminals remain fail-closed; arbitrary mutations are never replayed on timeout/restart.

- [ ] **Step 4: Run docs/branding checks and `git diff --check`.**

- [ ] **Step 5: Commit** as `docs: document durable long-running runs`.

### Task 10: Full verification, build, packaging, and review

**Files:** all touched files only as required by failures/review.

- [ ] **Step 1: Run focused security gates** including caller identity, workspace scope, Durable Run recovery, bridge receipts, and continuation tests.

- [ ] **Step 2: Run fresh `npm run verify:ci`.** Fix root causes only; do not reduce coverage or loosen security checks.

- [ ] **Step 3: Run `npm run build`.**

- [ ] **Step 4: Rebuild and smoke the host-native standalone CLI package**, scan emitted code for forbidden Electron/browser/session/agent/Goal imports, and verify checksums/release wiring still pass.

- [ ] **Step 5: Run `npm audit --omit=dev --audit-level=high` and `git diff --check`.**

- [ ] **Step 6: Review the branch against `docs/superpowers/specs/2026-09-11-durable-long-running-runs-design.md`; fix any Standards/Spec findings, then rerun affected tests.**

- [ ] **Step 7: Commit the final verification/docs fixes.** Do not merge/tag/publish without the required real Linux X11/Wayland RC matrix if the release process requires those claims.
