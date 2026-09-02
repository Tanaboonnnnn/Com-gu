import { describe, expect, it } from 'vitest';
import { projectSystemHealth } from '../src/main/health.js';
import type { BridgeStatus, ConnectionStatus } from '../src/shared/types.js';
import type { SwarmState } from '../src/shared/session.js';

const disconnected: ConnectionStatus = {
  state: 'disconnected',
  detail: '',
  publicUrl: null,
  localUrl: null,
  handshakeAt: null,
  lastRequestAt: null,
  lastToolCallAt: null,
  health: null,
  surfaces: []
};

const bridgeOff: BridgeStatus = {
  running: false,
  port: null,
  paired: false,
  present: false,
  lastSeenAt: null
};

const noSwarm: SwarmState = {
  enabled: true,
  running: false,
  runId: null,
  workspaceScope: null,
  selectedWorkspaceScope: null,
  agents: []
};

describe('System Health v1 projection', () => {
  it('uses only the canonical health states for every component', () => {
    const health = projectSystemHealth({ connection: disconnected, bridge: bridgeOff, swarm: noSwarm });
    const canonical = new Set(['healthy', 'starting', 'degraded', 'disconnected', 'recovering', 'failed']);

    expect(health.map((component) => component.id)).toEqual([
      'desktop',
      'mcp-core',
      'tunnel',
      'browser-bridge',
      'extension',
      'prime',
      'workers'
    ]);
    expect(health.every((component) => canonical.has(component.state))).toBe(true);
  });

  it('does not let a healthy Core hide a disconnected extension or degraded agent layer', () => {
    const health = projectSystemHealth({
      connection: {
        ...disconnected,
        state: 'connected',
        surfaces: [
          {
            id: 'core',
            connectorName: 'ComGu Core',
            description: '',
            cardSummary: '',
            optional: false,
            available: true,
            localUrl: 'http://127.0.0.1/core',
            publicUrl: 'https://example.invalid/core',
            tools: ['read'],
            state: 'live',
            detail: '',
            lastRequestAt: Date.now(),
            lastToolCallAt: Date.now()
          }
        ]
      },
      bridge: { running: true, port: 8765, paired: true, present: false, lastSeenAt: Date.now() - 60_000 },
      swarm: {
        ...noSwarm,
        running: true,
        runId: '8dfbd4ac-fa26-49cf-962d-86dc6ae9e4d3',
        agents: [
          {
            id: 'prime', role: 'prime', label: 'Prime', task: '', state: 'detached', createdAt: 1,
            activatedAt: 1, finishedAt: null, result: null, pending: 0, awaitingAck: 0, delivered: 0,
            conversationId: 'prime-chat', detachedAt: 2, lastSeenAt: 1, revivable: false, sleptAt: null,
            contextTokens: 0
          },
          {
            id: 'worker-1', role: 'worker', label: 'Worker', task: '', state: 'waking', createdAt: 1,
            activatedAt: 1, finishedAt: null, result: null, pending: 1, awaitingAck: 0, delivered: 0,
            conversationId: 'worker-chat', detachedAt: null, lastSeenAt: 1, revivable: true, sleptAt: 1,
            contextTokens: 0
          }
        ]
      }
    });

    expect(Object.fromEntries(health.map((component) => [component.id, component.state]))).toMatchObject({
      desktop: 'healthy',
      'mcp-core': 'healthy',
      tunnel: 'healthy',
      'browser-bridge': 'healthy',
      extension: 'degraded',
      prime: 'degraded',
      workers: 'recovering'
    });
  });

  it('distinguishes startup, transport failure and absent higher layers', () => {
    const starting = projectSystemHealth({
      connection: { ...disconnected, state: 'connecting-tunnel' },
      bridge: { running: true, port: 8765, paired: true, present: false, lastSeenAt: null },
      swarm: noSwarm
    });
    expect(Object.fromEntries(starting.map((component) => [component.id, component.state]))).toMatchObject({
      tunnel: 'starting',
      extension: 'starting',
      prime: 'disconnected',
      workers: 'disconnected'
    });

    const failed = projectSystemHealth({
      connection: { ...disconnected, state: 'auth-failed' },
      bridge: bridgeOff,
      swarm: noSwarm
    });
    expect(failed.find((component) => component.id === 'tunnel')?.state).toBe('failed');
  });
});
