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
}

export type DurableRunEvent =
  | { type: 'checkpoint'; owner: string; checkpoint: string }
  | { type: 'complete'; owner: string; checkpoint?: string }
  | { type: 'cancel'; owner: string; reason?: string };

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

  const snapshot = (savedAt: number): DurableRunSnapshot => ({
    version: 1,
    savedAt,
    runs: [...runs.values()].map(cloneRun)
  });

  const ensureLoaded = async (): Promise<void> => {
    if (loaded) return;
    const restored = await persistence.read();
    if (restored?.version === 1 && Array.isArray(restored.runs)) {
      for (const run of restored.runs) {
        if (!run || typeof run.id !== 'string') continue;
        runs.set(run.id, cloneRun(run));
      }
    }
    loaded = true;
  };

  const persistReplacement = async (replacement: DurableRunView): Promise<void> => {
    const previous = runs.get(replacement.id);
    runs.set(replacement.id, replacement);
    try {
      await persistence.write(snapshot(replacement.updatedAt));
    } catch (error) {
      if (previous) runs.set(previous.id, previous);
      else runs.delete(replacement.id);
      throw error;
    }
  };

  return {
    async open(objective, owner) {
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
        leaseExpiresAt: at + leaseMs
      };
      await persistReplacement(run);
      return cloneRun(run);
    },

    observe(runId) {
      const run = runs.get(runId);
      return run ? cloneRun(run) : null;
    },

    async advance(runId, event) {
      await ensureLoaded();
      const current = runs.get(runId);
      if (!current) throw new Error(`Unknown Durable Run: ${runId}`);
      if (terminal(current.state)) throw new Error(`Durable Run ${runId} is terminal`);
      if (event.owner !== current.owner) throw new Error('Durable Run owner does not match');
      const at = now();
      const next = cloneRun(current);
      next.updatedAt = at;
      next.leaseExpiresAt = at + leaseMs;
      if (event.type === 'checkpoint') {
        next.checkpoint = bounded(event.checkpoint);
      } else if (event.type === 'complete') {
        next.state = 'completed';
        if (event.checkpoint !== undefined) next.checkpoint = bounded(event.checkpoint);
      } else {
        next.state = 'cancelled';
        next.reason = bounded(event.reason ?? '');
      }
      await persistReplacement(next);
      return cloneRun(next);
    },

    async recover() {
      await ensureLoaded();
      return [...runs.values()]
        .filter((run) => !terminal(run.state))
        .map((run) => ({ run: cloneRun(run), action: run.state === 'needs-reconciliation' ? 'reconcile' : 'resume' }));
    }
  };
}
