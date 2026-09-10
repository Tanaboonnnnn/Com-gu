import { getConfig, initConfigPath, loadConfig } from '../main/config.js';
import { createCredentialVault } from '../main/credentials/vault.js';
import { createLinuxCredentialProvider } from '../main/credentials/linux-provider.js';
import { createWindowsCredentialProvider } from '../main/credentials/windows-provider.js';
import {
  applySettings,
  configureConnectionRuntime,
  connect,
  disconnect,
  getStatus,
  onStatusChange,
  shutdownConnection
} from '../main/connection.js';
import { currentMachineProfile, initMachineProfile, type MachineIdentity } from '../main/machine/profile.js';
import { createRuntimeControlServer } from '../main/runtime/control.js';
import { runtimeProfile } from '../main/runtime/profile.js';
import { createComGuRuntime } from '../main/runtime/runtime.js';
import type { ConnectionStatus } from '../shared/types.js';

export interface CliOwnerRuntime {
  start(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): ConnectionStatus;
  shutdown(): Promise<void>;
}

interface RunCliOwnerOptions {
  profileDir: string;
  machine: MachineIdentity;
  runtime: CliOwnerRuntime;
  reload?: () => Promise<void>;
  autoConnect?: boolean;
  installSignalHandlers?: boolean;
}

/**
 * Owns the one local CLI runtime for a profile. The control socket is acquired before runtime
 * startup, so a competing process cannot initialize a second MCP/tunnel owner against the same
 * profile. Shutdown replies over the control channel before the listener is retired.
 */
export async function runCliOwner(options: RunCliOwnerOptions): Promise<void> {
  let finished = false;
  let resolveFinished!: () => void;
  const finishedPromise = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  let signalHandler: (() => void) | null = null;

  const server = createRuntimeControlServer({
    profileDir: options.profileDir,
    handlers: {
      status: () => ({
        runtime: 'running',
        mode: 'cli',
        machine: options.machine,
        connection: options.runtime.status()
      }),
      connect: () => options.runtime.connect(),
      disconnect: () => options.runtime.disconnect(),
      reload: () => options.reload?.() ?? Promise.resolve(),
      shutdown: async () => {
        await options.runtime.shutdown();
        // Let the control server serialize and flush the successful response first. Closing the
        // listener inside this handler would wait on the very socket whose reply is still pending.
        setImmediate(() => void finish());
      }
    }
  });

  const finish = async (): Promise<void> => {
    if (finished) return;
    finished = true;
    if (signalHandler) {
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);
      signalHandler = null;
    }
    await server.close();
    resolveFinished();
  };

  try {
    await server.start();
    await options.runtime.start();
    if (options.installSignalHandlers !== false) {
      signalHandler = () => {
        void options.runtime.shutdown().finally(() => finish());
      };
      process.once('SIGINT', signalHandler);
      process.once('SIGTERM', signalHandler);
    }
    if (options.autoConnect) await options.runtime.connect();
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }

  await finishedPromise;
}

async function cliCredentialVault(profileDir: string, machine: MachineIdentity) {
  if (process.platform === 'win32') {
    return createCredentialVault({ directory: profileDir, provider: createWindowsCredentialProvider() });
  }
  if (process.platform === 'linux') {
    return createCredentialVault({
      directory: profileDir,
      provider: createLinuxCredentialProvider({ scope: machine.id })
    });
  }
  throw new Error('ComGu CLI V1 supports Windows and Linux only');
}

/**
 * Production CLI bootstrap. Kept in its own dynamically imported module so status/json/admin
 * clients do not load the MCP/tunnel/native dependency graph merely to inspect an owner.
 */
export async function startCliOwner(options: { profileDir: string }): Promise<void> {
  await initMachineProfile(options.profileDir);
  const machine = currentMachineProfile();
  if (!machine) throw new Error('ComGu machine identity did not initialize');

  initConfigPath(options.profileDir);
  await loadConfig();
  const vault = await cliCredentialVault(options.profileDir, machine);
  configureConnectionRuntime({
    profile: 'cli',
    getApiKey: () => vault.get('openaiApiKey')
  });

  const runtime = createComGuRuntime(runtimeProfile('cli'), {
    connect,
    disconnect,
    status: getStatus,
    subscribe: onStatusChange,
    shutdown: shutdownConnection
  });

  await runCliOwner({
    profileDir: options.profileDir,
    machine,
    runtime,
    autoConnect: getConfig().ui.autoConnect,
    reload: async () => {
      await loadConfig();
      await applySettings();
    }
  });
}
