import { randomUUID } from 'node:crypto';
import { readDurable, writeDurableNow } from '../durable.js';

export const DURABLE_RUNS_STATE = 'durable-runs';

export type DurableRunState =
  | 'running'
  | 'waiting'
  | 'suspended'
  | 'needs-reconciliation'
  | 'completed'
  | 'cancelled';

export interface DurableRunView {
  id: string;
  objective: string;
  owner: string;
  state: DurableRunState;
  checkpoint: string;
  reason: string;
  openedAt: number;
  updatedAt: number;
  leaseExpiresAt: number;
  operation: DurableRunOperation | null;
}

export interface DurableRunOperation {
  id: string;
  retry: 'read-only' | 'receipt' | 'mutation';
  outcome: 'committed' | 'unknown' | 'already-applied' | 'safe-to-retry';
}

export type DurableRunEvent =
  | { type: 'checkpoint'; owner: string; checkpoint: string }
  | { type: 'wait'; owner: string; checkpoint: string }
  | { type: 'suspend'; owner: string; reason: string }
  | { type: 'complete'; owner: string; checkpoint?: string }
  | { type: 'cancel'; owner: string; reason?: string }
  | { type: 'renew'; owner: string }
  | { type: 'operation'; owner: string; operation: DurableRunOperation };

export interface DurableRunRecovery {
  run: DurableRunView;
  action: 'resume' | 'reconcile';
}

export interface DurableRunSnapshot {
  version: 1;
  savedAt: number;
  runs: DurableRunView[];
}

export interface DurableRunPersistence {
  read(): Promise<DurableRunSnapshot | null>;
  write(snapshot: DurableRunSnapshot): Promise<void>;
}

export interface DurableRunStore {
  open(objective: string, owner: string): Promise<DurableRunView>;
  observe(runId: string): DurableRunView | null;
  advance(runId: string, event: DurableRunEvent): Promise<DurableRunView>;
  recover(now?: number): Promise<DurableRunRecovery[]>;
}

const MAX_TEXT = 4_000;
const DEFAULT_LEASE_MS = 15 * 60_000;

function bounded(value: string): string {
  return value.slice(0, MAX_TEXT);
}

function cloneRun(run: DurableRunView): DurableRunView {
  return { ...run };
}

function terminal(state: DurableRunState): boolean {
  return state === 'completed' || state === 'cancelled';
}

function defaultPersistence(): DurableRunPersistence {
  return {
    read: () => readDurable<DurableRunSnapshot>(DURABLE_RUNS_STATE),
    write: (snapshot) => writeDurableNow(DURABLE_RUNS_STATE, snapshot)
  };
}

export function createDurableRunStore(
  persistence: DurableRunPersistence = defaultPersistence(),
  options: { now?: () => number; leaseMs?: number } = {}
): DurableRunStore {
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const runs = new Map<string, DurableRunView>();
  let loaded = false;
  let loadInFlight: Promise<void> | null = null;
  let transactionTail: Promise<void> = Promise.resolve();

  const snapshot = (source: Map<string, DurableRunView>, savedAt: number): DurableRunSnapshot => ({
    version: 1,
    savedAt,
    runs: [...source.values()].map(cloneRun)
  });

  const publish = (source: Map<string, DurableRunView>): void => {
    runs.clear();
    for (const [id, run] of source) runs.set(id, run);
  };

  const ensureLoaded = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (!loadInFlight) {
      loadInFlight = (async () => {
        const restored = await persistence.read();
        const restoredRuns = new Map<string, DurableRunView>();
        if (restored?.version === 1 && Array.isArray(restored.runs)) {
          for (const run of restored.runs) {
            if (!run || typeof run.id !== 'string') continue;
            restoredRuns.set(run.id, cloneRun(run));
          }
        }
        publish(restoredRuns);
        loaded = true;
      })().finally(() => {
        loadInFlight = null;
      });
    }
    return loadInFlight;
  };

  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = transactionTail.then(work);
    transactionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const persistReplacement = async (replacement: DurableRunView): Promise<void> => {
    const staged = new Map(runs);
    staged.set(replacement.id, replacement);
    // The in-memory projection is authoritative only after the exact snapshot is durable.
    await persistence.write(snapshot(staged, replacement.updatedAt));
    publish(staged);
  };

  return {
    async open(objective, owner) {
      return serialize(async () => {
        await ensureLoaded();
        const objectiveBounded = bounded(objective);
        const existing = [...runs.values()].find(
          (run) => !terminal(run.state) && run.owner === owner && run.objective === objectiveBounded
        );
        if (existing) return cloneRun(existing);
        const at = now();
        const run: DurableRunView = {
          id: randomUUID(),
          objective: objectiveBounded,
          owner: bounded(owner),
          state: 'running',
          checkpoint: '',
          reason: '',
          openedAt: at,
          updatedAt: at,
          leaseExpiresAt: at + leaseMs,
          operation: null
        };
        await persistReplacement(run);
        return cloneRun(run);
      });
    },

    observe(runId) {
      const run = runs.get(runId);
      return run ? cloneRun(run) : null;
    },

    async advance(runId, event) {
      return serialize(async () => {
        await ensureLoaded();
        const current = runs.get(runId);
        if (!current) throw new Error(`Unknown Durable Run: ${runId}`);
        if (terminal(current.state)) throw new Error(`Durable Run ${runId} is terminal`);
        if (event.owner !== current.owner) throw new Error('Durable Run owner does not match');
        if (current.state === 'needs-reconciliation' && event.type !== 'operation' && event.type !== 'cancel') {
          throw new Error('Durable Run requires reconciliation before it can advance');
        }
        const at = now();
        const next = cloneRun(current);
        next.updatedAt = at;
        next.leaseExpiresAt = at + leaseMs;
        if (event.type === 'checkpoint') {
          next.state = 'running';
          next.reason = '';
          next.checkpoint = bounded(event.checkpoint);
        } else if (event.type === 'wait') {
          next.state = 'waiting';
          next.reason = '';
          next.checkpoint = bounded(event.checkpoint);
        } else if (event.type === 'suspend') {
          next.state = 'suspended';
          next.reason = bounded(event.reason);
        } else if (event.type === 'complete') {
          next.state = 'completed';
          if (event.checkpoint !== undefined) next.checkpoint = bounded(event.checkpoint);
        } else if (event.type === 'cancel') {
          next.state = 'cancelled';
          next.reason = bounded(event.reason ?? '');
        } else if (event.type === 'renew') {
          next.state = 'running';
          next.reason = '';
        } else {
          next.operation = {
            id: bounded(event.operation.id),
            retry: event.operation.retry,
            outcome: event.operation.outcome
          };
          if (event.operation.retry === 'mutation' && event.operation.outcome === 'unknown') {
            next.state = 'needs-reconciliation';
            next.reason = 'The previous mutation may have completed, but its outcome is not proven.';
          } else if (event.operation.outcome === 'committed' || event.operation.outcome === 'already-applied') {
            next.state = 'waiting';
            next.reason = '';
          } else if (event.operation.outcome === 'safe-to-retry') {
            next.state = 'suspended';
            next.reason = 'The previous operation was not applied and is safe to retry.';
          }
        }
        await persistReplacement(next);
        return cloneRun(next);
      });
    },

    async recover(recoverAt = now()) {
      return serialize(async () => {
        await ensureLoaded();
        const expired = [...runs.values()].filter(
          (run) => !terminal(run.state) && run.state !== 'needs-reconciliation' && run.leaseExpiresAt <= recoverAt
        );
        if (expired.length > 0) {
          const staged = new Map(runs);
          for (const run of expired) {
            staged.set(run.id, {
              ...run,
              state: 'suspended',
              reason: 'The active lease expired; the run is recoverable.',
              updatedAt: recoverAt
            });
          }
          await persistence.write(snapshot(staged, recoverAt));
          publish(staged);
        }
        return [...runs.values()]
          .filter((run) => !terminal(run.state))
          .map((run) => ({ run: cloneRun(run), action: run.state === 'needs-reconciliation' ? 'reconcile' : 'resume' }));
      });
    }
  };
}
