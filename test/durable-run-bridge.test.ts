import { expect, it } from 'vitest';
import { createDurableRunStore, type DurableRunSnapshot } from '../src/main/run/durable-run.js';
import { createGoalDurableRunController } from '../src/main/run/goal-durable-run.js';

function memoryPersistence(initial: DurableRunSnapshot | null = null) {
  let stored = initial;
  return {
    persistence: {
      read: async () => stored,
      write: async (value: DurableRunSnapshot) => {
        stored = structuredClone(value);
      }
    },
    stored: () => structuredClone(stored)
  };
}

const draft = (stage: 'sending' | 'answering' | 'ready' | 'no-reply' | 'failed', token = 'goal-token-1') => ({
  token,
  conversationId: 'conversation:a',
  turnId: 'turn-1',
  stage,
  model: 'vendor/model',
  text: '',
  reply: stage === 'ready' ? 'continue' : '',
  error: stage === 'failed' ? 'request_failed: offline' : null
});

it('opens one run for a specific Goal and records the browser send boundary before exposing a ready draft', async () => {
  const memory = memoryPersistence();
  const store = createDurableRunStore(memory.persistence, { now: () => 1_000 });
  const controller = createGoalDurableRunController(store);

  const running = await controller.observeDraft('conversation:a', 'finish the release', draft('sending'));
  expect(running).toMatchObject({ state: 'running', objective: 'finish the release' });

  const ambiguous = await controller.observeDraft('conversation:a', 'finish the release', draft('ready'));
  expect(ambiguous).toMatchObject({
    state: 'needs-reconciliation',
    operation: { id: 'goal-token-1', retry: 'mutation', outcome: 'unknown' }
  });
  expect(memory.stored()?.runs[0]?.state).toBe('needs-reconciliation');
});

it('turns an explicit sent receipt into waiting and a retired receipt into safe suspension', async () => {
  const memory = memoryPersistence();
  const store = createDurableRunStore(memory.persistence, { now: () => 2_000 });
  const controller = createGoalDurableRunController(store);

  await controller.observeDraft('conversation:a', 'finish the release', draft('ready'));
  expect(await controller.acknowledge('conversation:a', 'goal-token-1', 'sent')).toMatchObject({ state: 'waiting' });

  const next = { ...draft('ready', 'goal-token-2'), turnId: 'turn-2' };
  await controller.observeDraft('conversation:a', 'finish the release', next);
  expect(await controller.acknowledge('conversation:a', 'goal-token-2', 'retired')).toMatchObject({
    state: 'suspended',
    operation: { outcome: 'safe-to-retry' }
  });
});

it('completes on no-reply, suspends provider failure, and never resurrects a terminal run', async () => {
  const memory = memoryPersistence();
  const store = createDurableRunStore(memory.persistence, { now: () => 3_000 });
  const controller = createGoalDurableRunController(store);

  expect(await controller.observeDraft('conversation:a', 'finish the release', draft('failed'))).toMatchObject({
    state: 'suspended'
  });
  expect(await controller.observeDraft('conversation:a', 'finish the release', draft('no-reply'))).toMatchObject({
    state: 'completed'
  });
  expect(await controller.acknowledge('conversation:a', 'goal-token-1', 'sent')).toBeNull();
});

it('restores waiting and reconciliation state after restart without inventing a retry', async () => {
  const memory = memoryPersistence();
  const firstStore = createDurableRunStore(memory.persistence, { now: () => 4_000 });
  const first = createGoalDurableRunController(firstStore);
  await first.observeDraft('conversation:a', 'finish the release', draft('ready'));

  const restoredStore = createDurableRunStore(memory.persistence, { now: () => 5_000 });
  const restored = createGoalDurableRunController(restoredStore);
  const recovery = await restored.recover();
  expect(recovery).toHaveLength(1);
  expect(recovery[0]).toMatchObject({ action: 'reconcile', run: { state: 'needs-reconciliation' } });
  expect(await restored.observeDraft('conversation:a', 'finish the release', draft('sending'))).toMatchObject({
    state: 'needs-reconciliation'
  });
  expect(await restored.prepare('conversation:a', 'finish the release', 'turn-2')).toMatchObject({
    state: 'needs-reconciliation',
    checkpoint: 'goal:turn-1:drafting'
  });
});
