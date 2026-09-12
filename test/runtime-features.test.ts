import { expect, it } from 'vitest';
import { createRuntimeFeatureLoader } from '../src/main/runtime/features.js';
import { runtimeProfile } from '../src/main/runtime/profile.js';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

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

it('keeps the Desktop feature adapter free of static Goal and agents imports', async () => {
  const source = await readFile(new URL('../src/main/runtime/desktop-features.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/^import .*['"]\.\.\/goal\.js['"]/m);
  expect(source).not.toMatch(/^import .*['"]\.\.\/agents\.js['"]/m);
  expect(source).toContain("import('../goal.js')");
  expect(source).toContain("import('../agents.js')");
});

it('keeps Desktop startup, IPC, bridge and continuation free of runtime Goal/agents imports', async () => {
  const files = [
    new URL('../src/main/index.ts', import.meta.url),
    new URL('../src/main/ipc.ts', import.meta.url),
    new URL('../src/main/bridge.ts', import.meta.url),
    new URL('../src/main/session/continuation.ts', import.meta.url)
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
    const runtimeImports = ast.program.body
      .filter((statement) => statement.type === 'ImportDeclaration')
      .filter((statement) => statement.importKind !== 'type')
      .map((statement) => statement.source.value)
      .filter((specifier) => /(?:^|\/)\b(?:goal|agents)\.js$/.test(specifier) && !specifier.includes('/shared/'));

    expect(runtimeImports, `${file.pathname} must lazy-load Goal/agents implementations`).toEqual([]);
  }
});

it('keeps CLI owner and status paths free of browser, Goal, session, agents and Electron runtime imports', async () => {
  const files = [
    new URL('../src/cli/index.ts', import.meta.url),
    new URL('../src/cli/owner.ts', import.meta.url),
    new URL('../src/cli/commands/status.ts', import.meta.url)
  ];
  const forbidden = /(?:^|\/)(?:bridge|goal|agents)\.js$|(?:^|\/)session(?:\/|\.js$)|^electron$/;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
    const runtimeImports = ast.program.body
      .filter((statement) => statement.type === 'ImportDeclaration')
      .filter((statement) => statement.importKind !== 'type')
      .map((statement) => statement.source.value)
      .filter((specifier) => forbidden.test(specifier));
    expect(runtimeImports, `${file.pathname} must keep the CLI baseline graph lightweight`).toEqual([]);
  }
});

it('does not publish a feature whose start finishes after shutdown begins', async () => {
  const startEntered = deferred();
  const releaseStart = deferred();
  const events: string[] = [];
  const loader = createRuntimeFeatureLoader(runtimeProfile('desktop-app'), {
    agents: async () => ({
      async start() {
        events.push('start');
        startEntered.resolve();
        await releaseStart.promise;
      },
      async stop() { events.push('stop'); }
    })
  });

  const ensuring = loader.ensure('agents');
  await startEntered.promise;
  const stopping = loader.stopAll();
  expect(await loader.ensure('goal')).toBeNull();
  releaseStart.resolve();

  expect(await ensuring).toBeNull();
  await stopping;
  expect(events).toEqual(['start', 'stop']);
  expect(await loader.ensure('agents')).toBeNull();
});

it('retries a feature after start rejects and shares one in-flight attempt per try', async () => {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  let factories = 0;
  let starts = 0;
  let stops = 0;
  const loader = createRuntimeFeatureLoader(runtimeProfile('desktop-app'), {
    agents: async () => {
      factories += 1;
      const attempt = factories;
      return {
        async start() {
          starts += 1;
          if (attempt === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
            throw new Error('transient agents startup failure');
          }
        },
        async stop() { stops += 1; }
      };
    }
  });

  const firstA = loader.ensure('agents');
  const firstB = loader.ensure('agents');
  await firstStarted.promise;
  expect(factories).toBe(1);
  expect(starts).toBe(1);
  releaseFirst.resolve();
  await expect(firstA).rejects.toThrow(/transient agents startup failure/i);
  await expect(firstB).rejects.toThrow(/transient agents startup failure/i);
  expect(stops).toBe(1);

  const secondA = loader.ensure('agents');
  const secondB = loader.ensure('agents');
  const [loadedA, loadedB] = await Promise.all([secondA, secondB]);
  expect(loadedA).toBe(loadedB);
  expect(factories).toBe(2);
  expect(starts).toBe(2);
});

it('fully stops features sequentially in reverse load order', async () => {
  const agentsStopEntered = deferred();
  const releaseAgentsStop = deferred();
  const events: string[] = [];
  const loader = createRuntimeFeatureLoader(runtimeProfile('desktop-app'), {
    goal: async () => ({
      async start() {},
      async stop() { events.push('goal:stop'); }
    }),
    agents: async () => ({
      async start() {},
      async stop() {
        events.push('agents:stop:start');
        agentsStopEntered.resolve();
        await releaseAgentsStop.promise;
        events.push('agents:stop:end');
      }
    })
  });

  await loader.ensure('goal');
  await loader.ensure('agents');
  const stopping = loader.stopAll();
  await agentsStopEntered.promise;
  expect(events).toEqual(['agents:stop:start']);
  releaseAgentsStop.resolve();
  await stopping;
  expect(events).toEqual(['agents:stop:start', 'agents:stop:end', 'goal:stop']);
});
