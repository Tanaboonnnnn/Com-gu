/**
 * OS-enforced filesystem confinement for command execution.
 *
 * This contract deliberately does not treat an approved cwd, command parsing, process
 * ownership, or a Job Object as filesystem confinement. Callers may execute only when a
 * backend can prove that the effective workspace scope is enforced by the operating system.
 */

export interface WorkspaceScope {
  /** Canonical approved roots that the process may access. */
  readonly roots: readonly string[];
  /** Canonical working directory inside the allowed roots. */
  readonly cwd: string;
}

export type CommandSandboxUnavailableReason = 'windows_backend_unavailable' | 'unsupported_platform';

export interface CommandSandboxUnavailable {
  readonly available: false;
  readonly filesystemConfinement: 'unavailable';
  readonly backend: null;
  readonly scope: WorkspaceScope;
  readonly reason: CommandSandboxUnavailableReason;
}

export interface CommandSandboxAvailable {
  readonly available: true;
  readonly filesystemConfinement: 'os-enforced';
  /** Backend identifier supplied by the concrete implementation. */
  readonly backend: string;
  readonly scope: WorkspaceScope;
}

export type CommandSandboxCapability = CommandSandboxUnavailable | CommandSandboxAvailable;

function snapshotScope(scope: WorkspaceScope): WorkspaceScope {
  const roots = Object.freeze([...scope.roots]);
  return Object.freeze({ roots, cwd: scope.cwd });
}

export class CommandSandboxUnavailableError extends Error {
  readonly capability: CommandSandboxUnavailable;

  constructor(capability: CommandSandboxUnavailable) {
    super(`Command sandbox unavailable: ${capability.reason}`);
    this.name = 'CommandSandboxUnavailableError';
    this.capability = capability;
  }
}

/**
 * Reports only confinement that this runtime can actually instantiate.
 *
 * Windows 11 exposes Experimental_CreateProcessInSandbox in processmodel.dll, but using it
 * requires a native call boundary plus a verified SBOX FlatBuffer specification. This repo
 * currently has neither. Reporting the API as available merely because the OS may export it
 * would be a capability-confusion bug: Node's ordinary spawn/node-pty paths would still run
 * with the user's unrestricted filesystem token. Until a real backend owns process creation,
 * Windows therefore remains explicitly unavailable and callers must fail closed.
 */
export function commandSandboxCapability(
  scope: WorkspaceScope,
  platform: NodeJS.Platform = process.platform
): CommandSandboxCapability {
  const snapshot = snapshotScope(scope);
  if (platform === 'win32') {
    return Object.freeze({
      available: false,
      filesystemConfinement: 'unavailable',
      backend: null,
      scope: snapshot,
      reason: 'windows_backend_unavailable'
    });
  }
  return Object.freeze({
    available: false,
    filesystemConfinement: 'unavailable',
    backend: null,
    scope: snapshot,
    reason: 'unsupported_platform'
  });
}

/** Returns a proven sandbox capability or throws before any unrestricted process can spawn. */
export function requireCommandSandbox(
  scope: WorkspaceScope,
  platform: NodeJS.Platform = process.platform
): CommandSandboxAvailable {
  const capability = commandSandboxCapability(scope, platform);
  if (!capability.available) throw new CommandSandboxUnavailableError(capability);
  return capability;
}
