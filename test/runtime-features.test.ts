import { expect, it } from 'vitest';
import { createRuntimeFeatureLoader } from '../src/main/runtime/features.js';
import { runtimeProfile } from '../src/main/runtime/profile.js';

it('loads an allowed feature once and stops loaded features in reverse order', async () => {
  const events: string[] = [];
  const loader = createRuntimeFeatureLoader(runtimeProfile('desktop-app'), {
    goal: async () => ({
      async start() { events.push('goal:start'); },
      async stop() { events.push('goal:stop'); }
    }),
    agents: async () => ({
      async start() { events.push('agents:start'); },
      async stop() { events.push('agents:stop'); }
    })
  });

  const goalA = await loader.ensure('goal');
  const goalB = await loader.ensure('goal');
  const agents = await loader.ensure('agents');

  expect(goalA).toBe(goalB);
  expect(agents).not.toBeNull();
  expect(events).toEqual(['goal:start', 'agents:start']);
  await loader.stopAll();
  expect(events).toEqual(['goal:start', 'agents:start', 'agents:stop', 'goal:stop']);
});

it('never invokes a factory for a feature disallowed by the runtime profile', async () => {
  let browserLoads = 0;
  let goalLoads = 0;
  const loader = createRuntimeFeatureLoader(runtimeProfile('cli'), {
    browser: async () => {
      browserLoads += 1;
      return { start: async () => {}, stop: async () => {} };
    },
    goal: async () => {
      goalLoads += 1;
      return { start: async () => {}, stop: async () => {} };
    }
  });

  expect(await loader.ensure('browser')).toBeNull();
  expect(await loader.ensure('goal')).toBeNull();
  expect(browserLoads).toBe(0);
  expect(goalLoads).toBe(0);
});

it('allows the Durable Run core in both profiles without implying browser or Goal support', async () => {
  let loads = 0;
  const loader = createRuntimeFeatureLoader(runtimeProfile('cli'), {
    'durable-run': async () => {
      loads += 1;
      return { start: async () => {}, stop: async () => {} };
    }
  });

  expect(await loader.ensure('durable-run')).not.toBeNull();
  expect(loads).toBe(1);
});
