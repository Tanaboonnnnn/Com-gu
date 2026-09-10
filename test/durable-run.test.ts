import { expect, it } from 'vitest';
import { createDurableRunStore, type DurableRunSnapshot } from '../src/main/run/durable-run.js';

function memoryPersistence(initial: DurableRunSnapshot | null = null) {
  let stored = initial;
  let failWrites = false;
  return {
    persistence: {
      read: async () => stored,
      write: async (value: DurableRunSnapshot) => {
        if (failWrites) throw new Error('disk unavailable');
        stored = structuredClone(value);
      }
    },
    stored: () => structuredClone(stored),
    failWrites(value: boolean) {
      failWrites = value;
    }
  };
}

it('opens one active run per owner and objective and publishes only after the checkpoint is durable', async () => {
  const memory = memoryPersistence();
  const store = createDurableRunStore(memory.persistence, { now: () => 1_000 });

  const first = await store.open('finish the release', 'conversation:a');
  const same = await store.open('finish the release', 'conversation:a');
  expect(same.id).toBe(first.id);
  expect(first).toMatchObject({ objective: 'finish the release', owner: 'conversation:a', state: 'running' });
  expect(memory.stored()?.runs).toHaveLength(1);

  memory.failWrites(true);
  await expect(store.advance(first.id, { type: 'checkpoint', owner: 'conversation:a', checkpoint: 'tests green' })).rejects.toThrow(
    'disk unavailable'
  );
  expect(store.observe(first.id)?.checkpoint).toBe('');
});

it('records completion and cancellation as terminal states', async () => {
  const memory = memoryPersistence();
  const store = createDurableRunStore(memory.persistence, { now: () => 2_000 });
  const completed = await store.open('ship build', 'conversation:a');
  await store.advance(completed.id, { type: 'complete', owner: 'conversation:a', checkpoint: 'artifact published' });
  expect(store.observe(completed.id)?.state).toBe('completed');
  await expect(
    store.advance(completed.id, { type: 'checkpoint', owner: 'conversation:a', checkpoint: 'late mutation' })
  ).rejects.toThrow(/terminal/i);

  const cancelled = await store.open('another task', 'conversation:a');
  await store.advance(cancelled.id, { type: 'cancel', owner: 'conversation:a', reason: 'user stopped it' });
  expect(store.observe(cancelled.id)).toMatchObject({ state: 'cancelled', reason: 'user stopped it' });
});

it('bounds persisted control strings instead of duplicating arbitrarily large payloads', async () => {
  const memory = memoryPersistence();
  const store = createDurableRunStore(memory.persistence, { now: () => 3_000 });
  const run = await store.open('x'.repeat(100_000), 'conversation:a');
  await store.advance(run.id, { type: 'checkpoint', owner: 'conversation:a', checkpoint: 'y'.repeat(100_000) });
  const stored = JSON.stringify(memory.stored());
  expect(stored.length).toBeLessThan(20_000);
  expect(store.observe(run.id)?.objective.length).toBeLessThanOrEqual(4_000);
  expect(store.observe(run.id)?.checkpoint.length).toBeLessThanOrEqual(4_000);
});
