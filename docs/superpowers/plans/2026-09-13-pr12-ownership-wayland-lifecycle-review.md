# PR #12 Ownership / Wayland / Lifecycle Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans inline only; project/user constraint forbids subagents.

**Goal:** Resolve the remaining PR #12 merge blockers around profile ownership, startup ordering, DesktopDriver lifecycle, Wayland coordinate authority, and shared profile compatibility, while preserving the safe read/navigation path for ChatGPT/Codex Desktop.

**Architecture:** Use one frontend-independent local control/ownership authority for Desktop and CLI. Acquire it before any mutable profile initialization. Replace age-based Unix ownership recovery with an atomic published owner record plus a fail-closed stale-recovery election. Make the connection generation explicitly own its DesktopDriver. Keep Wayland keyboard control available while requiring authoritative capture + current frame identity for coordinate pointer actions.

**Tech Stack:** TypeScript, Node.js fs/net/process APIs, Electron, Vitest, xdg-desktop-portal adapters.

**Spec:** PR #12 Request Changes received 2026-09-13 plus `docs/superpowers/specs/2026-09-11-durable-long-running-runs-design.md`.

## Global Constraints
- No subagents.
- Preserve fail-closed security and WorkspaceScope/caller ownership.
- Do not merge without explicit user request.
- TDD for behavior changes.
- Keep CLI and Desktop lightweight.
- Do not claim real Linux graphical RC unless actually run.

---

### Task 1: Generation-safe profile ownership
**Files:** `src/main/runtime/control.ts`, `test/runtime-control.test.ts`
- Add adversarial owner-generation tests, including a paused live owner and competing stale recovery.
- Publish a complete owner record atomically; remove directory-age stale inference.
- Record process-start identity in addition to PID so PID reuse does not make stale ownership appear live.
- Serialize stale recovery with a fail-closed recovery election; if the reaper itself dies, prefer blocking/manual repair over manufacturing two owners.
- Ensure release removes only the exact generation it owns.

### Task 2: Shared Desktop/CLI profile authority and startup ordering
**Files:** `src/main/index.ts`, `src/cli/owner.ts`, `src/main/runtime/control.ts`, relevant tests.
- Desktop and CLI both acquire the same profile control authority.
- Losing frontend exits/attaches before machine/config/vault/durable/tunnel mutable initialization.
- CLI machine identity initialization occurs only after ownership acquisition.
- Desktop control status is readable by the CLI through the same local channel.

### Task 3: Shared compatibility-aware default profile resolution
**Files:** `src/cli/profile-dir.ts`, `src/main/migration.ts`, profile/migration tests.
- CLI and Desktop use the same legacy-aware resolver.
- Define deterministic precedence when both legacy and new directories exist.

### Task 4: DesktopDriver connection-generation lifecycle
**Files:** `src/main/connection.ts`, `test/connection.test.ts`
- Track candidate vs active DesktopDriver explicitly.
- Dispose unpublished candidates on every startup failure/cancellation.
- Drain MCP admission before disposing the active driver.
- Dispose generation N before generation N+1 is published.

### Task 5: Wayland frame-authorized pointer mutations
**Files:** `src/main/desktop/linux/wayland.ts`, `src/main/mcp/tools-desktop.ts`, Wayland/Desktop MCP tests.
- Preserve keyboard-only control when the portal grants keyboard without authoritative capture.
- Require capture authority + current frameId for click/double-click/move/drag/scroll.
- Reject omitted/stale frameId before any portal side effect.
- Enforce frameId for all coordinate actions at the MCP boundary.
- Preserve ref-based navigation without frameId so safe UI navigation remains usable for ChatGPT/Codex Desktop when control is granted.

### Task 6: Full verification and PR update
- Run targeted tests per task, then `npm run verify:ci`, build, audit, CLI smoke, package/runtime/Core smoke, and `git diff --check`.
- Push to PR #12, wait for Security + Windows/macOS/Linux CI on the final SHA, and update PR body.
- Do not merge.
