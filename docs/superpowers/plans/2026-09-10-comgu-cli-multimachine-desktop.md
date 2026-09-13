# ComGu CLI, Multi-Machine Routing, and Cross-Platform Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight ComGu CLI/TUI and shared runtime, stable per-machine connector identity/routing, and Desktop control from CLI on Windows and Linux without weakening current ComGu security or duplicating Core behavior.

**Architecture:** Extract the existing lifecycle into one deep `ComGuRuntime` module used by Electron and CLI. Add a deep `MachineProfile` module for stable UUID/name/connector metadata, a deep `CredentialVault` with host credential adapters, and a deep `DesktopDriver` seam with Windows and Linux adapters. Core/Desktop remain separate MCP surfaces; CLI loads optional modules lazily and never needs Electron/Chromium for Core-only use.

**Tech Stack:** TypeScript, Node.js, Electron 43 for the existing desktop frontend only, Vitest, MCP Node/server packages, existing Codex-derived Core tools, existing OpenAI tunnel client, Windows PowerShell/Win32/UIA helper, Linux X11/xdg-desktop-portal/PipeWire-compatible adapters where available, systemd user units on Linux, Task Scheduler per-user background launch on Windows.

**Spec:** `docs/superpowers/specs/2026-09-10-comgu-cli-multimachine-desktop-design.md`

## Global Constraints

- ComGu main repository only; do not mix standalone ComGu-qwen work.
- No subagents unless the user explicitly changes that constraint.
- V1 uses per-machine direct connectors; no central fleet router or peer-to-peer ComGu forwarding.
- CLI is normal ComGu through a different frontend/runtime profile, not a reduced fork.
- Windows and Linux Desktop support are V1; macOS Desktop implementation is V2, but V1 interfaces must not block it.
- Core and Desktop remain separate MCP discovery surfaces and separate per-surface secret paths.
- Machine UUID is stable authority; machine name is a renameable human/model routing alias.
- Unknown/typo machine names are never approximately matched by ComGu.
- WorkspaceScope remains authoritative for filesystem tools.
- Windows MXC command confinement remains fail-closed.
- `CALLER_IDENTITY_REQUIRED`, retired/dormant worker protections, and no-non-idempotent-replay rules remain unchanged for Desktop-app mode.
- CLI profile does not load browser/session/Goal/multi-agent machinery and therefore does not create those browser-identity-dependent states.
- Exact search behavior remains: `find` when command execution is disabled; exec/rg path when enabled; no zvec.
- No ComGu skill system.
- No plaintext secret fallback; Linux Chromium `v10` storage remains rejected.
- Existing encrypted credentials are migrated transactionally and never silently deleted or replaced when unreadable.
- CLI daemon/JSON modes must not import Electron, renderer, browser bridge, session recorder/store, Goal, multi-agent, TUI, or Desktop implementation when not needed.
- Desktop capabilities must be runtime-derived and truthful; Desktop failure/degradation must not mark Core unhealthy.
- Windows Desktop-capable background mode runs in the interactive user's session, not Session 0.
- V1 CLI packages: Windows x64/ARM64 and Linux x64/ARM64.
- Existing Desktop release targets and current browser extension behavior must remain supported.

---

## File Structure Map

Create focused files rather than moving the whole repository at once:

- `src/main/runtime/runtime.ts` — deep `ComGuRuntime` implementation and small lifecycle interface.
- `src/main/runtime/profile.ts` — runtime profile flags (`desktop-app` / `cli`) and lazy feature policy.
- `src/main/machine/profile.ts` — stable machine identity persistence, rename, clone preparation.
- `src/main/machine/metadata.ts` — one authority for server/connector metadata generation.
- `src/main/credentials/vault.ts` — frontend-independent encrypted secret-map semantics.
- `src/main/credentials/provider.ts` — internal credential-provider interface only.
- `src/main/credentials/electron-provider.ts` — Electron safeStorage adapter/migration source.
- `src/main/credentials/windows-provider.ts` — Windows CurrentUser DPAPI provider for non-Electron CLI.
- `src/main/credentials/linux-provider.ts` — Linux Secret Service/injected/systemd credential provider selection.
- `src/main/desktop/driver.ts` — deep `DesktopDriver` interface and capability/result types.
- `src/main/desktop/windows.ts` — adapter over existing Windows computer implementation.
- `src/main/desktop/linux/index.ts` — Linux adapter chooser and runtime probe.
- `src/main/desktop/linux/x11.ts` — X11 capture/input/window/clipboard implementation.
- `src/main/desktop/linux/wayland.ts` — Wayland portal/capability implementation.
- `src/cli/index.ts` — CLI entrypoint and command parser.
- `src/cli/control-client.ts` — local administrative channel client.
- `src/cli/commands/*.ts` — focused setup/status/config/service commands.
- `src/cli/tui.ts` — lightweight ANSI TUI loaded only for interactive `comgu`.
- `src/cli/service-linux.ts` — systemd user lifecycle.
- `src/cli/service-windows.ts` — per-user Task Scheduler lifecycle.
- `scripts/build-cli.mjs` — CLI packaging for four V1 targets.
- `scripts/smoke-cli.mjs` — packaged CLI/runtime smoke.
- Existing `src/main/connection.ts`, `src/main/mcp/*`, `src/main/computer/*`, `src/main/secrets.ts`, and `src/main/index.ts` are adapted incrementally and remain sources of established behavior during extraction.

Tests are added beside current suite naming conventions under `test/`.

---

### Task 1: Freeze Shared-Runtime Baseline and Introduce Runtime Profile

**Files:**
- Create: `src/main/runtime/profile.ts`
- Test: `test/runtime-profile.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces: `type RuntimeProfileName = 'desktop-app' | 'cli'`
- Produces: `runtimeProfile(name): RuntimeProfile`
- `RuntimeProfile` exposes booleans `browser`, `sessions`, `goal`, `agents`, `desktop`, `electronFrontend`.

- [ ] **Step 1: Write failing profile tests** covering desktop-app parity and CLI hard-off rules for browser/session/Goal/agents.
- [ ] **Step 2: Run** `npm test -- --run test/runtime-profile.test.ts` and verify failure because the module does not exist.
- [ ] **Step 3: Implement `runtimeProfile()`** as a pure function with CLI hard-offs independent of config.
- [ ] **Step 4: Add one index bootstrap assertion/use** so the Electron entrypoint explicitly selects `desktop-app` rather than relying on implicit defaults.
- [ ] **Step 5: Run** `npm test -- --run test/runtime-profile.test.ts test/config.test.ts test/shutdown.test.ts` and verify green.
- [ ] **Step 6: Commit** `refactor(runtime): define explicit ComGu runtime profiles`.

### Task 2: Add Stable MachineProfile and Clone-Safe Identity

**Files:**
- Create: `src/main/machine/profile.ts`
- Create: `src/main/machine/metadata.ts`
- Test: `test/machine-profile.test.ts`
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces: `MachineIdentity { id: string; name: string; createdAt: string; confirmed: boolean }`
- Produces: `loadMachineProfile(dataDir): Promise<MachineIdentity>`
- Produces: `renameMachine(dataDir, name): Promise<MachineIdentity>`
- Produces: `prepareMachineClone(dataDir, scrubber): Promise<void>`
- Produces: `connectorMetadata(machine, surface, legacyMode)` returning stable server name plus display metadata.

- [ ] **Step 1: Write failing tests** for first creation, restart stability, exact name grammar, rename without UUID rotation, malformed-file refusal, atomic persistence, and legacy-mode metadata.
- [ ] **Step 2: Add clone-preparation negative tests** proving approved roots/permissions survive while UUID confirmation, tunnel IDs/credentials, browser pairing credentials, and ephemeral control auth are scrubbed through an injected scrubber.
- [ ] **Step 3: Run** `npm test -- --run test/machine-profile.test.ts` and verify RED.
- [ ] **Step 4: Implement profile persistence** with cryptographic UUID creation, schema validation, atomic temp-write/rename, and no silent regeneration on malformed existing state.
- [ ] **Step 5: Implement metadata generation** with stable UUID-derived server identity and renameable `ComGu · <name> Core/Desktop` display names.
- [ ] **Step 6: Run** `npm test -- --run test/machine-profile.test.ts` and verify GREEN.
- [ ] **Step 7: Commit** `feat(machine): add stable ComGu machine identity`.

### Task 3: Make MCP Surface Metadata Machine-Aware Without Breaking Legacy Users

**Files:**
- Modify: `src/main/mcp/surfaces.ts`
- Modify: `src/main/mcp/tools.ts`
- Modify: `src/main/mcp/server.ts`
- Modify: `src/main/connection.ts`
- Test: `test/mcp.test.ts`
- Test: `test/machine-profile.test.ts`

**Interfaces:**
- Consumes: `connectorMetadata()` from Task 2.
- Produces: runtime surface definitions generated from the active machine profile.

- [ ] **Step 1: Add failing MCP tests** proving Core/Desktop from one install share one machine reference, renaming changes display metadata but not server identity, and legacy mode retains existing `ComGu Core` / `ComGu Desktop` plus historical server names until confirmation.
- [ ] **Step 2: Add negative test** proving machine-aware Core cannot register Desktop tools and vice versa.
- [ ] **Step 3: Run focused MCP tests** and verify RED.
- [ ] **Step 4: Replace static model-facing metadata reads** with runtime generated definitions while preserving `SurfaceId`, declared tools, monotonic exposure, and independent secret paths.
- [ ] **Step 5: Update connection status cards** to use generated metadata without changing tunnel lifecycle semantics.
- [ ] **Step 6: Run** `npm test -- --run test/mcp.test.ts test/tunnel.test.ts test/config.test.ts test/machine-profile.test.ts`.
- [ ] **Step 7: Commit** `feat(mcp): make connector metadata machine aware`.

### Task 4: Add Machine Attribution to Every Model-Facing Tool Result

**Files:**
- Modify: `src/main/mcp/kernel.ts`
- Modify: `src/main/mcp/call-context.ts`
- Test: `test/mcp.test.ts`

**Interfaces:**
- Consumes: active machine identity.
- Produces: shared result decorator adding `structuredContent.machine = { id, name }` and a bounded textual machine prefix only where needed for ambiguity.

- [ ] **Step 1: Add failing tests** for `read`, `exec_command`, `apply_patch`, `observe`, and error results showing consistent machine attribution.
- [ ] **Step 2: Add negative test** proving existing structured content is merged, not replaced.
- [ ] **Step 3: Run focused tests** and verify RED.
- [ ] **Step 4: Implement one decorator in dispatch** rather than editing individual tools.
- [ ] **Step 5: Verify recorder stores the delivered attributed result** without exposing host paths or credentials.
- [ ] **Step 6: Run** `npm test -- --run test/mcp.test.ts test/session.test.ts`.
- [ ] **Step 7: Commit** `feat(mcp): attribute results to the executing machine`.

### Task 5: Extract Deep ComGuRuntime From Electron Bootstrap

**Files:**
- Create: `src/main/runtime/runtime.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/connection.ts`
- Modify: `src/main/shutdown.ts`
- Test: `test/runtime.test.ts`
- Test: `test/shutdown.test.ts`
- Test: `test/mcp-shutdown.test.ts`

**Interfaces:**
- Produces: `ComGuRuntime` with only `start`, `connect`, `disconnect`, `status`, `subscribe`, `shutdown`.
- Constructor/factory accepts dependencies/profile instead of creating frontend-specific dependencies internally.

- [ ] **Step 1: Add failing runtime contract tests** for serialized lifecycle, late-connect shutdown invalidation, normal MCP drain, bounded final shutdown, and Core survival when optional Desktop initialization fails.
- [ ] **Step 2: Run** `npm test -- --run test/runtime.test.ts test/shutdown.test.ts test/mcp-shutdown.test.ts` and verify RED.
- [ ] **Step 3: Extract lifecycle implementation incrementally** from `connection.ts`/`index.ts` without rewriting tunnel/server behavior.
- [ ] **Step 4: Keep Electron bootstrap as an adapter** that initializes Electron-only paths/IPC/tray then drives `ComGuRuntime`.
- [ ] **Step 5: Verify no current renderer/preload protocol changes** are required.
- [ ] **Step 6: Run** runtime, connection-adjacent, shutdown, MCP, tunnel, IPC tests.
- [ ] **Step 7: Commit** `refactor(runtime): share ComGu lifecycle across frontends`.

### Task 6: Remove Optional Browser/Agent/Session Weight From CLI Core Path

**Files:**
- Modify: `src/main/mcp/kernel.ts`
- Modify: `src/main/mcp/tools.ts`
- Modify: `src/main/mcp/tools-core.ts`
- Create focused internal adapters under `src/main/runtime/` only where two real runtime profiles vary.
- Test: `test/runtime-dependencies.test.ts`
- Test: `test/mcp.test.ts`

**Interfaces:**
- Consumes: `RuntimeProfile`.
- Produces: profile-aware call lifecycle where CLI has no browser/session/agent imports or states.

- [ ] **Step 1: Write a failing startup/dependency test** that launches/imports the Core-only CLI runtime and records loaded modules, asserting absence of Electron, bridge, recorder/store, agents, Goal, Desktop adapter, and TUI.
- [ ] **Step 2: Add behavior tests** proving CLI Core still enforces permissions, WorkspaceScope/manual roots, exact find/exec exclusivity, MCP drain, and command session ownership locally.
- [ ] **Step 3: Run tests and verify RED** on current static imports.
- [ ] **Step 4: Move optional call-lifecycle integrations behind profile-selected lazy/internal seams** while keeping Desktop-app behavior byte-for-byte equivalent at the model-facing level.
- [ ] **Step 5: Run** dependency test plus `test/mcp.test.ts test/workspace.test.ts test/agents.test.ts test/swarm.test.ts test/session.test.ts`.
- [ ] **Step 6: Commit** `refactor(runtime): keep CLI core dependency graph lightweight`.

### Task 7: Introduce Frontend-Independent CredentialVault

**Files:**
- Create: `src/main/credentials/provider.ts`
- Create: `src/main/credentials/vault.ts`
- Create: `src/main/credentials/electron-provider.ts`
- Modify: `src/main/secrets.ts`
- Test: `test/credential-vault.test.ts`
- Test: `test/secrets.test.ts`

**Interfaces:**
- Internal provider seam: protect/unprotect or master-key store operations only.
- External vault interface keeps logical get/set/delete/status semantics and owns cache, mutation queue, migration, schema validation, unreadable-state behavior.

- [ ] **Step 1: Write failing vault tests** for concurrent load/mutation, unknown field preservation, unreadable ciphertext preservation, no plaintext fallback, and provider unavailability retry.
- [ ] **Step 2: Add migration fixtures** representing existing Electron-encrypted stores and assert transactional `legacy decrypt -> new vault write -> verification -> migration marker` ordering.
- [ ] **Step 3: Add failure-injection tests** at every migration stage proving legacy ciphertext remains authoritative until verified commit.
- [ ] **Step 4: Run** `npm test -- --run test/credential-vault.test.ts test/secrets.test.ts` and verify RED.
- [ ] **Step 5: Implement AES-GCM logical vault semantics** with a random master key protected only by the host adapter; preserve existing safeStorage semantics as the Electron adapter/migration source.
- [ ] **Step 6: Keep Linux `v10` rejection** in the migration/provider path and preserve current diagnostics sanitization.
- [ ] **Step 7: Run secrets/vault tests plus bridge pairing tests** because bridge bearer persistence depends on the same vault.
- [ ] **Step 8: Commit** `refactor(secrets): centralize credential vault semantics`.

### Task 8: Add Non-Electron Windows and Linux Credential Adapters

**Files:**
- Create: `src/main/credentials/windows-provider.ts`
- Create: `src/main/credentials/linux-provider.ts`
- Test: `test/credential-provider-windows.test.ts`
- Test: `test/credential-provider-linux.test.ts`
- Modify: `src/main/runtime/runtime.ts`

**Interfaces:**
- Consumes internal credential-provider seam from Task 7.
- Produces host adapters selected by runtime profile/platform.

- [ ] **Step 1: Write Windows provider RED tests** for CurrentUser scoping, round trip, failure classification, and no plaintext file output.
- [ ] **Step 2: Implement minimal DPAPI CurrentUser helper path** with bounded process execution and sanitized errors.
- [ ] **Step 3: Write Linux provider RED tests** for Secret Service availability, process-local injected credential, persistent service credential capability detection, and refusal to persist insecure fallback.
- [ ] **Step 4: Implement Linux provider selection** without manufacturing `.env` files or accepting Chromium `v10`.
- [ ] **Step 5: Run platform provider tests** on available host and deterministic mocks for unavailable host paths.
- [ ] **Step 6: Run `test/secrets.test.ts test/credential-vault.test.ts test/bridge.test.ts`** to prove Desktop-app regression safety.
- [ ] **Step 7: Commit** `feat(secrets): support secure CLI credential providers`.

### Task 9: Introduce Deep DesktopDriver and Preserve Windows Parity

**Files:**
- Create: `src/main/desktop/driver.ts`
- Create: `src/main/desktop/windows.ts`
- Modify: `src/main/computer/index.ts`
- Modify: `src/main/mcp/tools-desktop.ts`
- Modify: `src/main/platform.ts`
- Test: `test/desktop-driver.test.ts`
- Test: `test/computer.test.ts`

**Interfaces:**
- Produces deep interface: `capabilities()`, `observe(request)`, `act(request)`, `dispose()`.
- MCP keeps current model-facing `observe` and `computer` names/actions.

- [ ] **Step 1: Write shared driver contract tests** for capability reporting, observe semantics, action serialization, unsupported-operation error, and bounded disposal.
- [ ] **Step 2: Add Windows parity assertions** for frame IDs, screenshot coordinates, UI refs, focus honesty, clipboard permissions, partial batch completion, and helper retirement.
- [ ] **Step 3: Run tests and verify RED** because no driver seam exists.
- [ ] **Step 4: Implement Windows adapter over existing computer implementation**; do not rewrite proven Win32/UIA helper behavior.
- [ ] **Step 5: Make `tools-desktop.ts` depend only on `DesktopDriver`** and runtime capabilities, not platform checks or PowerShell internals.
- [ ] **Step 6: Run all computer/Desktop/MCP tests** and verify Windows behavior parity.
- [ ] **Step 7: Commit** `refactor(desktop): place Windows automation behind deep driver`.

### Task 10: Build Minimal CLI Core and Local Administrative Channel

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/control-client.ts`
- Create: `src/main/runtime/control.ts`
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/connect.ts`
- Create: `src/cli/commands/setup.ts`
- Test: `test/cli.test.ts`
- Test: `test/runtime-control.test.ts`

**Interfaces:**
- CLI commands: `setup`, `start`, `stop`, `connect`, `disconnect`, `status`, `doctor`, `logs`, roots/permissions/machine commands.
- Local control interface exposes only status/connect/disconnect/shutdown/reload-safe-settings; never MCP file/command execution.

- [ ] **Step 1: Write CLI parsing/output RED tests** including `--json`, non-TTY plain output, invalid command exit codes, and no TUI import in JSON mode.
- [ ] **Step 2: Write control-channel RED tests** for one profile owner, stale owner recovery, local-user-only endpoint, credential redaction, and absence of file/command methods.
- [ ] **Step 3: Run focused tests and verify RED.**
- [ ] **Step 4: Implement local control channel** using owner-only named pipe on Windows and Unix-domain socket with owner-only permissions on Linux; loopback TCP only as guarded fallback.
- [ ] **Step 5: Implement minimal CLI commands** that either own `ComGuRuntime` or attach administratively to the existing owner.
- [ ] **Step 6: Verify Desktop app and CLI cannot start two runtime owners against one profile.**
- [ ] **Step 7: Run CLI/control/runtime tests plus MCP drain tests.**
- [ ] **Step 8: Commit** `feat(cli): add lightweight ComGu command interface`.

### Task 11: Add Lightweight TUI

**Files:**
- Create: `src/cli/tui.ts`
- Create: `src/cli/terminal.ts`
- Test: `test/cli-tui.test.ts`
- Modify: `src/cli/index.ts`

**Interfaces:**
- Consumes `RuntimeStatus`/control client only.
- TUI owns presentation and keyboard navigation; it does not own runtime behavior.

- [ ] **Step 1: Write snapshot-like plain string tests** for wide/narrow terminals, color/no-color, connected/degraded/offline states, and Thai/English labels using existing localization direction.
- [ ] **Step 2: Add dependency test** proving daemon/JSON commands do not import `tui.ts`.
- [ ] **Step 3: Run tests and verify RED.**
- [ ] **Step 4: Implement ANSI TUI** using Node terminal primitives, event/state-driven redraw, no busy loop, bounded refresh, and clean terminal restoration on exit/signals.
- [ ] **Step 5: Run TUI/CLI/dependency tests.**
- [ ] **Step 6: Commit** `feat(cli): add lightweight terminal dashboard`.

### Task 12: Add Linux and Windows Background Lifecycle

**Files:**
- Create: `src/cli/service-linux.ts`
- Create: `src/cli/service-windows.ts`
- Modify: `src/cli/index.ts`
- Test: `test/cli-service.test.ts`

**Interfaces:**
- `service install/start/stop/restart/status` is cross-platform CLI behavior; native implementation differs per OS.

- [ ] **Step 1: Write Linux RED tests** for generated systemd user unit, `Restart=on-failure`, no embedded secrets, headless lingering-user compatibility, and graphical-session Desktop gating.
- [ ] **Step 2: Write Windows RED tests** proving Desktop-capable mode uses a per-user Task Scheduler logon trigger/hidden console and never Session 0 or credentials in command line/task definition.
- [ ] **Step 3: Run tests and verify RED.**
- [ ] **Step 4: Implement Linux systemd user lifecycle** with deterministic unit rendering and explicit install/remove/status behavior.
- [ ] **Step 5: Implement Windows per-user Task Scheduler lifecycle** and truthful Desktop degradation after logout/session loss.
- [ ] **Step 6: Run service/CLI/security tests.**
- [ ] **Step 7: Commit** `feat(cli): manage ComGu background runtime per user`.

### Task 13: Add Linux Desktop Adapter — Probe and X11

**Files:**
- Create: `src/main/desktop/linux/index.ts`
- Create: `src/main/desktop/linux/x11.ts`
- Test: `test/desktop-linux.test.ts`
- Modify: `src/main/runtime/runtime.ts`

**Interfaces:**
- Consumes `DesktopDriver` from Task 9.
- Produces runtime capability probe and X11 adapter without changing MCP schema.

- [ ] **Step 1: Write RED probe tests** for headless, X11, Wayland, missing dependencies, and partial-capability reporting.
- [ ] **Step 2: Write X11 contract tests** for screen capture, pointer/keyboard input, clipboard, window listing/focus, unsupported semantic refs, and teardown.
- [ ] **Step 3: Run tests and verify RED.**
- [ ] **Step 4: Implement lazy Linux adapter selection** so headless CLI never imports X11/Wayland implementations.
- [ ] **Step 5: Implement X11 adapter** with bounded helper/process use and truthful capability flags; no silent fallback for unsupported UI refs.
- [ ] **Step 6: Run Linux driver contract, MCP Desktop, CLI dependency, and headless tests.**
- [ ] **Step 7: Commit** `feat(desktop): add Linux X11 desktop control`.

### Task 14: Add Linux Wayland Adapter With Portal-Gated Capabilities

**Files:**
- Create: `src/main/desktop/linux/wayland.ts`
- Modify: `src/main/desktop/linux/index.ts`
- Test: `test/desktop-wayland.test.ts`
- Test: `test/desktop-linux.test.ts`

**Interfaces:**
- Consumes `DesktopDriver` and exposes only capabilities proven by the current portal/session.

- [ ] **Step 1: Write deterministic RED tests** for portal absent, capture granted/input denied, both granted, permission revoked/session ended, and no graphical session.
- [ ] **Step 2: Add contract test** proving a denied input capability yields an explicit unsupported/permission error and never attempts synthetic input.
- [ ] **Step 3: Run tests and verify RED.**
- [ ] **Step 4: Implement portal/session negotiation** using approved desktop mechanisms; keep visible consent/session-scoped authorization semantics.
- [ ] **Step 5: Implement screenshot/input/clipboard operations only for capabilities actually available; unsupported window/UI semantics remain explicit.**
- [ ] **Step 6: Run Wayland/Linux/MCP Desktop tests.**
- [ ] **Step 7: Record real-session RC checklist** for Ubuntu GNOME Wayland because hosted CI cannot prove compositor/portal behavior alone.
- [ ] **Step 8: Commit** `feat(desktop): support portal-gated Wayland control`.

### Task 15: Complete Setup, Roots, Permissions, Machine UX

**Files:**
- Add/modify focused files under `src/cli/commands/`
- Modify: `src/main/config.ts`
- Modify: `src/cli/index.ts`
- Test: `test/cli-setup.test.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes MachineProfile, CredentialVault status, runtime/Desktop probe.
- Produces interactive and non-interactive setup/config behavior.

- [ ] **Step 1: Write RED tests** for machine naming, hostname suggestion without authority, approved root validation, permission selection, secure credential source selection, Desktop probe/opt-in, and exact connector metadata output.
- [ ] **Step 2: Add upgrade tests** proving existing Desktop config remains on legacy connector metadata until explicit alias confirmation.
- [ ] **Step 3: Run tests and verify RED.**
- [ ] **Step 4: Implement setup/roots/permissions/machine commands** using existing config validation rather than a second parser.
- [ ] **Step 5: Implement `machine prepare-clone` confirmation/output** and refuse while runtime is connected/owned by another process.
- [ ] **Step 6: Run CLI setup/config/machine/MCP tests.**
- [ ] **Step 7: Commit** `feat(cli): add machine-aware setup and permissions`.

### Task 16: Package CLI for Four V1 Targets and Prove Lightweight Output

**Files:**
- Create: `scripts/build-cli.mjs`
- Create: `scripts/smoke-cli.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/publish.yml` if artifact assembly needs explicit additions
- Test: `test/packaging.test.ts`
- Test: `test/runtime-dependencies.test.ts`

**Interfaces:**
- Produces `ComGu-CLI-windows-x64.zip`, `ComGu-CLI-windows-arm64.zip`, `ComGu-CLI-linux-x64.tar.gz`, `ComGu-CLI-linux-arm64.tar.gz`.

- [ ] **Step 1: Write RED packaging tests** for artifact names, package manifest, absence of Electron/renderer/browser-only payload, and target-native dependency selection.
- [ ] **Step 2: Add CLI build scripts** compiling JS plus production dependencies with documented supported Node runtime.
- [ ] **Step 3: Add packaged smoke** for `status --json`, Core MCP startup/connect, tunnel dependency location, and no graphical dependency in headless mode.
- [ ] **Step 4: Add release-matrix jobs/artifact assembly/checksum inclusion** for four CLI targets without removing any existing Desktop artifacts.
- [ ] **Step 5: Run packaging tests and host-available CLI package/smoke.**
- [ ] **Step 6: Measure startup/RSS vs Electron Desktop** and store measured values in release verification notes rather than hard-coded claims.
- [ ] **Step 7: Commit** `build(cli): package lightweight ComGu runtimes`.

### Task 17: Cross-Machine and Security Hardening Regression Sweep

**Files:**
- Test: `test/machine-routing.test.ts`
- Extend: `test/mcp.test.ts`
- Extend: `test/workspace.test.ts`
- Extend: `test/codex-runtime-parity.test.ts`
- Extend: `test/secrets.test.ts`
- Extend: `test/desktop-driver.test.ts`

**Interfaces:**
- Verifies contract; no new public interface.

- [ ] **Step 1: Add adversarial tests** for same/similar aliases, rename with stable UUID, Core/Desktop machine mismatch, parallel calls from multiple connector fixtures, and tool-result attribution.
- [ ] **Step 2: Add terminal ownership test** proving `write_stdin` can only reach a session created in the same runtime/machine ownership domain.
- [ ] **Step 3: Re-run existing negative security tests** for WorkspaceScope, Windows MXC, `CALLER_IDENTITY_REQUIRED`, retired/dormant workers, no stale mutation replay, Linux `v10`, loopback listeners, and sanitized diagnostics.
- [ ] **Step 4: Run** `npm run verify:ci` and require zero failures.
- [ ] **Step 5: Run** `npm run build` and `git diff --check`.
- [ ] **Step 6: Commit** `test: harden multi-machine and CLI security invariants`.

### Task 18: Documentation, RC Matrix, and Release Handoff

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md` only where architecture has genuinely changed
- Create: `docs/cli.md`
- Create release-note draft only when release version is chosen.

**Interfaces:**
- Documents exact user and maintainer contracts.

- [ ] **Step 1: Document CLI setup, TUI, service/background lifecycle, multi-machine naming, connector refresh after rename, clone preparation, and security limitations.**
- [ ] **Step 2: Update architecture guide** to describe shared runtime, MachineProfile, CredentialVault, DesktopDriver, Linux Desktop truthfulness, and new CLI package targets; remove stale Windows-only statements only where implementation is now real.
- [ ] **Step 3: Run documentation/placeholder and privacy scans** plus `git diff --check`.
- [ ] **Step 4: Run final local gate** `npm run verify:ci`, `npm run build`, production dependency audit, host package/smoke.
- [ ] **Step 5: Push implementation branch and open PR.** Do not merge before CI and Security are green on final head.
- [ ] **Step 6: Run release-candidate matrix** covering existing Desktop targets plus CLI Windows x64/ARM64 and Linux x64/ARM64, and real-session Ubuntu GNOME X11/Wayland RC for capabilities claimed.
- [ ] **Step 7: Only after every required gate is green**, merge, tag the chosen release version, publish, and verify actual artifacts plus SHA-256 checksums.

---

## Self-Review Checklist

- Spec coverage: every section 1–40 is represented by Tasks 1–18 or a Global Constraint.
- Deep modules remain small-interface modules: `ComGuRuntime`, `MachineProfile`, `CredentialVault`, `DesktopDriver`.
- No central router, generic OS mega-interface, or one-interface-per-desktop-primitive was introduced.
- Existing MCP Core/Desktop separation remains intact.
- Runtime dependency trimming is verified structurally, not inferred from RSS alone.
- CLI browser/session/Goal/agents exclusion is a profile invariant, not merely a config default.
- Windows CLI Desktop runs in interactive user session, never Session 0.
- Linux headless mode remains Core-only; Wayland claims require real-session RC evidence.
- Existing Electron credential data migrates transactionally and unreadable ciphertext is preserved.
- Migration keeps legacy connector/server metadata until explicit machine-name confirmation.
- Clone workflow scrubs clone-unsafe machine/tunnel/credential/pairing state while preserving roots and normal permissions.
- Exact search, WorkspaceScope, MXC, caller identity, no stale mutation replay, and no plaintext/v10 fallback remain explicit regression gates.
- Packaging includes Windows x64/ARM64 and Linux x64/ARM64 CLI artifacts without removing Desktop artifacts.
- No placeholders (`TBD`, `TODO`, “similar to Task N”) are intentionally present.

## Execution Mode

Execute inline in this session with `superpowers:executing-plans`; do not dispatch subagents. Follow TDD for each behavior-changing task and use fresh verification before every completion, push, PR, merge, tag, or release claim.
