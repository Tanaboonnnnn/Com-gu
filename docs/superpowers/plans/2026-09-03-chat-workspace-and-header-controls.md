# Chat Workspace and Header Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved header layout, correct connection status rendering, and enforce explicit per-chat multi-root workspace authority with extension and Desktop fallback UX.

**Architecture:** Keep approved roots as the only native-path authority. Add a durable conversation-to-WorkspaceScope store in main, make the MCP kernel require it for ordinary chats, and let Run creation consume the Prime conversation's scope instead of global `nextRunWorkspaceScope`. Expose only root names through narrow bridge/IPC APIs; the extension renders a composer pill and the Desktop provides a fallback selector for pending chats.

**Tech Stack:** Electron, TypeScript, Zod, MV3 extension JavaScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-chat-workspace-and-header-controls-design.md`

## Global Constraints

- Do not use subagents for this implementation.
- Existing approved roots remain the only source of filesystem authority.
- No native paths may enter renderer/extension state.
- Missing conversation identity fails closed until the user explicitly selects a non-durable Desktop fallback workspace; missing exact-chat scope still fails closed when identity is available.
- Worker scope may only equal or narrow Prime scope.
- Existing active Run scope stays immutable.
- Use TDD: each behavior change gets a failing regression before production code.

---

### Task 1: Header controls and connection status regression

**Files:** `test/renderer-state.test.ts`, `test/renderer-layout.test.ts`, `src/renderer/index.html`, `src/renderer/main.ts`, `src/renderer/styles.css`, `src/shared/i18n/catalog.ts`

- [ ] Add failing tests for header order, header Sub-agent toggle persistence, and connected/Thai state repaint after an unsolicited state push.
- [ ] Run the two renderer tests and confirm RED.
- [ ] Move the existing Multi-agent checkbox to the header without creating a second setting; wire it through the existing save queue and translations.
- [ ] Fix the connection-label repaint path so latest state + locale always wins.
- [ ] Re-run renderer tests and typecheck.

### Task 2: Durable per-conversation workspace scope

**Files:** create `src/main/chat-workspace-scope.ts`; modify `src/main/index.ts`, `src/main/session/continuation.ts`, `src/shared/session.ts`; tests `test/run-scope.test.ts`, `test/continuation.test.ts`

- [ ] Add failing tests for set/get multi-root scope by conversation, missing selection, root identity removal/re-add failure, narrowing, and Compact & Resume transfer.
- [ ] Confirm RED.
- [ ] Implement a durable conversation-scope store using bound approved-root identities, with renderer/extension-safe name projection.
- [ ] Integrate startup restoration and continuation transfer.
- [ ] Re-run focused tests.

### Task 3: MCP authority enforcement and Prime inheritance

**Files:** `src/main/mcp/kernel.ts`, `src/main/agents.ts`, `src/main/run/scope.ts`; tests `test/mcp.test.ts`, `test/agents.test.ts`, `test/run-scope.test.ts`, `test/terminal-workspace-security.test.ts`

- [ ] Add failing tests proving an ordinary chat cannot read/patch/exec without selected scope, cannot touch an approved-but-unselected root, and can use multiple selected roots.
- [ ] Add failing tests proving a new Prime Run consumes the caller chat scope and workers cannot exceed it.
- [ ] Confirm RED.
- [ ] Make effective roots resolve from conversation scope for ordinary chats and from Run/worker scope for active members.
- [ ] Remove global next-Run selection as authority while preserving safe compatibility projection where needed by existing UI/tests.
- [ ] Re-run security-focused tests including Windows terminal scope suite.

### Task 4: Narrow Desktop/bridge APIs

**Files:** `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/bridge.ts`, `src/shared/types.ts`; tests `test/ipc.test.ts`, `test/bridge.test.ts`

- [ ] Add failing tests for safe root-name-only views, conversation-scoped selection writes, invalid/unknown root rejection, and explicit scope-increase writes.
- [ ] Confirm RED.
- [ ] Add fixed IPC and authenticated bridge routes that accept only conversation id already proven by the extension/app plus approved root names; no generic invocation or native path fields.
- [ ] Expose pending exact-chat choices plus one explicit unidentified-call fallback state to Desktop without leaking native paths or unrelated conversation data.
- [ ] Keep the unidentified fallback non-durable, ordinary file/terminal only, and unusable for Prime/subagent creation; exact extension identity always overrides it.
- [ ] Re-run IPC/bridge tests.

### Task 5: Extension workspace pill

**Files:** `extension/content.js`, `extension/background.js`, `extension/chatgpt-dom.js`, extension styles/manifest only if required; tests `test/content-script.test.ts`, `test/extension.test.ts`

- [ ] Add failing tests for one pill per active conversation, `Workspace: <name> +N` summary, multi-select panel, navigation epoch isolation, and no native paths in page messages/DOM.
- [ ] Confirm RED.
- [ ] Implement the pill near the composer using existing selector ownership and background-owned authenticated bridge calls.
- [ ] Re-render on conversation navigation/root rename/state change and tear down listeners/DOM on takeover.
- [ ] Re-run extension tests.

### Task 6: Desktop fallback selector and final verification

**Files:** `src/renderer/chat.ts` or `src/renderer/main.ts` following existing ownership, `src/renderer/index.html`, `src/renderer/styles.css`, `src/shared/i18n/catalog.ts`; tests `test/renderer-state.test.ts`, `test/renderer-layout.test.ts`, `test/i18n.test.ts`

- [ ] Add failing tests showing an exact pending chat or the unidentified no-extension fallback can be selected from approved root names in Desktop and that no arbitrary native path input exists.
- [ ] Add failing tests proving unidentified fallback authority is explicit, non-durable, ignored when exact identity exists, and cannot start a Prime/subagent Run.
- [ ] Confirm RED.
- [ ] Add the fallback UI and retry guidance while keeping extension UX primary.
- [ ] Re-run renderer/i18n tests.
- [ ] Run `npm run typecheck`, `npm run verify`, and `npm run build` because the extension and renderer packaging surface changed.
- [ ] Run `git diff --check` and inspect the final diff for native-path leakage or authority widening.

