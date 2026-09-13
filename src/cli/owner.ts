import { getConfig, initConfigPath, loadConfig } from '../main/config.js';
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
import { createCliCredentialVault } from './credentials.js';

export interface CliOwnerRuntime {
  start(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): ConnectionStatus;
  shutdown(): Promise<void>;
}

interface RunCliOwnerOptions {
  profileDir: string;
  machine: MachineIdentity | (() => MachineIdentity | null);
  runtime: CliOwnerRuntime;
  initialize?: () => Promise<void>;
  durableRunStatus?: () => Promise<unknown[]>;
  reload?: () => Promise<void>;
  autoConnect?: boolean | (() => boolean);
  installSignalHandlers?: boolean;
}

/**
 * Owns the one local CLI runtime for a profile. The control socket is acquired before runtime
 * startup, so a competing process cannot initialize a second MCP/tunnel owner against the same
 * profile. Shutdown replies over the control channel before the listener is retired.
 */
export async function runCliOwner(options: RunCliOwnerOptions): Promise<void> {
  type OwnerLifecycle = 'starting' | 'ready' | 'stopping' | 'stopped';
  let lifecycle: OwnerLifecycle = 'starting';
  let shutdownRequested = false;
  let runtimeStarted = false;
  let runtimeShutdownPromise: Promise<void> | null = null;
  let adminTail: Promise<void> = Promise.resolve();
  let finished = false;
  let resolveFinished!: () => void;
  const finishedPromise = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  let signalHandler: (() => void) | null = null;
  const machine = (): MachineIdentity | null =>
    typeof options.machine === 'function' ? options.machine() : options.machine;

  const ensureReady = (): void => {
    if (lifecycle === 'starting') throw new Error('ComGu runtime is still starting');
    if (lifecycle !== 'ready') throw new Error('ComGu runtime is stopping');
  };

  const runReadyMutation = async (operation: () => Promise<void>): Promise<void> => {
    ensureReady();
    const scheduled = adminTail.then(async () => {
      ensureReady();
      await operation();
    });
    adminTail = scheduled.catch(() => undefined);
    await scheduled;
  };

  const shutdownRuntime = async (): Promise<void> => {
    if (!runtimeStarted) return;
    runtimeShutdownPromise ??= (async () => {
      await adminTail.catch(() => undefined);
      await options.runtime.shutdown();
    })();
    await runtimeShutdownPromise;
  };

  const server = createRuntimeControlServer({
    profileDir: options.profileDir,
    handlers: {
      status: async () => ({
        runtime: lifecycle === 'ready' ? 'running' : lifecycle,
        mode: 'cli',
        machine: machine(),
        connection: options.runtime.status(),
        durableRuns: lifecycle === 'ready' ? await options.durableRunStatus?.() ?? [] : []
      }),
      connect: () => runReadyMutation(() => options.runtime.connect()),
      disconnect: () => runReadyMutation(() => options.runtime.disconnect()),
      reload: () => runReadyMutation(() => options.reload?.() ?? Promise.resolve()),
      shutdown: async () => {
        shutdownRequested = true;
        if (lifecycle === 'starting') {
          lifecycle = 'stopping';
          return;
        }
        if (lifecycle === 'ready') lifecycle = 'stopping';
        await shutdownRuntime();
        // Let the control server serialize and flush the successful response first. Closing the
        // listener inside this handler would wait on the very socket whose reply is still pending.
        setImmediate(() => void finish());
      }
    }
  });

  const finish = async (): Promise<void> => {
    if (finished) return;
    finished = true;
    lifecycle = 'stopping';
    if (signalHandler) {
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);
      signalHandler = null;
    }
    await shutdownRuntime().catch(() => undefined);
    await server.close();
    lifecycle = 'stopped';
    resolveFinished();
  };

  try {
    await server.start();
    await options.initialize?.();
    if (shutdownRequested) {
      await finish();
      return;
    }

    await options.runtime.start();
    runtimeStarted = true;
    if (shutdownRequested) {
      await finish();
      return;
    }

    const autoConnect = typeof options.autoConnect === 'function' ? options.autoConnect() : options.autoConnect;
    if (autoConnect) await options.runtime.connect();
    if (shutdownRequested) {
      await finish();
      return;
    }

    lifecycle = 'ready';
    if (options.installSignalHandlers !== false) {
      signalHandler = () => {
        shutdownRequested = true;
        lifecycle = 'stopping';
        void shutdownRuntime().finally(() => finish());
      };
      process.once('SIGINT', signalHandler);
      process.once('SIGTERM', signalHandler);
    }
  } catch (error) {
    await finish().catch(() => undefined);
    throw error;
  }

  await finishedPromise;
}

/**
 * Production CLI bootstrap. Kept in its own dynamically imported module so status/json/admin
 * clients do not load the MCP/tunnel/native dependency graph merely to inspect an owner.
 */
export async function startCliOwner(options: { profileDir: string }): Promise<void> {
  const runtime = createComGuRuntime(runtimeProfile('cli'), {
    connect,
    disconnect,
    status: getStatus,
    subscribe: onStatusChange,
    shutdown: shutdownConnection
  });
  let machine: MachineIdentity | null = null;

  let durableRunStore: import('../main/run/durable-run.js').DurableRunStore | null = null;
  const durableRunStatus = async () => {
    if (!durableRunStore) {
      const [{ initDurableStore }, { createDurableRunStore }] = await Promise.all([
        import('../main/durable.js'),
        import('../main/run/durable-run.js')
      ]);
      initDurableStore(options.profileDir);
      durableRunStore = createDurableRunStore();
    }
    const recovered = await durableRunStore.recover();
    return recovered.map(({ run, action }) => ({
      id: run.id,
      objective: run.objective,
      state: run.state,
      checkpoint: run.checkpoint,
      reason: run.reason,
      updatedAt: run.updatedAt,
      leaseExpiresAt: run.leaseExpiresAt,
      operation: run.operation,
      action
    }));
  };

  await runCliOwner({
    profileDir: options.profileDir,
    machine: () => machine,
    runtime,
    initialize: async () => {
      machine = await initMachineProfile(options.profileDir);
      if (!currentMachineProfile()) throw new Error('ComGu machine identity did not initialize');
      initConfigPath(options.profileDir);
      await loadConfig();
      const vault = createCliCredentialVault(options.profileDir, machine);
      if (process.platform === 'win32') {
        const [{ configureComputerClipboard }, { createWindowsCliClipboard }] = await Promise.all([
          import('../main/computer/index.js'),
          import('../main/desktop/windows-clipboard.js')
        ]);
        configureComputerClipboard(createWindowsCliClipboard());
      }
      configureConnectionRuntime({
        profile: 'cli',
        getApiKey: () => vault.get('openaiApiKey')
      });
    },
    durableRunStatus,
    autoConnect: () => getConfig().ui.autoConnect,
    reload: async () => {
      await loadConfig();
      await applySettings();
    }
  });
}
