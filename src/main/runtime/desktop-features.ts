import {
  installBridgeAgentsRuntime,
  installBridgeGoalRuntime
} from '../bridge-optional-runtime.js';
import { writeDurableNow, writeDurableSoon } from '../durable.js';
import type { RuntimeFeatureFactories } from './features.js';

export type DesktopAgentsModule = typeof import('../agents.js');
export type DesktopGoalModule = typeof import('../goal.js');

let agentsModule: DesktopAgentsModule | null = null;
let goalModule: DesktopGoalModule | null = null;
const SWARM_STATE = 'swarm';
const RETIRED_WORKERS_STATE = 'retired-workers';

async function loadAgents(): Promise<DesktopAgentsModule> {
  if (agentsModule) return agentsModule;
  const loaded = await import('../agents.js');
  agentsModule = loaded;
  installBridgeAgentsRuntime(loaded);
  // Persistence belongs to the feature adapter, not whichever UI happened to enable it. This
  // keeps a mid-process Settings enable just as durable as an app-start restore.
  loaded.onSwarmPersist(() => writeDurableSoon(SWARM_STATE, loaded.snapshotSwarm()));
  loaded.onSwarmPersistNow((snapshot) => writeDurableNow(SWARM_STATE, snapshot));
  loaded.onRetiredWorkersPersist(() => writeDurableSoon(RETIRED_WORKERS_STATE, loaded.snapshotRetiredWorkers()));
  loaded.onRetiredWorkersPersistNow((snapshot) => writeDurableNow(RETIRED_WORKERS_STATE, snapshot));
  return loaded;
}

async function loadGoal(): Promise<DesktopGoalModule> {
  if (goalModule) return goalModule;
  const loaded = await import('../goal.js');
  goalModule = loaded;
  installBridgeGoalRuntime(loaded);
  return loaded;
}

/**
 * Desktop-only adapters for heavy optional feature families. Importing this module loads none of
 * the implementations themselves; the dynamic import happens only after RuntimeProfile policy
 * and live config/recovery state say the feature is needed.
 */
export function desktopFeatureFactories(): RuntimeFeatureFactories {
  return {
    goal: async () => ({
      async start() {
        await loadGoal();
      },
      async stop() {
        installBridgeGoalRuntime(null);
        goalModule = null;
      }
    }),
    agents: async () => ({
      async start() {
        await loadAgents();
      },
      async stop() {
        installBridgeAgentsRuntime(null);
        agentsModule = null;
      }
    })
  };
}

export async function ensureDesktopGoalModule(): Promise<DesktopGoalModule> {
  return loadGoal();
}

export async function ensureDesktopAgentsModule(): Promise<DesktopAgentsModule> {
  return loadAgents();
}

export function loadedDesktopGoalModule(): DesktopGoalModule | null {
  return goalModule;
}

export function loadedDesktopAgentsModule(): DesktopAgentsModule | null {
  return agentsModule;
}

export function resetDesktopFeaturesForTests(): void {
  installBridgeGoalRuntime(null);
  installBridgeAgentsRuntime(null);
  goalModule = null;
  agentsModule = null;
}
