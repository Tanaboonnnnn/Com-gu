import { currentRunAuthorityGuard } from './agents.js';

export type RecoveryOperation =
  | 'reconnect-bridge'
  | 'restart-tunnel'
  | 'reopen-browser'
  | 'wake-prime';

export type RecoveryOutcome = 'recovered' | 'degraded' | 'failed' | 'requires-user';

export interface RecoveryGuard {
  runId: string | null;
  scopeFingerprint: string | null;
}

export type RecoveryActionResult = 'recovered' | 'retry' | 'requires-user';

export interface RecoveryResult {
  operation: RecoveryOperation;
  outcome: RecoveryOutcome;
  attempts: number;
  reason: 'authority-changed' | 'retry-budget-exhausted' | null;
}

export interface RecoveryActions {
  reconnectBridge: () => Promise<RecoveryActionResult>;
  restartTunnel: () => Promise<RecoveryActionResult>;
  reopenBrowser: () => Promise<RecoveryActionResult>;
  wakePrime: () => Promise<RecoveryActionResult>;
}

export interface RecoveryManagerOptions {
  guard: () => RecoveryGuard;
  actions: RecoveryActions;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  backoffMs?: readonly number[];
}

function sameGuard(left: RecoveryGuard, right: RecoveryGuard): boolean {
  return left.runId === right.runId && left.scopeFingerprint === right.scopeFingerprint;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Bounded Recovery Manager v1.
 *
 * It deliberately owns no transport, browser or agent state. Callers inject exactly four
 * reversible operations. The manager contributes only bounded retry/backoff and the authority
 * fence: every attempt is tied to the RunId + effective-scope fingerprint captured at entry,
 * and that pair is checked both before and after each action. If the Run changes or narrows while
 * recovery is in flight, recovery degrades and stops instead of acting on stale authority.
 */
export class RecoveryManager {
  private readonly guard: () => RecoveryGuard;
  private readonly actions: RecoveryActions;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly backoffMs: readonly number[];

  constructor(options: RecoveryManagerOptions) {
    this.guard = options.guard;
    this.actions = options.actions;
    this.sleep = options.sleep ?? delay;
    this.maxAttempts = Math.max(1, Math.min(10, Math.floor(options.maxAttempts ?? 3)));
    this.backoffMs = options.backoffMs ?? [250, 750];
  }

  private action(operation: RecoveryOperation): () => Promise<RecoveryActionResult> {
    switch (operation) {
      case 'reconnect-bridge': return this.actions.reconnectBridge;
      case 'restart-tunnel': return this.actions.restartTunnel;
      case 'reopen-browser': return this.actions.reopenBrowser;
      case 'wake-prime': return this.actions.wakePrime;
    }
  }

  async recover(operation: RecoveryOperation): Promise<RecoveryResult> {
    const captured = this.guard();
    const action = this.action(operation);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (!sameGuard(captured, this.guard())) {
        return { operation, outcome: 'degraded', attempts: attempt - 1, reason: 'authority-changed' };
      }

      let actionResult: RecoveryActionResult;
      try {
        actionResult = await action();
      } catch {
        actionResult = 'retry';
      }

      if (!sameGuard(captured, this.guard())) {
        return { operation, outcome: 'degraded', attempts: attempt, reason: 'authority-changed' };
      }

      if (actionResult === 'recovered') {
        return { operation, outcome: 'recovered', attempts: attempt, reason: null };
      }
      if (actionResult === 'requires-user') {
        return { operation, outcome: 'requires-user', attempts: attempt, reason: null };
      }
      if (attempt === this.maxAttempts) {
        return { operation, outcome: 'failed', attempts: attempt, reason: 'retry-budget-exhausted' };
      }

      const backoff = this.backoffMs[Math.min(attempt - 1, this.backoffMs.length - 1)] ?? 0;
      await this.sleep(Math.max(0, backoff));
    }

    return { operation, outcome: 'failed', attempts: this.maxAttempts, reason: 'retry-budget-exhausted' };
  }
}

let runtimeManager: RecoveryManager | null = null;

/**
 * Concrete app integration, kept lazy so importing the recovery policy itself has no startup
 * side effects. Recovery happens only when a main-process caller explicitly asks for one of the
 * four allow-listed operations; there is no timer or automatic elevation/restart loop here.
 */
function appRecoveryManager(): RecoveryManager {
  if (runtimeManager) return runtimeManager;
  runtimeManager = new RecoveryManager({
    // Synchronous authority snapshot is required before an action can even start.
    guard: currentRunAuthorityGuard,
    actions: {
      reconnectBridge: async () => {
        const bridge = await import('./bridge.js');
        await bridge.stopBridge();
        const port = await bridge.startBridge();
        const state = await bridge.bridgeStatus();
        return port !== null && state.running ? 'recovered' : 'retry';
      },
      restartTunnel: async () => {
        const connection = await import('./connection.js');
        await connection.disconnect();
        await connection.connect();
        const state = connection.getStatus().state;
        if (state === 'connected') return 'recovered';
        if (state === 'auth-failed' || state === 'tunnel-unavailable') return 'requires-user';
        return 'retry';
      },
      reopenBrowser: async () => {
        const [bridge, browser] = await Promise.all([import('./bridge.js'), import('./browser.js')]);
        const family = bridge.provenPrimeBrowserFamily();
        if (!family) return 'requires-user';
        const opened = await browser.openInPreferredBrowser('https://chatgpt.com/', { preference: family });
        return opened ? 'recovered' : 'requires-user';
      },
      wakePrime: async () => {
        const agents = await import('./agents.js');
        return agents.requestPrimeWakeForPendingReports() ? 'recovered' : 'requires-user';
      }
    }
  });
  return runtimeManager;
}

/** Execute one bounded, reversible recovery operation. No operation is started implicitly. */
export function recoverSystem(operation: RecoveryOperation): Promise<RecoveryResult> {
  return appRecoveryManager().recover(operation);
}

/** Test seam; runtime state itself lives in the existing connection/bridge/agent owners. */
export function resetRecoveryForTests(): void {
  runtimeManager = null;
}
