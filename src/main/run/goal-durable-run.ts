import type { GoalDraftView } from '../goal.js';
import {
  createDurableRunStore,
  type DurableRunRecovery,
  type DurableRunStore,
  type DurableRunView
} from './durable-run.js';

export type GoalDraftReceipt = 'sent' | 'retired' | 'unknown';

export interface GoalDurableRunController {
  prepare(owner: string, objective: string, turnId: string): Promise<DurableRunView | null>;
  observeDraft(owner: string, objective: string, draft: GoalDraftView): Promise<DurableRunView | null>;
  acknowledge(owner: string, token: string, receipt: GoalDraftReceipt): Promise<DurableRunView | null>;
  cancelObjective(owner: string, reason?: string): Promise<void>;
  recover(): Promise<DurableRunRecovery[]>;
}

/**
 * Adapter between Goal's pure continue/stop decision and Durable Run lifecycle.
 * Goal owns model work; the browser owns send truth; this module owns only the durable control state between them.
 */
export function createGoalDurableRunController(store: DurableRunStore = createDurableRunStore()): GoalDurableRunController {
  const activeByOwner = new Map<string, string>();
  let recovered = false;

  const recover = async (): Promise<DurableRunRecovery[]> => {
    const entries = await store.recover();
    activeByOwner.clear();
    for (const entry of entries) activeByOwner.set(entry.run.owner, entry.run.id);
    recovered = true;
    return entries;
  };

  const ensureRecovered = async (): Promise<void> => {
    if (!recovered) await recover();
  };

  const active = (owner: string): DurableRunView | null => {
    const id = activeByOwner.get(owner);
    return id ? store.observe(id) : null;
  };

  const ensure = async (owner: string, objective: string): Promise<DurableRunView> => {
    await ensureRecovered();
    const current = active(owner);
    if (current && current.objective === objective && current.state !== 'completed' && current.state !== 'cancelled') return current;
    if (current && current.state !== 'completed' && current.state !== 'cancelled') {
      await store.advance(current.id, { type: 'cancel', owner, reason: 'Goal objective changed' });
    }
    const opened = await store.open(objective, owner);
    activeByOwner.set(owner, opened.id);
    return opened;
  };

  const prepare = async (owner: string, objective: string, turnId: string): Promise<DurableRunView | null> => {
    if (!objective) return null;
    const run = await ensure(owner, objective);
    if (run.state === 'needs-reconciliation' || run.state === 'completed' || run.state === 'cancelled') return run;
    const checkpoint = `goal:${turnId}:drafting`;
    if (run.state === 'running' && run.checkpoint === checkpoint) return run;
    return store.advance(run.id, { type: 'checkpoint', owner, checkpoint });
  };

  return {
    prepare,

    async observeDraft(owner, objective, draft) {
      if (!objective) return null;
      const run = (await prepare(owner, objective, draft.turnId))!;
      if (run.state === 'completed' || run.state === 'cancelled') return null;
      if (run.state === 'needs-reconciliation') {
        if (run.operation?.id === draft.token) return run;
        return run;
      }

      if (draft.stage === 'no-reply') {
        const completed = await store.advance(run.id, {
          type: 'complete',
          owner,
          checkpoint: `goal:${draft.turnId}:complete`
        });
        activeByOwner.delete(owner);
        return completed;
      }
      if (draft.stage === 'failed') {
        return store.advance(run.id, {
          type: 'suspend',
          owner,
          reason: draft.error || 'Goal provider did not produce a continuation'
        });
      }
      if (draft.stage === 'ready') {
        if (run.operation?.id === draft.token && run.operation.outcome === 'unknown') return run;
        return store.advance(run.id, {
          type: 'operation',
          owner,
          operation: { id: draft.token, retry: 'mutation', outcome: 'unknown' }
        });
      }

      return run;
    },

    async acknowledge(owner, token, receipt) {
      await ensureRecovered();
      const run = active(owner);
      if (!run || run.state === 'completed' || run.state === 'cancelled') return null;
      if (run.operation?.id !== token) return run;
      if (receipt === 'unknown') return run;
      return store.advance(run.id, {
        type: 'operation',
        owner,
        operation: {
          id: token,
          retry: 'mutation',
          outcome: receipt === 'sent' ? 'committed' : 'safe-to-retry'
        }
      });
    },

    async cancelObjective(owner, reason = 'Goal objective cleared') {
      await ensureRecovered();
      const run = active(owner);
      if (!run || run.state === 'completed' || run.state === 'cancelled') return;
      await store.advance(run.id, { type: 'cancel', owner, reason });
      activeByOwner.delete(owner);
    },

    recover
  };
}
