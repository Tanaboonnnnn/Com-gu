import { describe, expect, it } from 'vitest';
import { createComGuRuntime, type RuntimeLifecycle } from '../src/main/runtime/runtime.js';
import { runtimeProfile } from '../src/main/runtime/profile.js';
import type { RuntimeFeatureLoader } from '../src/main/runtime/features.js';

function fakeLifecycle(events: string[]): RuntimeLifecycle {
  return {
    connect: async () => {
      events.push('connect');
    },
    disconnect: async () => {
      events.push('disconnect');
    },
    status: () => ({ state: 'disconnected' }) as never,
    subscribe: () => () => {},
    shutdown: async () => {
      events.push('shutdown');
    }
  };
}

describe('ComGuRuntime', () => {
  it('runs start preparation once and serializes connect behind it', async () => {
    const events: string[] = [];
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = createComGuRuntime(runtimeProfile('cli'), fakeLifecycle(events), async () => {
      events.push('start-begin');
      await ready;
      events.push('start-end');
    });

    const first = runtime.start();
    const second = runtime.connect();
    await Promise.resolve();
    expect(events).toEqual(['start-begin']);

    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['start-begin', 'start-end', 'connect']);

    await runtime.start();
    expect(events.filter((event) => event === 'start-begin')).toHaveLength(1);
  });

  it('marks shutdown synchronously so late connect work cannot reopen the runtime', async () => {
    const events: string[] = [];
    const runtime = createComGuRuntime(runtimeProfile('desktop-app'), fakeLifecycle(events));
    await runtime.start();

    const stopping = runtime.shutdown();
    await runtime.connect();
    await stopping;

    expect(events).toEqual(['shutdown']);
  });

  it('exposes status and subscriptions without exposing connection internals', () => {
    let subscribed = false;
    const lifecycle = fakeLifecycle([]);
    lifecycle.status = () => ({ state: 'connected', detail: 'ok' }) as never;
    lifecycle.subscribe = () => {
      subscribed = true;
      return () => {
        subscribed = false;
      };
    };
    const runtime = createComGuRuntime(runtimeProfile('cli'), lifecycle);

    expect(runtime.status()).toMatchObject({ state: 'connected', detail: 'ok' });
    const unsubscribe = runtime.subscribe(() => {});
    expect(subscribed).toBe(true);
    unsubscribe();
    expect(subscribed).toBe(false);
  });

  it('stops loaded runtime features before the shared lifecycle shuts down', async () => {
    const events: string[] = [];
    const features: RuntimeFeatureLoader = {
      ensure: async () => null,
      stopAll: async () => {
        events.push('features:stop');
      }
    };
    const runtime = createComGuRuntime(runtimeProfile('desktop-app'), fakeLifecycle(events), undefined, features);
    await runtime.start();
    await runtime.shutdown();
    expect(events).toEqual(['features:stop', 'shutdown']);
  });
});
