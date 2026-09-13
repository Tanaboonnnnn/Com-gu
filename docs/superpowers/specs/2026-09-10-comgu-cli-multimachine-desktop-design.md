# ComGu CLI, Multi-Machine Routing, and Cross-Platform Desktop Design

Date: 2026-09-10
Status: Draft for user review
Scope: ComGu main repository only

## 1. Summary

ComGu will gain a lightweight CLI/TUI frontend that runs the same ComGu runtime as the Electron desktop app without starting Electron, Chromium, the renderer, tray UI, browser bridge, session recorder, Goal loop, or multi-agent machinery when those features are not part of the selected runtime profile.

Every ComGu installation will also gain a stable machine identity and a user-facing machine name. ChatGPT will continue to connect directly to each machine; V1 deliberately does not add a fleet router or a central control plane. Connector names make the machine explicit, for example `ComGu · gaming-pc Core`, `ComGu · gaming-pc Desktop`, and `ComGu · home-server Core`.

The CLI may expose the Desktop surface as well as Core when the host has a usable graphical session. V1 keeps the existing Windows desktop implementation and adds a Linux desktop adapter. macOS desktop automation is designed into the seam but implemented later.

The design preserves the current security posture: WorkspaceScope remains authoritative for filesystem access, Windows command confinement remains MXC-backed and fail-closed, `CALLER_IDENTITY_REQUIRED` behavior is not weakened, Linux insecure `v10` credential storage remains rejected, secrets never fall back to plaintext, exact search behavior remains unchanged, and Core and Desktop remain separate MCP discovery surfaces.

## 2. Goals

1. Run ComGu on servers, VMs, old PCs, and low-resource machines without Electron.
2. Keep one implementation of Core behavior rather than creating a second CLI-specific Core.
3. Let a user operate several ComGu machines from one ChatGPT account and refer to a machine naturally by name in chat.
4. Keep each machine independently connected; one machine going offline must not break the others.
5. Let CLI installations expose `observe` and `computer` when a graphical desktop is available.
6. Support Windows Desktop and Linux Desktop in V1 through one model-facing `observe` / `computer` contract.
7. Keep the CLI attractive interactively while making daemon mode minimal and scriptable.
8. Make optional features truly optional in the dependency graph.
9. Preserve existing security invariants and fail-closed behavior.
10. Keep the design ready for a later macOS Desktop adapter without forcing macOS work into V1.

## 3. Non-goals for V1

V1 does not add a central fleet router, one connector multiplexing all machines, peer-to-peer ComGu control, LAN auto-discovery, a cloud device registry, a web dashboard, automatic guessing of unknown machine names, browser-extension features in the CLI profile, session recording/Compact & Resume/Goal/multi-agent in the CLI profile, a ComGu skill system, zvec, a false claim of MXC-equivalent Linux command confinement, or macOS desktop automation implementation.

## 4. Current Codebase Facts

The existing code already has useful seams that should be deepened rather than replaced:

- `src/main/connection.ts` owns MCP and tunnel lifecycle but still imports desktop-specific startup behavior.
- `src/main/mcp/surfaces.ts` defines the two real MCP discovery surfaces: Core and Desktop.
- `src/main/mcp/tools.ts` enforces real Core/Desktop tool separation.
- `src/main/mcp/server.ts` binds only to loopback, gives each surface an independent secret path, and constructs one handler per surface.
- `src/main/mcp/kernel.ts` centralizes dispatch, WorkspaceScope resolution, caller attribution, result recording, and error mapping, but statically imports optional session/agent/desktop implementations.
- `src/main/computer/index.ts` is a mature Windows-specific implementation built around Win32/UIA/SendInput and a long-lived PowerShell helper.
- `src/main/secrets.ts` contains important single-flight, mutation serialization, unreadable-ciphertext preservation, and Linux `v10` rejection logic, but its encryption provider is Electron `safeStorage`.
- `src/main/platform.ts` currently treats desktop automation as Windows-only.
- ordinary non-swarm Core calls already have a safe manual-workspace path when browser conversation identity is unavailable. CLI does not need weaker caller identity rules.

## 5. Deep-Module Design

The main modules with externally meaningful interfaces are:

1. `ComGuRuntime`
2. `MachineProfile`
3. `DesktopDriver`
4. `CredentialVault`

The existing Core/Desktop MCP surface split remains a real discovery seam and is not collapsed.

```text
                         MachineProfile
                  UUID / name / connector metadata
                               |
              +----------------+----------------+
              |                                 |
       Electron frontend                  CLI / TUI frontend
              |                                 |
              +--------------+------------------+
                             |
                       ComGuRuntime
                             |
        +--------------------+--------------------+
        |                    |                    |
   MCP / Core          CredentialVault       DesktopDriver
 Workspace / Tunnel         |                    |
                            |              +-----+-----+
                    credential adapters    |           |
                                         Windows      Linux
                                          V1           V1
                                                        |
                                                   X11 / Wayland

                                         macOS adapter: V2
```

The Electron and CLI/TUI frontends are presentation/lifecycle adapters. Neither owns Core behavior.

## 6. Runtime Profiles

### 6.1 Desktop-app profile

The Electron application may load Core, Desktop, browser bridge, session recording, Compact & Resume, Goal, multi-agent, Electron credential storage, renderer, tray, updater, and IPC according to existing user settings.

### 6.2 CLI profile

CLI loads only machine profile, config/roots, Core MCP, tunnel, terminal/file/search/patch functionality, credential vault, health/diagnostics, and optionally Desktop plus its selected adapter when a usable graphical session exists and Desktop permissions are enabled.

V1 CLI does not load browser bridge, session recorder/store, Goal, or multi-agent. This is a runtime-profile rule, not merely a default that an old config can accidentally override.

## 7. ComGuRuntime Module

The external interface stays small:

```ts
interface ComGuRuntime {
  start(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): RuntimeStatus;
  subscribe(listener: (status: RuntimeStatus) => void): () => void;
  shutdown(): Promise<void>;
}
```

Interface invariants:

- lifecycle transitions are serialized;
- final shutdown cannot be undone by late asynchronous connect work;
- accepted MCP requests drain normally on ordinary reconnect/disconnect;
- final process shutdown may use the existing bounded force policy;
- configuration changes never bypass capability checks;
- unloaded surfaces cannot be exposed;
- Desktop failure never takes Core down;
- machine identity loads before connector metadata is constructed.

Implementation is extracted incrementally from existing lifecycle code instead of rewritten.
## 8. MachineProfile Module

Each installation gets a stable machine identity stored separately from ordinary permission config. The module interface is intentionally small:

```ts
interface MachineProfile {
  snapshot(): MachineIdentity;
  connector(surface: SurfaceId): ConnectorMetadata;
  rename(name: string): Promise<MachineIdentity>;
  prepareClone(): Promise<void>;
}
```

`prepareClone` is an explicit exceptional lifecycle operation; ordinary startup/rename never rotates the UUID.

Conceptual persisted identity:

```ts
type MachineIdentity = {
  id: string;
  name: string;
  createdAt: string;
};
```

Rules:

- `id` is a cryptographically random UUID and remains stable for the installation.
- `name` is a user/model routing alias and may be renamed.
- hostname is never the security identity; it may only be offered as a setup suggestion.
- machine state is non-secret, atomically written, and schema-validated.
- malformed existing identity must not silently cause UUID regeneration; report a repairable error instead.
- V1 name grammar is `^[a-z0-9][a-z0-9._-]{0,31}$`.
- because there is no central registry, V1 cannot enforce global uniqueness across different ComGu machines. Setup/docs require unique names within the user's connector set and must not claim stronger enforcement.

Rename changes only the human alias. Because ChatGPT may cache connector metadata, rename output tells the user to refresh/reconnect the connector.

For VM templates, `comgu machine prepare-clone` requires the runtime to be stopped/disconnected and explicitly shows what will be scrubbed. Clone-unsafe state includes the machine UUID/name-confirmation state, per-machine tunnel IDs, persisted tunnel/API credentials, browser pairing credentials if present in that profile, and ephemeral local-control authentication state. Approved roots and ordinary permission booleans remain intact. This prevents two clones from silently sharing remote connector identity or credentials. V1 does not claim arbitrary after-the-fact clone detection without a registry or hardware fingerprinting.

## 9. Connector Metadata and Naming

One authority generates server name, suggested connector name, description, and card summary from `MachineProfile` plus surface.

Examples:

```text
ComGu · gaming-pc Core
ComGu · gaming-pc Desktop
ComGu · home-server Core
```

The display alias may change, but MCP server identity should remain stable across rename. It may therefore contain a stable non-secret machine reference derived from the UUID, for example:

```text
comgu-core-58d1a203
comgu-desktop-58d1a203
```

The exact encoding is implementation detail, but must be deterministic, stable across rename, and collision-resistant for a normal user connector set. The full UUID need not be exposed when a short stable reference is sufficient.

Core description intent:

```text
Read, edit, search and run commands only on the machine "home-server".
Use this connector for file, code, repository, build, test, terminal and process work targeting home-server.
Do not use it for another machine.
```

Desktop description intent:

```text
See and control only the graphical desktop of "gaming-pc".
Use this connector for screenshots, windows, mouse, keyboard and clipboard work targeting gaming-pc.
```

Descriptions remain concise because they are part of model discovery.

## 10. Multi-Machine Routing Contract

V1 uses direct per-machine connectors, so routing guarantees divide into locally enforced invariants and model routing policy.

### 10.1 Locally enforced

A ComGu process enforces that:

- its connectors operate only the local machine;
- Core and Desktop surfaces from that installation share one machine profile/reference;
- it never forwards a call to another ComGu machine;
- WorkspaceScope and capability gates remain authoritative regardless of what machine name appears in chat;
- tool results identify the machine that actually executed the call.

### 10.2 Model routing policy

Connector metadata instructs the model to follow this order:

1. explicit machine in the latest user instruction;
2. explicit machine already established for the current task;
3. the only applicable ComGu machine, if there is exactly one;
4. otherwise ask rather than guess.

Unknown or typo machine names must not be approximately matched. "All machines" is explicit multi-target intent.

Architecture A has no local server that sees the user's natural-language sentence before ChatGPT selects a connector. Therefore V1 must not claim cryptographic pre-execution proof that the model selected the intended machine. Stronger target enforcement would require a later routing authority/fleet design.

## 11. Machine Attribution in Tool Results

Every model-facing result gets machine attribution from one shared decorator rather than tool-by-tool code.

Preferred structured content:

```json
{
  "_comgu": {
    "machine": "home-server",
    "machineRef": "58d1a203",
    "surface": "core"
  }
}
```

Requirements:

- preserve existing structured content;
- attribute image results too;
- decorate successful and rejected calls;
- never include secrets;
- avoid rewriting normal text output merely to add attribution;
- test parallel fixture machines so results remain distinguishable.

This improves post-call attribution; it is not a substitute for pre-call routing correctness.

## 12. Core/Desktop Affinity

Core and Desktop from one installation advertise the same machine reference. Model policy for a mixed terminal+GUI task is:

```text
Core(machineRef=A) + Desktop(machineRef=A)
```

The runtime guarantees consistency within one installation. Independent machines cannot server-side enforce that ChatGPT never combines Core from A with Desktop from B under architecture A; metadata and result attribution make a mismatch visible instead. The implementation and docs must state this limitation truthfully.

## 13. MCP Surface Loading Seam

The current static `mcp/server.ts -> mcp/tools.ts -> tools-desktop.ts` chain makes a Core-only process pull Desktop implementation code. V1 changes startup so the runtime profile supplies only the surface modules it actually loads.

Conceptually:

```ts
type SurfaceModule = {
  id: SurfaceId;
  definition(profile: MachineProfile): SurfaceDefinition;
  register(registrar: SurfaceRegistrar): void;
};
```

There are already two real adapters at this seam: Core and Desktop.

Requirements:

- Core/Desktop remain separate discovery surfaces and MCP servers;
- Core has no hidden `computer` handler;
- Desktop has no Core handlers;
- per-surface secret paths remain independent;
- tools/list monotonicity remains per surface;
- a Core-only CLI process does not import the Desktop surface implementation;
- reuse the existing MCP server behavior rather than creating a second CLI MCP stack.

## 14. Optional Call-Lifecycle Weight

`mcp/kernel.ts` currently statically imports browser/session/agent machinery. The refactor separates always-required call execution from optional browser/session/agent lifecycle behavior behind one internal hook/module rather than many shallow interfaces.

Always-required behavior retains request tracking, capability enforcement, WorkspaceScope/manual-workspace resolution, error mapping, terminal session ownership, machine result attribution, and health timing/outcome data.

Desktop-app profile installs the existing browser/session/agent behavior. CLI installs a no-browser implementation that preserves the existing safe ordinary-call mode:

- no active swarm;
- no session/agent feature tools;
- no borrowed conversation identity;
- approved manual workspace roots remain authority;
- existing manual relative/defaulted path rules remain unchanged.

No desktop-app path may weaken `CALLER_IDENTITY_REQUIRED`, retired-worker, dormant-worker, or active Run semantics.

## 15. DesktopDriver Module

Desktop automation genuinely varies by OS/session, so this seam has multiple real adapters. Keep the external interface deep:

```ts
interface DesktopDriver {
  capabilities(): Promise<DesktopCapabilities>;
  observe(request: ObserveRequest): Promise<Observation>;
  act(request: DesktopActionRequest): Promise<ActionOutcome>;
  dispose(): Promise<void>;
}
```

The interface hides Win32 handles, UIA, PowerShell helper protocol, X11 atoms, AT-SPI objects, PipeWire nodes, Wayland portal sessions, and clipboard internals.

`tools-desktop.ts` translates the stable MCP schema to this interface and must not know OS implementation details.

Capability projection is runtime-derived rather than `process.platform`-only. Conceptually:

```ts
type DesktopCapabilities = {
  available: boolean;
  capture: boolean;
  pointer: boolean;
  keyboard: boolean;
  clipboardRead: boolean;
  clipboardWrite: boolean;
  windows: boolean;
  uiElements: boolean;
  focus: boolean;
  reason?: string;
};
```

The model-facing surface never advertises an operation the active adapter cannot actually execute. Capability state is invalidated and re-probed when the graphical session changes, a portal/session handle is revoked, or an adapter failure proves the previous capability snapshot stale.
## 16. Stable Desktop Tool Contract

The model continues to see only `observe` and `computer`. No OS-specific MCP tools such as `linux_screenshot` or `windows_click` are added.

The existing action vocabulary remains the target contract where supported: click, double-click, move, drag, scroll, type, keypress, focus, wait, clipboard read/write, screenshots, window inspection, and semantic UI references where available.

If an adapter lacks a capability it returns an explicit capability error. It must not silently substitute an operation with weaker or more dangerous semantics.

## 17. Windows Desktop Adapter

V1 preserves the mature Windows implementation and extracts it behind `DesktopDriver` incrementally. Existing Win32, UI Automation, SendInput, helper-process, screenshot-frame, verification, timeout, and process-retirement semantics remain the baseline.

The current implementation performs clipboard operations through Electron. Windows CLI cannot depend on Electron, so V1 moves clipboard behavior into the Windows desktop adapter through a non-Electron native/helper path. Electron Desktop then uses that same path.

Regression coverage must prove ordering such as "write clipboard, then Ctrl+V" remains serialized with other desktop actions. The Windows task is extraction first, not a rewrite.

## 18. Linux Desktop Adapter

V1 supports X11 and Wayland when the active graphical session supplies the required facilities.

Session discovery may use `XDG_SESSION_TYPE`, `WAYLAND_DISPLAY`, `DISPLAY`, D-Bus/session information, and actual mechanism probes. Environment variables are hints, not authorization proof.

### 18.1 X11

Where supported, the X11 adapter may provide screen capture, pointer/keyboard input, clipboard, window enumeration, focus, and AT-SPI semantic accessibility information. Every operation remains behind ComGu permissions.

### 18.2 Wayland

Wayland uses compositor-approved mechanisms. The intended direction is xdg-desktop-portal for authorized ScreenCast/RemoteDesktop sessions, PipeWire for capture, portal-mediated input where supported, AT-SPI where independently available, and approved clipboard mechanisms.

Wayland authorization may require a visible consent prompt and may be session-scoped. A daemon with no graphical session remains Core-only rather than pretending Desktop is available.

Degraded Desktop is a valid state, for example:

```text
Core      ready
Desktop   degraded
Capture   yes
Input     no
Clipboard yes
```

Desktop failure or denial never marks Core unhealthy.

## 19. macOS V2

The seam must permit a future macOS adapter without changing MCP schemas or multi-machine architecture. Expected technologies include ScreenCaptureKit, Accessibility, CGEvent, and Pasteboard, subject to feasibility and permission behavior when V2 is designed. V1 makes no macOS Desktop support claim.

## 20. CredentialVault Module

Credential security semantics remain centralized rather than duplicated per frontend/OS. The caller-facing interface stays small:

```ts
interface CredentialVault {
  status(): Promise<CredentialStatus>;
  get(key: SecretKey): Promise<string | null>;
  set(key: SecretKey, value: string): Promise<void>;
  delete(key: SecretKey): Promise<void>;
}
```

`CredentialVault` owns the behavior currently concentrated in `secrets.ts`: single-flight reads, serialized read-modify-write mutations, schema validation, forward-compatible unknown-string preservation, unreadable-ciphertext preservation, no silent deletion, no plaintext fallback, and retry when a secure provider is temporarily unavailable.

A small internal credential-provider seam supplies only host-specific secure operations. V1 needs real adapters for Windows non-Electron CLI (DPAPI/CurrentUser through a minimal native/helper path), Linux Secret Service where available, volatile injected credentials, and systemd encrypted credentials where supported for persistent service use. Electron safeStorage remains a legacy/desktop migration source where needed, especially for existing installs.

To make a profile usable by either Desktop or CLI without duplicating the logical secret store, the preferred V1 format is a frontend-independent encrypted vault: ComGu owns one AES-GCM encrypted secret map and a random master key; the host credential adapter protects/stores only that master key. This keeps cache/mutation/recovery semantics in one implementation while allowing Windows DPAPI, Linux Secret Service, and later macOS Keychain to satisfy the same internal seam.

Migration from existing Electron `secrets.bin` is transactional: decrypt with the existing supported provider, write and verify the new vault, then mark migration complete. Unreadable legacy ciphertext is never deleted or replaced by an empty vault. The plan must include rollback/upgrade fixtures so installing the CLI cannot destroy credentials owned by the Desktop app.

The provider does not own vault semantics. Security fixes in the vault therefore apply to every frontend. Provider implementations must not pass the master key or plaintext credentials in a process command line, generated environment file, or log; helper-based providers use an IPC/stdin mechanism that does not expose the value through process arguments.

Rules:

- Linux/Chromium hard-coded-key `v10` remains rejected absolutely.
- Environment credentials are process-local and never persisted by ComGu into `config.json` or a generated env file.
- If headless auto-connect is requested without a secure persistent credential source, setup/service installation explains the requirement and refuses to manufacture a plaintext credential file.

## 21. CLI Command Interface

The command interface is predictable and scriptable:

```text
comgu setup
comgu start
comgu stop
comgu connect
comgu disconnect
comgu status
comgu doctor
comgu logs

comgu roots list
comgu roots add <path>
comgu roots remove <name>

comgu permissions
comgu machine show
comgu machine rename <name>
comgu machine prepare-clone

comgu service install
comgu service start
comgu service stop
comgu service restart
comgu service status
```

Machine-readable forms include `comgu status --json` and `comgu doctor --json`. Non-interactive commands never render the full TUI.

## 22. Interactive TUI

Running `comgu` on an interactive TTY opens a compact dashboard. V1 intentionally avoids React/Ink-style terminal stacks.

```text
╭──────────────────────── ComGu ────────────────────────╮
│  ● ubuntu-laptop                                       │
│                                                       │
│  Connection      ● Connected                         │
│  ChatGPT         ● Reachable                         │
│  Core            ● Ready                             │
│  Desktop         ● Ready · Wayland                   │
│                                                       │
│  Desktop capabilities                                │
│  ✓ Screen   ✓ Input   ✓ Clipboard   ○ UI refs        │
│                                                       │
│  Approved roots                                      │
│  projects       ~/projects                           │
│                                                       │
│  Last request    exec_command · 4s ago               │
├───────────────────────────────────────────────────────┤
│ C Connect │ R Roots │ P Permissions │ L Logs │ Q Quit │
╰───────────────────────────────────────────────────────╯
```

Requirements:

- lightweight ANSI/terminal primitives plus Node input handling;
- render on state changes or bounded refresh, never a busy loop;
- graceful no-color and narrow-terminal modes;
- plain-text fallback when stdout is not a TTY;
- use the project's localization direction for Thai/English;
- daemon and JSON modes must not import TUI code at startup.

The target is polished but lightweight, not a terminal web app.

## 23. Setup Flow

`comgu setup` gathers machine name, approved roots, Core permissions, tunnel configuration, secure credential source, graphical/Desktop probe state, optional Desktop permissions, and exact ChatGPT connector metadata.

A headless machine may finish with only:

```text
ComGu · home-server Core
```

A graphical CLI machine may finish with:

```text
ComGu · ubuntu-laptop Core
ComGu · ubuntu-laptop Desktop
```

Failure to initialize Desktop never fails Core setup.

## 24. Linux Service Lifecycle

V1 uses a systemd user service by default rather than requiring root, conceptually under `~/.config/systemd/user/comgu.service`.

Requirements:

- `Restart=on-failure` with bounded behavior;
- no generated shell wrapper containing secrets;
- Core may run under a lingering user manager on a headless host;
- Desktop activates only when an authorized graphical user session is available;
- interactive use never requires service installation;
- if persistent auto-connect needs systemd encrypted credentials, setup probes support and gives exact guidance instead of downgrading storage.

V1 does not require a root system daemon.

### 24.1 Windows background lifecycle

`comgu service ...` is a cross-platform CLI concept; it does not imply that every OS uses the same native service mechanism.

A Desktop-capable Windows CLI must run in the interactive user's session. A traditional Windows Service runs in Session 0 and therefore cannot be treated as a valid Desktop host. V1 should use a per-user background/autostart mechanism such as Task Scheduler with a logon trigger and hidden console for the Desktop-capable profile.

Requirements:

- `comgu service install` on Windows installs the supported per-user background launch mechanism rather than a Session-0 Desktop process;
- Core and Desktop may both remain available while that user session exists;
- logout/session loss degrades Desktop truthfully rather than leaving a false ready state;
- no credential is embedded in the task command line or task definition;
- a future unattended Windows Server Core-only service may be designed separately if needed.

## 25. Single-Instance and State Ownership

Electron currently supplies its own single-instance lock. CLI/headless mode needs OS-independent ownership for the same ComGu data directory.

Requirements:

- exactly one runtime process owns one ComGu profile/data directory;
- `status`, `logs`, and service-management commands may inspect/control the owner without starting a competing runtime;
- a second `comgu start` fails cleanly or forwards administrative intent to the current owner;
- stale ownership state after a crash is recoverable;
- exactly one runtime owner may use a profile at a time. A CLI/TUI administrative client may attach to a Desktop-owned runtime through the local control channel, but it must not start a second runtime against that profile.

A narrow local administrative channel is justified because daemon and CLI/TUI are two real callers. Its interface is limited to operations such as status, connect, disconnect, shutdown, and safe settings reload. It must not mirror MCP tools or become a second automation protocol.

Security requirements: local-user access only; prefer a Unix-domain socket with owner-only permissions on Linux and a named pipe with user-scoped ACLs on Windows; use loopback TCP only as a fallback with random per-runtime authentication material; return no credential values; expose no file/command execution endpoint; never bind `0.0.0.0`.

## 26. Performance and Footprint

"Lightweight" is an acceptance property.

V1 verification must prove:

- Core-only CLI starts no Electron/Chromium process;
- Core-only CLI startup does not import browser bridge, session recorder/store, multi-agent, Goal, renderer, or Desktop adapter implementation;
- Desktop adapter is lazy-loaded only when needed;
- TUI is not loaded in daemon/JSON modes;
- idle CPU remains effectively idle apart from bounded tunnel/health work;
- CLI resident memory is materially below Electron Desktop on the same host;
- release notes publish measured results instead of inventing an arbitrary RAM promise.

Use dependency-graph/startup instrumentation tests as well as RSS measurement.

## 27. Packaging

V1 adds CLI artifacts without changing existing Desktop artifacts:

```text
ComGu-CLI-windows-x64.zip
ComGu-CLI-windows-arm64.zip
ComGu-CLI-linux-x64.tar.gz
ComGu-CLI-linux-arm64.tar.gz
```

Preferred initial packaging is compiled JavaScript plus production dependencies requiring a documented supported Node runtime. This avoids prematurely committing to Node SEA/native-addon packaging before native dependencies are proven compatible.

Requirements:

- no Electron runtime/package in CLI artifacts;
- no renderer assets;
- no browser-only implementation bundled into the CLI runtime path;
- target-native dependencies only;
- release checksums use the existing release pipeline;
- Windows x64/arm64 and Linux x64/arm64 CLI targets verified.

Windows CLI packaging is part of V1, but its build task follows shared runtime and Windows Desktop extraction so it reuses the non-Electron Windows credential and Desktop paths rather than creating temporary duplicates.
## 28. Search Behavior

Exact search behavior is preserved:

- with command execution disabled, Core exposes exact `find`;
- with command execution enabled, the exec path may use `rg` as it does today;
- no zvec/vector search is introduced;
- CLI extraction does not create a second search implementation.

## 29. Workspace and Command Security

Machine selection never expands filesystem authority. Each installation retains its own approved roots and permissions.

### 29.1 Windows

Run-scoped command execution keeps MXC ProcessContainer confinement. If confinement cannot be proven, existing fail-closed behavior remains.

### 29.2 Linux

V1 must describe Linux command execution truthfully. Workspace/path validation continues to protect ComGu file-tool resolution, but a shell launched as the Unix user retains that user's OS authority unless a verified Linux process sandbox is later added.

A future project may evaluate Landlock, bubblewrap, or systemd sandboxing. V1 does not parse command strings and call that a sandbox.

## 30. Caller Identity and Browser Independence

CLI V1 does not include browser-extension identity evidence. This does not justify weakening desktop-app protections.

The existing ordinary, non-swarm Core path already supports calls without a ChatGPT conversation identity by using approved manual-workspace roots. CLI deliberately stays in that supported mode:

- sessions off;
- multi-agent off;
- no active Run semantics requiring browser conversation attribution;
- no retired/dormant worker leases created by the CLI profile.

Desktop-app keeps all existing exact-request identity, `CALLER_IDENTITY_REQUIRED`, `WORKSPACE_SCOPE_REQUIRED`, retired-worker, and dormant-worker behavior. Regression tests must prove those refusals remain unchanged.

## 31. Health Model

`RuntimeStatus` describes independent concerns rather than one misleading connected boolean. It should cover Runtime, MCP Core, MCP Desktop, Core/Desktop tunnel state, last ChatGPT request/tool call, credential storage, graphical session, and Desktop capability state.

Examples:

```text
Core      Ready
Desktop   Degraded: screen available, input denied
Tunnel    Connected
ChatGPT   Last tool call 8s ago
```

```text
Core      Ready
Desktop   Unavailable: no graphical session
Tunnel    Connected
```

Desktop degradation never marks Core unhealthy.

## 32. Error Handling

Important cases and required behavior:

- malformed machine identity: stop model-facing startup and require explicit repair;
- secure credential provider unavailable: local Core may start, but credential-dependent tunnel auto-connect fails closed;
- no graphical session: Core ready, Desktop unavailable;
- Wayland portal denied: expose only remaining truthful Desktop capabilities;
- Desktop adapter crash: retire/reinitialize Desktop without taking Core down;
- stale daemon ownership after crash: recover ownership safely;
- connector rename not refreshed remotely: show refresh guidance;
- unsupported Desktop operation: explicit capability error, no silent fallback;
- tunnel outage: retain current reconnect/backoff semantics;
- errors and diagnostics never echo secrets or unintended absolute paths.

## 33. Testing Strategy

The interface is the test surface. Tests should not reach through modules merely to assert implementation details unless ordering itself is an invariant.

### 33.1 MachineProfile

Test first creation, restart stability, name grammar, rename without UUID rotation, malformed-file refusal, atomic persistence, clone preparation, stable machine reference, and Core/Desktop metadata generation.

### 33.2 ComGuRuntime contract

Run shared lifecycle cases against desktop-app and CLI profiles where applicable: serialized start/connect/disconnect/shutdown, late-connect shutdown safety, Core survival after Desktop failure, no unloaded surface exposure, one owner per data directory, and existing MCP drain semantics.

### 33.3 Dependency/footprint

Prove Core-only CLI startup does not load Electron, browser bridge, session recorder/store, agents, Goal, Desktop adapter, or TUI in daemon/JSON mode. These tests are mandatory because RSS alone can hide accidental dependency regressions.

### 33.4 MCP surfaces

Preserve and extend assertions for separate tools/list snapshots, no hidden cross-surface handlers, independent surface secret paths, consistent machine metadata, machine-attributed results, and exact find/exec exclusivity.

### 33.5 Windows DesktopDriver

The extracted Windows adapter passes existing desktop tests plus the shared driver contract. Additional focus: clipboard no longer depends on Electron, action ordering remains serialized, helper retirement remains bounded, frame/ref invalidation is unchanged, and MCP permission gates remain authoritative.

### 33.6 Linux integration matrix

V1 targets Ubuntu GNOME Wayland, Ubuntu GNOME X11, headless Ubuntu/Debian, and Linux arm64 headless build/runtime.

Hosted CI may not prove live portal/compositor behavior. Deterministic adapter tests and real-session RC validation must be reported separately. Wayland capabilities claimed for release require validation on a real graphical session.

### 33.7 Security regression

Keep coverage for WorkspaceScope, Windows MXC fail-closed confinement, caller identity refusals, no plaintext credential fallback, Linux `v10` rejection, loopback-only listeners, sanitized logs, no non-idempotent stale-call replay, desktop-app browser identity/disconnect behavior, no zvec, and no ComGu skill system.

## 34. Implementation Sequence Constraints

This document is design, not the implementation plan. The later plan must respect these dependencies:

1. Extract shared runtime while Desktop behavior remains unchanged.
2. Add MachineProfile and generated connector metadata before exposing multi-machine UX.
3. Make minimal CLI Core work before TUI polish or Linux Desktop.
4. Extract Windows desktop behavior behind `DesktopDriver` and prove parity before Linux becomes the second adapter.
5. Add dependency-graph tests before claiming CLI is lightweight.
6. Linux Desktop advertises only capabilities proven by the active session.
7. Packaging/release follows green runtime, CLI, and Desktop contracts.
8. macOS implementation waits until V1 is stable.

## 35. Migration and Backward Compatibility

Existing Desktop users must not lose roots, permissions, credentials, browser pairing, session data, or tunnel configuration.

On first upgrade to a machine-aware build:

- create and persist one machine UUID idempotently;
- preserve current tunnel IDs, roots, permissions, pairing, sessions, and credentials;
- keep legacy connector naming, metadata, and legacy MCP server identity active until the user explicitly confirms a machine alias, so an unattended Desktop upgrade does not strand or unexpectedly invalidate an already-configured ChatGPT connector;
- after confirmation, perform the one-time switch to machine-aware server identity/metadata and explain that ChatGPT requires connector refresh/reconnect before relying on machine-name routing;
- never silently create/delete remote connectors;
- if credential-vault migration is needed, complete and verify the new encrypted vault before marking migration complete; unreadable legacy ciphertext remains untouched.

Restarting halfway through migration must not rotate identity or duplicate state. Tests should begin from representative pre-machine config and credential fixtures.

## 36. Release Verification

A release carrying this design is incomplete until all applicable checks pass:

- existing `verify:ci` green;
- Windows Desktop regression suite green;
- Windows x64/arm64 and Linux x64/arm64 CLI packages boot/connect;
- headless CLI proves no graphical dependency requirement;
- Windows CLI background mode runs in the interactive user session when Desktop is enabled and does not rely on Session 0;
- Ubuntu X11 Desktop RC green where supported;
- Ubuntu Wayland Desktop RC green on a real graphical session for every capability claimed;
- package contents prove Electron/renderer/browser-only runtime dependencies are absent from CLI artifacts;
- production dependency audit passes project policy;
- SHA-256 checksums are generated and re-verified;
- measured CLI startup/memory numbers are recorded against Desktop.

Release notes must not claim macOS Desktop support or MXC-equivalent Linux confinement in V1.

## 37. User Experience Examples

With connectors:

```text
ComGu · gaming-pc Core
ComGu · gaming-pc Desktop
ComGu · ubuntu-laptop Core
ComGu · ubuntu-laptop Desktop
ComGu · home-server Core
```

Expected routing intent:

```text
"Check Docker on home-server."
  -> ComGu · home-server Core

"Look at the screen on ubuntu-laptop."
  -> ComGu · ubuntu-laptop Desktop

"Run the dev server on gaming-pc and then inspect the UI."
  -> Core and Desktop with the same advertised machine reference

"Check disk usage on all machines."
  -> fan out across named Core connectors and aggregate attributed results
```

If several machines are applicable and no target is established, model policy is to ask which machine rather than guess.

## 38. Alternatives Considered

### Electron `--headless`

Rejected as the primary CLI because it retains Electron/Chromium footprint.

### Rewrite Core in Go/Rust

Rejected for V1 because it duplicates mature security/tool semantics and creates drift between Desktop and CLI.

### Central fleet router

Deferred. It can provide stronger target enforcement and one connector for all machines, but adds a trust authority, registry, authentication protocol, availability dependency, and substantial routing implementation.

### OS-specific Desktop tools

Rejected. `observe` and `computer` remain the stable model vocabulary; OS variation belongs behind `DesktopDriver`.

### Many tiny Desktop interfaces

Rejected as shallow. Screenshot/window/input/clipboard interfaces would make callers coordinate implementation complexity. One deep `DesktopDriver` interface provides better leverage and locality while allowing private internal seams per adapter.

## 39. Explicit Invariants Carried Forward

Every later implementation task must preserve:

- ComGu main repository only; do not mix standalone ComGu-qwen work;
- no subagents unless the user explicitly changes that constraint;
- no zvec;
- no ComGu skill system;
- exact `find` behavior when command execution is disabled;
- WorkspaceScope authority;
- Windows MXC fail-closed command confinement;
- `CALLER_IDENTITY_REQUIRED` and stale/dormant worker protections;
- no automatic replay of non-idempotent mutations;
- no plaintext secret fallback;
- Linux `v10` hard-coded-key storage rejection;
- unreadable encrypted credentials preserved rather than silently deleted;
- MCP and administrative listeners local-only before intended tunnel publication;
- Desktop capability reporting truthful and independent from Core health;
- no machine-to-machine forwarding in V1;
- CLI lightweight claims backed by dependency and runtime measurements.

## 40. Design Acceptance

The design is ready for task-by-task implementation planning when the user confirms all of the following:

1. per-machine connectors remain the V1 routing architecture;
2. CLI is a frontend/runtime profile of normal ComGu, not a separate reduced product;
3. CLI may expose Desktop when a graphical session supports it;
4. Windows and Linux Desktop are V1; macOS Desktop is V2;
5. Core/Desktop remain separate connector surfaces;
6. machine UUID is stable authority while machine name is a renameable routing alias;
7. the model-routing limitation of direct per-machine connectors is accepted;
8. no central fleet router is required for V1;
9. lightweight dependency rules and all security invariants above are accepted.

After this spec is approved, the next step is a concrete implementation plan. Production code must not be changed before that planning transition.