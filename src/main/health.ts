import type { AgentInfo, SwarmState } from '../shared/session.js';
import type {
  BridgeStatus,
  CanonicalHealthState,
  ConnectionStatus,
  SystemHealthComponent
} from '../shared/types.js';

export interface SystemHealthInput {
  connection: ConnectionStatus;
  bridge: BridgeStatus;
  swarm: SwarmState;
}

function tunnelState(state: ConnectionStatus['state']): CanonicalHealthState {
  switch (state) {
    case 'connected': return 'healthy';
    case 'starting-server':
    case 'connecting-tunnel': return 'starting';
    case 'offline': return 'degraded';
    case 'auth-failed':
    case 'tunnel-unavailable': return 'failed';
    case 'disconnected': return 'disconnected';
  }
}

function coreState(connection: ConnectionStatus): CanonicalHealthState {
  const core = connection.surfaces.find((surface) => surface.id === 'core');
  if (!core) {
    if (connection.state === 'starting-server' || connection.state === 'connecting-tunnel') return 'starting';
    if (connection.state === 'auth-failed' || connection.state === 'tunnel-unavailable') return 'failed';
    return connection.state === 'connected' || connection.state === 'offline' ? 'degraded' : 'disconnected';
  }
  switch (core.state) {
    case 'live': return 'healthy';
    case 'starting': return 'starting';
    case 'error': return 'failed';
    case 'off': return core.available ? 'disconnected' : 'degraded';
  }
}

function extensionState(bridge: BridgeStatus): CanonicalHealthState {
  if (!bridge.running) return 'disconnected';
  if (bridge.present) return 'healthy';
  if (!bridge.paired) return 'disconnected';
  return bridge.lastSeenAt === null ? 'starting' : 'degraded';
}

function agentState(agent: AgentInfo | undefined): CanonicalHealthState {
  if (!agent) return 'disconnected';
  switch (agent.state) {
    case 'active': return 'healthy';
    case 'invited': return 'starting';
    case 'waking': return 'recovering';
    case 'detached': return 'degraded';
    case 'sleeping':
    case 'finished': return 'disconnected';
    case 'failed': return 'failed';
  }
}

function workersState(workers: AgentInfo[]): CanonicalHealthState {
  if (workers.length === 0) return 'disconnected';
  const states = workers.map(agentState);
  if (states.includes('recovering')) return 'recovering';
  if (states.every((state) => state === 'failed')) return 'failed';
  if (states.includes('failed') || states.includes('degraded')) return 'degraded';
  if (states.includes('healthy')) return 'healthy';
  if (states.includes('starting')) return 'starting';
  return 'disconnected';
}

/**
 * Canonical System Health v1.
 *
 * This is deliberately a projection, not another lifecycle owner. Connection, bridge and
 * broker modules keep their detailed state machines; this file only translates those states to
 * one vocabulary so UI/recovery code never has to guess whether e.g. "offline" means failed or
 * merely degraded. Each layer is reported independently, so a healthy Core can never overwrite
 * an unhealthy extension/agent layer.
 */
export function projectSystemHealth(input: SystemHealthInput): SystemHealthComponent[] {
  const prime = input.swarm.agents.find((agent) => agent.role === 'prime');
  const workers = input.swarm.agents.filter((agent) => agent.role === 'worker');
  return [
    { id: 'desktop', state: 'healthy', detail: 'Desktop runtime is running.' },
    { id: 'mcp-core', state: coreState(input.connection), detail: input.connection.surfaces.find((surface) => surface.id === 'core')?.detail ?? input.connection.detail },
    { id: 'tunnel', state: tunnelState(input.connection.state), detail: input.connection.detail },
    {
      id: 'browser-bridge',
      state: input.bridge.running ? 'healthy' : 'disconnected',
      detail: input.bridge.running ? `Bridge listening${input.bridge.port ? ` on ${input.bridge.port}` : ''}.` : 'Browser bridge is not running.'
    },
    { id: 'extension', state: extensionState(input.bridge), detail: input.bridge.present ? 'Extension is present.' : input.bridge.paired ? 'Extension is paired but not present.' : 'Extension is not paired.' },
    { id: 'prime', state: agentState(prime), detail: prime ? `${prime.label || prime.id}: ${prime.state}` : 'No active Prime.' },
    { id: 'workers', state: workersState(workers), detail: workers.length ? `${workers.length} worker(s).` : 'No workers.' }
  ];
}
