import type { RuntimeProfile } from './profile.js';

export type RuntimeFeatureKind = 'browser' | 'sessions' | 'goal' | 'agents' | 'desktop' | 'durable-run';

export interface RuntimeFeature {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type RuntimeFeatureFactory = () => Promise<RuntimeFeature>;
export type RuntimeFeatureFactories = Partial<Record<RuntimeFeatureKind, RuntimeFeatureFactory>>;

export interface RuntimeFeatureLoader {
  ensure(kind: RuntimeFeatureKind): Promise<RuntimeFeature | null>;
  stopAll(): Promise<void>;
}

function allowed(profile: RuntimeProfile, kind: RuntimeFeatureKind): boolean {
  switch (kind) {
    case 'browser':
      return profile.browser;
    case 'sessions':
      return profile.sessions;
    case 'goal':
      return profile.goal;
    case 'agents':
      return profile.agents;
    case 'desktop':
      return profile.desktop;
    case 'durable-run':
      return profile.durableRuns;
  }
}

export function createRuntimeFeatureLoader(
  profile: RuntimeProfile,
  factories: RuntimeFeatureFactories
): RuntimeFeatureLoader {
  const loaded = new Map<RuntimeFeatureKind, RuntimeFeature>();
  const loading = new Map<RuntimeFeatureKind, Promise<RuntimeFeature | null>>();
  const order: RuntimeFeatureKind[] = [];
  let stopping = false;
  let stopInFlight: Promise<void> | null = null;

  return {
    async ensure(kind) {
      if (stopping) return null;
      if (!allowed(profile, kind)) return null;
      const existing = loaded.get(kind);
      if (existing) return existing;
      const pending = loading.get(kind);
      if (pending) return pending;
      const factory = factories[kind];
      if (!factory) return null;
      const promise = factory().then(async (feature) => {
        await feature.start();
        if (stopping) {
          await feature.stop();
          loading.delete(kind);
          return null;
        }
        loaded.set(kind, feature);
        order.push(kind);
        loading.delete(kind);
        return feature;
      }, (error) => {
        loading.delete(kind);
        throw error;
      });
      loading.set(kind, promise);
      return promise;
    },

    async stopAll() {
      stopping = true;
      if (!stopInFlight) {
        stopInFlight = (async () => {
          await Promise.allSettled([...loading.values()]);
          const kinds = [...order].reverse();
          order.length = 0;
          await Promise.allSettled(
            kinds.map(async (kind) => {
              const feature = loaded.get(kind);
              loaded.delete(kind);
              await feature?.stop();
            })
          );
          loading.clear();
          loaded.clear();
        })();
      }
      await stopInFlight;
    }
  };
}
