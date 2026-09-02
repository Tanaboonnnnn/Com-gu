import path from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { getPlatformSupport } from '@microsoft/mxc-sdk';

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

export type CommandSandboxUnavailableReason =
  | 'windows_backend_unavailable'
  | 'windows_host_preparation_required'
  | 'unsupported_platform';

export type CommandSandboxHostPreparationStep = 'prepare-system-drive' | 'prepare-null-device';

interface PlatformSupportSnapshot {
  readonly isSupported: boolean;
  readonly availableMethods: readonly string[];
  readonly isolationTier?: string;
  readonly isolationWarnings?: readonly string[];
}

export interface CommandSandboxHostPreparation {
  readonly required: boolean;
  readonly steps: readonly CommandSandboxHostPreparationStep[];
  /** Elevated MXC helper. ComGu never runs this implicitly while building/testing/spawning. */
  readonly helper: string | null;
}

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

export interface SandboxedCommandRequest {
  readonly command: readonly string[];
  readonly roots: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly tty: boolean;
}

type SandboxChildProcess = import('node:child_process').ChildProcess;

interface SandboxPtyProcess {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export type SandboxedCommandProcess =
  | Readonly<{ kind: 'child'; process: SandboxChildProcess }>
  | Readonly<{ kind: 'pty'; process: SandboxPtyProcess }>;

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

function mxcBinaryPath(fileName: 'wxc-exec.exe' | 'wxc-host-prep.exe'): string | undefined {
  if (process.platform !== 'win32' || (process.arch !== 'x64' && process.arch !== 'arm64')) return undefined;
  const relative = path.join('node_modules', '@microsoft', 'mxc-sdk', 'bin', process.arch, fileName);
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packaged = resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', relative) : null;
  if (packaged && existsSync(packaged)) return packaged;
  const development = path.resolve(process.cwd(), relative);
  return existsSync(development) ? development : undefined;
}

function hostPreparationForSupport(support: PlatformSupportSnapshot): CommandSandboxHostPreparation {
  const steps: CommandSandboxHostPreparationStep[] = [];
  if (support.isSupported && support.availableMethods.includes('processcontainer') && support.isolationTier === 'appcontainer-dacl') {
    const warnings = support.isolationWarnings ?? [];
    if (warnings.some((warning) => warning.includes('prepare-system-drive'))) steps.push('prepare-system-drive');
    if (warnings.some((warning) => warning.includes('prepare-null-device'))) steps.push('prepare-null-device');
  }
  return Object.freeze({
    required: steps.length > 0,
    steps: Object.freeze(steps),
    helper: mxcBinaryPath('wxc-host-prep.exe') ?? null
  });
}

/**
 * Read-only host readiness projection. MXC's probe suppresses a prep warning only after the
 * matching host state is present, so builds/tests can inspect this without changing ACLs.
 */
export function commandSandboxHostPreparation(
  support: PlatformSupportSnapshot = getPlatformSupport()
): CommandSandboxHostPreparation {
  return hostPreparationForSupport(support);
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
    const support = platform === process.platform ? getPlatformSupport() : null;
    if (support?.isSupported && support.availableMethods.includes('processcontainer')) {
      if (hostPreparationForSupport(support).required) {
        return Object.freeze({
          available: false,
          filesystemConfinement: 'unavailable',
          backend: null,
          scope: snapshot,
          reason: 'windows_host_preparation_required'
        });
      }
      return Object.freeze({
        available: true,
        filesystemConfinement: 'os-enforced',
        backend: 'mxc-processcontainer',
        scope: snapshot
      });
    }
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

/** Quote one Windows argv element for CreateProcess/CommandLineToArgvW-compatible parsing. */
function quoteWindowsArgument(argument: string): string {
  if (argument !== '' && !/[\s"]/.test(argument)) return argument;
  return `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
}

function windowsCommandLine(command: readonly string[]): string {
  if (command.length === 0) throw new Error('Command sandbox requires an executable.');
  return command.map(quoteWindowsArgument).join(' ');
}

function stringEnvironment(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env));
}

function findOnPath(env: NodeJS.ProcessEnv, fileName: string): string | null {
  const rawPath = env.Path ?? env.PATH ?? '';
  for (const directory of rawPath.split(path.delimiter).map((value) => value.trim()).filter(Boolean)) {
    const candidate = path.join(directory, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

let runtimeMirror: Promise<string | null> | null = null;

async function prepareNodeRuntimeMirror(env: NodeJS.ProcessEnv): Promise<string | null> {
  if (runtimeMirror) return runtimeMirror;
  runtimeMirror = (async () => {
    const node = findOnPath(env, 'node.exe');
    if (!node) return null;
    const sourceDir = path.dirname(node);
    const npm = path.join(sourceDir, 'npm.cmd');
    const npx = path.join(sourceDir, 'npx.cmd');
    const npmPackage = path.join(sourceDir, 'node_modules', 'npm');
    const nodeStat = await fs.stat(node);
    const key = createHash('sha256')
      .update('comgu-runtime-mirror-v3')
      .update(node)
      .update(String(nodeStat.size))
      .update(String(nodeStat.mtimeMs))
      .digest('hex')
      .slice(0, 16);
    const systemDrive = env.SystemDrive ?? process.env.SystemDrive ?? 'C:';
    if (!/^[A-Za-z]:$/.test(systemDrive)) throw new Error('Command sandbox could not resolve a safe Windows system drive.');
    // Keep the mirror as a direct child of the prepared drive root. Tier-3 AppContainer needs
    // metadata access to every ancestor of a Node entry script; putting this under %TEMP% would
    // require granting metadata rights to C:\Users and the profile chain, which we deliberately
    // refuse to do. The mirror contains runtime bytes only, never user/project data.
    const target = `${systemDrive}\\ComGuRuntime-${key}`;
    const marker = path.join(target, '.ready');
    if (existsSync(marker)) return target;

    if (existsSync(target)) {
      throw new Error(`Command sandbox runtime mirror exists without its ownership marker: ${target}`);
    }
    await fs.mkdir(target);
    try {
      await fs.copyFile(node, path.join(target, 'node.exe'));
      if (existsSync(npm)) await fs.copyFile(npm, path.join(target, 'npm.cmd'));
      if (existsSync(npx)) await fs.copyFile(npx, path.join(target, 'npx.cmd'));
      if (existsSync(npmPackage)) {
        await fs.cp(npmPackage, path.join(target, 'node_modules', 'npm'), { recursive: true });
      }
      await fs.writeFile(marker, 'ComGu sandbox runtime mirror\n', 'utf8');
    } catch (error) {
      await fs.rm(target, { recursive: true, force: true });
      throw error;
    }
    return target;
  })().catch((error) => {
    runtimeMirror = null;
    throw error;
  });
  return runtimeMirror;
}

async function runtimePolicy(
  command: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<{ readonlyPaths: string[]; env: NodeJS.ProcessEnv }> {
  const readonlyPaths = command[0] ? [path.dirname(command[0])] : [];
  // Tier-3 ProcessContainer must temporarily author DACL entries for every brokered path.
  // Program Files is intentionally not user-WRITE_DAC, so never mutate it or require elevation
  // just to make node/npm usable. Instead copy the small runtime into a user-owned private mirror
  // and expose only that mirror read-only. PATH itself is never projected wholesale.
  const mirror = await prepareNodeRuntimeMirror(env);
  if (!mirror) return { readonlyPaths, env };
  const originalPath = env.Path ?? env.PATH ?? '';
  return {
    readonlyPaths: [...new Set([...readonlyPaths, mirror])],
    env: {
      ...env,
      Path: `${mirror}${path.delimiter}${originalPath}`,
      PATH: `${mirror}${path.delimiter}${originalPath}`
    }
  };
}

/**
 * Spawn one command through MXC ProcessContainer. This owns process creation; callers must not
 * fall back to Node spawn/node-pty if this throws.
 */
export async function spawnSandboxedCommand(request: SandboxedCommandRequest): Promise<SandboxedCommandProcess> {
  if (process.platform !== 'win32') {
    throw new CommandSandboxUnavailableError({
      available: false,
      filesystemConfinement: 'unavailable',
      backend: null,
      scope: snapshotScope({ roots: request.roots, cwd: request.cwd }),
      reason: 'unsupported_platform'
    });
  }

  const mxc = await import('@microsoft/mxc-sdk');
  const capability = commandSandboxCapability({ roots: request.roots, cwd: request.cwd });
  if (!capability.available) throw new CommandSandboxUnavailableError(capability);

  const runtime = await runtimePolicy(request.command, request.env);
  const config = mxc.createConfigFromPolicy(
    {
      version: '0.8.0-alpha',
      filesystem: {
        readwritePaths: [...request.roots],
        // Runtime exceptions are deliberately narrow: only the selected shell directory and
        // PATH directories that actually contain the small supported developer-tool baseline.
        // User/project data remains RW only through WorkspaceScope roots.
        readonlyPaths: runtime.readonlyPaths,
        clearPolicyOnExit: true
      },
      network: {
        egress: { default: 'deny' },
        ingress: { default: 'deny', hostLoopback: 'deny' }
      },
      ui: {
        // Filesystem confinement is this boundary's job. Win32k lockdown breaks Windows
        // PowerShell/.NET startup on the AppContainer fallback tier, so do not add a UI
        // mitigation that the terminal contract never asked for.
        allowWindows: true,
        clipboard: 'none',
        allowInputInjection: false
      }
    },
    'process'
  );
  config.process = {
    commandLine: windowsCommandLine(request.command),
    cwd: request.cwd
  };
  config.lifecycle = { destroyOnExit: true, preservePolicy: false };

  const env = stringEnvironment(runtime.env);
  const executablePath = mxcBinaryPath('wxc-exec.exe');
  if (!executablePath) {
    throw new CommandSandboxUnavailableError({
      available: false,
      filesystemConfinement: 'unavailable',
      backend: null,
      scope: snapshotScope({ roots: request.roots, cwd: request.cwd }),
      reason: 'windows_backend_unavailable'
    });
  }
  if (request.tty) {
    const handle = mxc.spawnSandboxFromConfig(config, { usePty: true, executablePath }, request.cwd, env) as SandboxPtyProcess;
    return Object.freeze({ kind: 'pty' as const, process: handle });
  }
  const handle = mxc.spawnSandboxFromConfig(config, { usePty: false, executablePath }, request.cwd, env);
  return Object.freeze({ kind: 'child' as const, process: handle });
}
