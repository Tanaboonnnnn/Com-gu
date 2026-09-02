# ADR 3.1: Terminal Workspace Confinement

## Status

Accepted for ComGu 3.1.

## Context

`Config.roots` is the user's globally approved folder set. An active Run narrows that set to an immutable `WorkspaceScope`, and Workers may narrow it further. File tools already resolve every path through ComGu's canonical sandbox, but a shell spawned as the logged-in user would otherwise retain the user's full filesystem authority. Validating only the starting cwd, parsing command text, or placing the process in a Job Object is not a filesystem security boundary.

ComGu 3.1 therefore treats command execution as available only when the operating system can enforce the Run's effective roots for the full descendant process tree. There is no unrestricted fallback for an active Run.

## Decision

### Windows

Use `@microsoft/mxc-sdk` 0.8.0 with the Windows ProcessContainer backend. Immediately before launch, ComGu supplies the caller's already-resolved effective WorkspaceScope roots as MXC `filesystem.readwritePaths`. Both pipe and PTY sessions launch through the same MXC path, so child and grandchild processes inherit the boundary.

The policy additionally denies network egress/ingress by default. Runtime executable access is intentionally narrow and read-only. ComGu does not project the host PATH into the sandbox.

On the AppContainer+DACL fallback tier, MXC may require one-time host preparation for system-drive metadata. ComGu detects this from MXC's read-only platform probe. If preparation is required, command capability is unavailable until the user explicitly runs MXC's elevated `wxc-host-prep prepare-system-drive`; builds, tests, app startup, and command spawning never run that helper implicitly. The helper's system-drive ACE is non-inheriting metadata access only, not file-content or directory-list authority, and MXC provides the corresponding `unprepare-system-drive` rollback command.

Node/npm need a small runtime tree that MXC can broker without changing ACLs on `Program Files` or the user's profile ancestors. ComGu copies only Node/npm runtime bytes into a private, user-owned direct child of the prepared system drive (`C:\ComGuRuntime-<fingerprint>`) and exposes that mirror read-only. Workspace/project data never enters this mirror.

### Linux and macOS

ComGu 3.1 does not claim command confinement on a platform until a platform-specific backend has an adversarial integration proof equivalent to Windows. If the capability probe cannot prove a supported backend, Run-scoped command execution fails closed as unavailable.

## Session authority

Long-running command sessions bind to `{ conversationId, runId, effectiveScopeFingerprint }`. `write_stdin` recomputes current authority. A missing, replaced, or narrowed Run terminates the stale process and returns `WORKSPACE_SESSION_STALE`; old process authority is never allowed to outlive the Run/scope that created it.

## Security consequences

- Effective WorkspaceScope is the only read/write project-data authority passed to the OS sandbox.
- No command-text parser is relied on for confinement.
- No cwd-only, Job Object-only, or process-ownership-only claim is made.
- No active-Run fallback launches direct `child_process.spawn` or direct `node-pty` when MXC is unavailable or preparation is incomplete.
- Junction/reparse, nested shell, environment expansion, redirection, child-process, PTY, and package-manager cases are release-gated by real Windows denial tests.
- MXC `clearPolicyOnExit`/destroy-on-exit cleanup is required so temporary broker ACL entries do not persist after the sandbox exits.

## Release proof

`test/terminal-workspace-security.test.ts` creates outside-scope canaries and must prove denial while ordinary in-scope developer commands still work. Packaged Windows artifacts must contain both `wxc-exec.exe` and `wxc-host-prep.exe`; packaged-runtime qualification must not silently downgrade to unrestricted execution.

