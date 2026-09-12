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
      const promise = (async (): Promise<RuntimeFeature | null> => {
        let feature: RuntimeFeature | null = null;
        let published = false;
        try {
          feature = await factory();
          await feature.start();
          if (stopping) {
            await feature.stop().catch(() => undefined);
            return null;
          }
          loaded.set(kind, feature);
          order.push(kind);
          published = true;
          return feature;
        } catch (error) {
          if (feature && !published) await feature.stop().catch(() => undefined);
          throw error;
        } finally {
          loading.delete(kind);
        }
      })();
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
          for (const kind of kinds) {
            const feature = loaded.get(kind);
            loaded.delete(kind);
            try {
              await feature?.stop();
            } catch {
              // Best-effort teardown must continue through the remaining dependency order.
            }
          }
          loading.clear();
          loaded.clear();
        })();
      }
      await stopInFlight;
    }
  };
}
