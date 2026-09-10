import type { ConnectionStatus } from '../../shared/types.js';
import type { RuntimeProfile } from './profile.js';

export interface RuntimeLifecycle {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): ConnectionStatus;
  subscribe(listener: (status: ConnectionStatus) => void): () => void;
  shutdown(): Promise<void>;
}

export interface ComGuRuntime {
  readonly profile: RuntimeProfile;
  start(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): ConnectionStatus;
  subscribe(listener: (status: ConnectionStatus) => void): () => void;
  shutdown(): Promise<void>;
}

/**
 * The frontend seam for ComGu's runtime lifecycle. Connection/tunnel/MCP details stay behind
 * this interface so Electron and CLI do not grow separate lifecycle state machines.
 */
export function createComGuRuntime(
  profile: RuntimeProfile,
  lifecycle: RuntimeLifecycle,
  prepare: () => Promise<void> = async () => {}
): ComGuRuntime {
  let startInFlight: Promise<void> | null = null;
  let started = false;
  let shutdownRequested = false;
  let shutdownInFlight: Promise<void> | null = null;

  const start = (): Promise<void> => {
    if (started) return Promise.resolve();
    if (shutdownRequested) return Promise.resolve();
    if (!startInFlight) {
      startInFlight = prepare().then(() => {
        if (!shutdownRequested) started = true;
      });
    }
    return startInFlight;
  };

  return {
    profile,
    start,
    async connect() {
      if (shutdownRequested) return;
      await start();
      if (shutdownRequested) return;
      await lifecycle.connect();
    },
    async disconnect() {
      if (shutdownRequested || !started) return;
      await lifecycle.disconnect();
    },
    status: lifecycle.status,
    subscribe: lifecycle.subscribe,
    shutdown() {
      // Terminal intent is visible synchronously. A connect suspended in `prepare` therefore
      // observes this after its await and cannot publish a fresh endpoint while teardown runs.
      shutdownRequested = true;
      if (!shutdownInFlight) shutdownInFlight = lifecycle.shutdown();
      return shutdownInFlight;
    }
  };
}
