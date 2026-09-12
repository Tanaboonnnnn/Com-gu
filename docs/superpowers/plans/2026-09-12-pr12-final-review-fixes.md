# PR #12 Final Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use inline execution only for this branch; project/user constraint forbids subagents.

**Goal:** Resolve the second-round PR #12 correctness blockers and important lifecycle/lazy-loading/documentation issues, then re-verify and push the same PR back to reviewable state.

**Architecture:** Preserve fail-closed behavior. Make runtime ownership acquisition atomic before touching the Unix socket path; make feature lifecycle attempts retry-safe and teardown truly sequential; make Wayland input cleanup deterministic and remove any unproven screenshot-to-input coordinate coupling; move agents MCP wiring behind the agents RuntimeFeature boundary; update the authoritative architecture guide to match the implemented platform split.

**Tech Stack:** TypeScript, Node.js net/fs, Vitest, Electron/Vite, xdg-desktop-portal adapters.

**Spec:** reviewer feedback uploaded 2026-09-12 plus `docs/superpowers/specs/2026-09-11-durable-long-running-runs-design.md`.

## Global Constraints
- Keep CLI and Desktop lightweight.
- Preserve fail-closed security behavior and WorkspaceScope/caller ownership.
- No automatic replay of ambiguous mutations.
- No subagents.
- Same PR #12; do not merge without explicit user request.
- TDD for every behavior change.

---

### Task 1: Atomic Unix runtime ownership
**Files:** `src/main/runtime/control.ts`, `test/runtime-control.test.ts`
- Add an adversarial concurrent-start regression that proves exactly one owner succeeds and loser cleanup cannot remove the winner endpoint.
- Replace probe/unlink/bind as ownership primitive with an atomic profile-owner lock acquired before stale socket handling. Cleanup must only release/remove resources owned by that server instance.
- Keep Windows named-pipe behavior unchanged.
- Run runtime-control tests and typecheck; commit.

### Task 2: RuntimeFeature lifecycle recovery and ordered teardown
**Files:** `src/main/runtime/features.ts`, `test/runtime-features.test.ts`
- RED test: first `feature.start()` rejects; concurrent callers share that attempt; second ensure retries with a fresh factory/start and succeeds.
- Ensure partial start gets best-effort stop cleanup without masking original error.
- RED test: reverse-order teardown is sequential, not merely promise-start order.
- Implement whole-attempt try/finally cleanup and sequential best-effort reverse stop.
- Run targeted tests/typecheck; commit.

### Task 3: Wayland keyboard partial-side-effect cleanup
**Files:** `src/main/desktop/linux/wayland.ts`, `test/desktop-wayland.test.ts`
- RED tests for key-down failure and release-phase failure.
- Track successfully pressed keysyms and release in reverse order from `finally`; preserve original failure if cleanup also fails.
- Apply same deterministic release helper to single-character typing.
- Run targeted tests/typecheck; commit.

### Task 4: Same-authority Wayland capture/input safety
**Files:** `src/main/desktop/linux/wayland-portal.ts`, `src/main/desktop/linux/wayland.ts`, portal/Wayland tests, `docs/rc-linux-desktop.md`
- RED test proving independent Screenshot portal pixels cannot be treated as RemoteDesktop stream coordinates.
- Because current gdbus transport cannot consume PipeWire FDs, fail closed for frame-based Wayland capture/pointer coupling rather than infer equivalence from dimensions. Preserve keyboard-only portal control where granted.
- Remove/disable independent Screenshot portal capture from the RemoteDesktop session contract until same-stream capture exists.
- Add explicit multi-monitor/same-stream RC acceptance criteria.
- Run Wayland tests/typecheck; commit.

### Task 5: Keep Agents implementation unloaded while disabled
**Files:** `src/main/mcp/desktop-app-runtime.ts`, `src/main/mcp/optional-runtime.ts`, `src/main/runtime/desktop-features.ts`, `src/main/mcp/server.ts`, runtime/startup tests.
- RED runtime-path test: start Desktop MCP with multi-agent disabled and prove agents implementation is not loaded; enable => loads once; disable/re-enable => no duplicate installation/listeners.
- Split base Desktop/session optional runtime from agents-specific optional MCP adapter and install/uninstall it from Agents RuntimeFeature start/stop.
- Run startup/lazy/runtime/bridge/MCP tests and typecheck; commit.

### Task 6: Authoritative architecture documentation
**Files:** `AGENTS.md`
- Search every Windows-only/Desktop statement.
- Document Windows + supported Linux graphical-session Desktop capability, Linux X11/Wayland adapter ownership and fail-closed Wayland capture limitation, macOS Desktop V1 unsupported, and platform masking behavior consistently.
- Run doc/static architecture tests and `git diff --check`; commit.

### Task 7: Final verification and PR state
- Fresh full `npm run verify:ci`, `npm run build`, production audit, CLI build/smoke, packaged Windows smoke, `git diff --check`.
- Push all commits to existing PR #12.
- Run/check native CI/package matrix available for final SHA. Do not claim real Linux graphical RC unless actually run on a graphical Linux host; record that limitation explicitly if unavailable.
- Update PR body/review response. Mark Ready only if automated gates are green and no unresolved blocker remains; do not merge.
