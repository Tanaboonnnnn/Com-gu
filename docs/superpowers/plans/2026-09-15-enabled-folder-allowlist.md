# Enabled Folder Allowlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chat-bound folder authorization with persistent per-root ON/OFF authority while preserving fail-closed Run/worker narrowing and Windows command confinement.

**Architecture:** `Config.roots` remains the canonical approved-root list and each root carries a persisted `enabled` flag. Ordinary Core file/terminal calls authorize against `enabledRoots(config.roots)` without consulting chat workspace bindings; active Runs snapshot/narrow only that enabled set and workers may narrow further. The renderer exposes one authoritative toggle per folder and removes the old fallback/Primary/Shared selection UI.

**Tech Stack:** TypeScript, Electron IPC/preload, Zod config validation, Vitest, existing sandbox/MXC runtime.

**Spec:** `docs/superpowers/specs/2026-09-15-enabled-folder-allowlist-design.md`

## Global Constraints

- No subagents.
- Preserve canonical path, symlink/reparse, caller identity, terminal ownership, pairing and Wayland fail-closed boundaries.
- Chat identity remains authoritative for attribution/agents/terminal ownership, but not for ordinary folder authorization.
- All enabled roots are ordinary Core authority; all disabled roots are inaccessible through virtual and native spellings.
- Active Run/worker authority may only equal or narrow the currently enabled set.
- No enabled roots means no file/terminal authority.
- New roots start enabled; legacy roots without the field migrate enabled.
- No Primary/Shared workspace selection in the normal Desktop UI.

---

### Task 1: Persist enabled-root authority

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `Root.enabled?: boolean` for source compatibility; parsed config canonicalizes it to `true|false`.
- Produces: `enabledRoots(roots: readonly Root[]): readonly Root[]` using `root.enabled !== false`.

- [ ] Add failing config tests proving a legacy root with no `enabled` loads enabled, explicit `enabled:false` survives reload, and helper filtering returns only ON roots.
- [ ] Run `npx vitest run test/config.test.ts` and confirm the new assertions fail.
- [ ] Extend `Root`, `rootSchema`, and add `enabledRoots`; preserve rename/dedup fields unchanged.
- [ ] Run `npx vitest run test/config.test.ts` and confirm pass.
- [ ] Commit `feat(workspace): persist enabled folder authority`.

### Task 2: Add authoritative root-toggle IPC and renderer switch

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/styles.css`
- Modify: `src/shared/i18n/catalog.ts`
- Test: `test/ipc.test.ts`
- Test: `test/renderer-state.test.ts`

**Interfaces:**
- Produces: preload method `setRootEnabled(name: string, enabled: boolean): Promise<AppState>` backed by IPC `roots:setEnabled`.
- Root add writes `{ name, path, enabled: true }`; rename preserves the flag; remove removes the row.

- [ ] Add failing IPC tests for ON/OFF persistence, stale root rejection, add-default-ON semantics where injectable fixture permits, and rename preservation.
- [ ] Add failing renderer test that each folder row renders a switch and changing it calls `setRootEnabled`; returned AppState is the only authority used to repaint.
- [ ] Run focused IPC/renderer tests and confirm failures.
- [ ] Implement `roots:setEnabled`, preload binding, toggle row, accessible labels and compact switch styling.
- [ ] Run focused IPC/renderer tests and confirm pass.
- [ ] Commit `feat(ui): toggle folder authority from Home`.

### Task 3: Make enabled roots the ordinary MCP authorization boundary

**Files:**
- Modify: `src/main/mcp/kernel.ts`
- Modify: `src/main/mcp/instructions.ts`
- Modify: `src/main/sandbox.ts` only if an error distinction is required without weakening containment.
- Test: `test/mcp.test.ts`
- Test: `test/sandbox.test.ts`

**Interfaces:**
- `effectiveRootsForCall(ctx)` returns all enabled roots for ordinary (non-Run) calls whether conversation identity is known or unresolved.
- Active Run calls still resolve through Run/worker scope, intersected/proven against enabled roots.

- [ ] Add failing MCP regression: unresolved caller + enabled root can read; known caller does not need per-chat scope; disabled virtual/native root fails; all-disabled fails closed.
- [ ] Run targeted MCP tests and confirm old `WORKSPACE_SCOPE_REQUIRED` behavior fails the new regression.
- [ ] Replace ordinary `effectiveManualWorkspaceRoots` / `effectiveChatWorkspaceRoots` authorization with `enabledRoots(getConfig().roots)`; leave caller identity requirements in identity-sensitive subsystems.
- [ ] Ensure path resolution receives enabled roots as both visible/effective authority so disabled native and virtual paths cannot pass through global approved roots.
- [ ] Update model-facing instructions to list only enabled roots as usable authority.
- [ ] Run targeted MCP + sandbox tests and confirm pass.
- [ ] Commit `feat(core): authorize files and commands by enabled roots`.

### Task 4: Default Runs to enabled roots and preserve worker narrowing

**Files:**
- Modify: `src/main/agents.ts`
- Modify: `src/main/run/scope.ts` if a helper is needed to snapshot all enabled roots.
- Modify: `src/main/run/state.ts` if the default binding belongs there.
- Test: `test/agents.test.ts`
- Test: `test/run-scope.test.ts`
- Test: `test/terminal-workspace-security.test.ts`

**Interfaces:**
- Produces: an internal scope snapshot spanning all enabled roots (first enabled root is an internal primary representation only; remaining enabled roots are shared internally and never exposed as a user selection requirement).
- Requested Run/worker scope must be a subset of enabled roots; disabled roots fail with escalation/root-change semantics.

- [ ] Add failing tests: fresh Run without chat workspace scope starts from all enabled roots; disabled root cannot be requested; worker narrowing still succeeds; no-enabled roots fails closed.
- [ ] Add/adjust Windows command-sandbox assertion that the sandbox receives only effective enabled/narrowed native paths.
- [ ] Run focused Run/agent/security tests and confirm failures.
- [ ] Remove `chatWorkspaceScope(conversationId)` as the default Run authority source; snapshot enabled roots instead and validate explicit narrowing against that snapshot.
- [ ] Keep exact conversation identity requirements for agent routing/ownership unchanged.
- [ ] Run focused suites and confirm pass.
- [ ] Commit `feat(run): inherit enabled folder allowlist`.

### Task 5: Retire chat workspace picker UX and fallback authorization path

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/chat.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/i18n/catalog.ts`
- Modify: `src/main/chat-workspace-scope.ts` only to retire/dead-code paths safely; do not remove durable compatibility restoration until no live consumer needs it.
- Test: `test/renderer-state.test.ts`
- Test: `test/ipc.test.ts`

**Interfaces:**
- Removes renderer/preload dependence on `chatWorkspace:getPending`, `chatWorkspace:setPending`, and `chatWorkspace:setManual` for authorization.
- Run scope display may remain diagnostics-only, but no Primary/Shared picker is shown in normal flow.

- [ ] Replace old renderer tests that expect workspace picker with failing assertions that the picker is absent/hidden and missing-chat notifications cannot request folder authority.
- [ ] Run focused renderer/IPC tests and confirm old UI fails the new contract.
- [ ] Remove the fallback picker markup/listeners and normal-flow IPC/preload methods; retain only compatibility code that is still needed to read old durable state without granting authority.
- [ ] Remove obsolete user-facing workspace-selection strings and update Home folder copy to explain ON/OFF.
- [ ] Run focused renderer/IPC tests and confirm pass.
- [ ] Commit `refactor(workspace): retire chat-bound folder picker`.

### Task 6: Documentation, version line, full verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify version files only if this branch is explicitly prepared as v3.3.0 release metadata: `package.json`, `package-lock.json`, `src/main/version.ts`, `extension/manifest.json`.

**Interfaces:**
- Documentation states approved+enabled roots are authority and chat workspace is convenience/Run narrowing only.

- [ ] Update README and architecture guidance so they no longer instruct users to choose Primary/Shared folders for ordinary access.
- [ ] Run `git diff --check`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run verify`.
- [ ] Run `npm run build` because renderer/preload/main IPC changed.
- [ ] Inspect `git status --short` and verify only intended files changed.
- [ ] Commit documentation/version changes separately if needed.

## Self-review

- Spec coverage: persistence/migration, UI toggle, ordinary MCP authority, missing chat id, Run/worker narrowing, MXC confinement, removal of picker, docs and full verification are all mapped above.
- Placeholder scan: no TBD/TODO/future implementation placeholders.
- Type consistency: `Root.enabled`, `enabledRoots`, `roots:setEnabled`, and `setRootEnabled` use one spelling throughout.
