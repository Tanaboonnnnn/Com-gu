# Enabled Folder Allowlist Design

## Goal
Replace chat-bound workspace selection as the primary filesystem/terminal authorization path with a persistent app-managed enabled-folder allowlist. A folder toggle is the user-facing authority: ON means ComGu may access that approved root and its descendants; OFF means access is denied.

## User experience
- The Home Folders list shows an ON/OFF switch for every approved root.
- A newly added root starts ON.
- Multiple roots may be ON at the same time; there is no Active, Primary, or Shared-folder selection in the normal UI.
- The user tells ChatGPT which project/folder to use in natural language. ComGu may inspect any enabled root and descendants to resolve that intent.
- If all roots are OFF, file and terminal operations fail closed with a clear no-enabled-folders error.
- Missing or unresolved ChatGPT conversation identity must not trigger a workspace picker or block ordinary file/terminal access when enabled roots exist.

## Authorization model
- `Config.roots` remains the set of approved roots, preserving canonical-path containment and root identity.
- Each root gains persistent enabled/disabled state. Enabled approved roots are the global filesystem/terminal authority exposed to ordinary MCP calls.
- Chat identity remains required where it is actually security-relevant: recording attribution, agent identity, terminal session ownership, worker routing, continuation, and other cross-chat boundaries. It is no longer required merely to choose which approved root may be accessed.
- Existing `WorkspaceScope` remains an internal narrowing primitive for active Runs/workers. A Run may only inherit or narrow the currently enabled root set; it may never widen beyond enabled roots.
- Windows MXC command confinement remains fail-closed and receives the effective enabled/narrowed root set. No unrestricted command fallback is introduced.
- Disabling a root revokes new filesystem/terminal authority immediately. Existing long-lived command/session behavior must follow the current ownership/lifecycle rules and may not gain access to a disabled root on any subsequent operation.

## Chat-bound workspace removal
- Remove the Desktop fallback workspace picker and per-chat Primary/Shared workspace selection from the normal UI.
- `chat-workspace-scope` must no longer be consulted as the prerequisite for ordinary Core file/terminal authorization.
- Missing chat id must not produce `WORKSPACE_SCOPE_REQUIRED` solely because no per-chat folder selection exists.
- Per-chat learned cwd in `workspace.ts` remains convenience state only. It may choose a default working directory only when that cwd is still inside an enabled root; otherwise relative/omitted workdir must fail or require an explicit path rather than guess another project.

## Persistence and migration
- Enabled state is persisted in app config alongside root metadata.
- Existing installations migrate conservatively by enabling all already-approved roots. This preserves the authority users explicitly granted before this release while removing the extra chat-selection step.
- Removing a root deletes its enabled state with the root entry. Rename preserves enabled state because native root identity is unchanged.

## Renderer and IPC
- Add one root-toggle IPC operation that mutates only the enabled state of an existing approved root.
- The renderer switch reflects authoritative config returned from main; optimistic UI must not create authority before the main-process config write succeeds.
- Remove/retire the workspace fallback picker and Run Primary/Shared selection controls from the normal user flow. Run scope information may remain display-only where useful for diagnostics.

## Security invariants
- OFF roots are rejected for both virtual and native path spellings.
- Symlink/reparse/canonical-path protections remain unchanged.
- Caller identity, terminal ownership, pairing, WorkspaceScope narrowing, and Desktop/Wayland authority are not weakened.
- No enabled roots means no file/terminal authority.
- Worker scope can only be equal to or narrower than the prime/run scope, and the prime/run scope can only contain enabled approved roots.
- Disabling/rebinding/removing a root cannot resurrect stale authority from a persisted Run/chat snapshot.

## Tests
Add deterministic regression coverage for at least:
1. unresolved/missing chat id + enabled root => ordinary file access works;
2. unresolved/missing chat id + enabled root => command scope resolves without per-chat workspace selection;
3. disabled root => virtual path rejected;
4. disabled root => native path rejected;
5. all roots disabled => fail closed;
6. add root defaults ON; toggle persists across config reload;
7. rename preserves enabled state; remove deletes it;
8. active Run/worker cannot widen into a disabled root;
9. Windows command sandbox receives only enabled/effective roots;
10. renderer toggle round-trip and removal of the old fallback picker flow.

## Out of scope
- Removing chat identity from recording, agents, terminal ownership, or continuation.
- Removing WorkspaceScope as an internal Run/worker narrowing mechanism.
- Adding Primary workspace, automatic project guessing across disabled roots, or unrestricted shell access.
- Changing Desktop screenshot/input authority.

## Versioning
This is a behavior/UX change and belongs to the v3.3.0 development line rather than modifying the already-released v3.2.0 artifacts.
