import { describe, expect, it, vi } from 'vitest';
import { RecoveryManager, type RecoveryGuard } from '../src/main/recovery.js';

const guard = (runId = 'run-a', scopeFingerprint = 'scope-a'): RecoveryGuard => ({ runId, scopeFingerprint });

describe('bounded Recovery Manager v1', () => {
  it('retries a reversible operation with bounded backoff and stops after recovery', async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    const manager = new RecoveryManager({
      guard: () => guard(),
      sleep,
      maxAttempts: 3,
      backoffMs: [10, 20],
      actions: {
        reconnectBridge: async () => (++attempts === 3 ? 'recovered' : 'retry'),
        restartTunnel: async () => 'recovered',
        reopenBrowser: async () => 'recovered',
        wakePrime: async () => 'recovered'
      }
    });

    const result = await manager.recover('reconnect-bridge');

    expect(result).toMatchObject({ outcome: 'recovered', attempts: 3, operation: 'reconnect-bridge' });
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('cancels recovery when RunId or effective scope changes before a retry', async () => {
    let current = guard();
    let calls = 0;
    const manager = new RecoveryManager({
      guard: () => current,
      sleep: async () => {
        current = guard('run-b', 'scope-b');
      },
      maxAttempts: 3,
      backoffMs: [1, 1],
      actions: {
        reconnectBridge: async () => {
          calls += 1;
          return 'retry';
        },
        restartTunnel: async () => 'recovered',
        reopenBrowser: async () => 'recovered',
        wakePrime: async () => 'recovered'
      }
    });

    const result = await manager.recover('reconnect-bridge');

    expect(result).toMatchObject({ outcome: 'degraded', attempts: 1, reason: 'authority-changed' });
    expect(calls).toBe(1);
  });

  it('rechecks authority after an action so a successful-looking stale recovery cannot publish success', async () => {
    let current = guard();
    const manager = new RecoveryManager({
      guard: () => current,
      sleep: async () => undefined,
      actions: {
        reconnectBridge: async () => {
          current = guard('run-a', 'scope-narrowed');
          return 'recovered';
        },
        restartTunnel: async () => 'recovered',
        reopenBrowser: async () => 'recovered',
        wakePrime: async () => 'recovered'
      }
    });

    await expect(manager.recover('reconnect-bridge')).resolves.toMatchObject({
      outcome: 'degraded',
      reason: 'authority-changed'
    });
  });

  it('returns requires-user immediately and never loops forever', async () => {
    const action = vi.fn(async () => 'requires-user' as const);
    const manager = new RecoveryManager({
      guard: () => guard(),
      sleep: async () => undefined,
      maxAttempts: 99,
      actions: {
        reconnectBridge: async () => 'recovered',
        restartTunnel: async () => 'recovered',
        reopenBrowser: action,
        wakePrime: async () => 'recovered'
      }
    });

    const result = await manager.recover('reopen-browser');
    expect(result).toMatchObject({ outcome: 'requires-user', attempts: 1 });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('terminates at failed after the configured retry budget', async () => {
    const action = vi.fn(async () => 'retry' as const);
    const manager = new RecoveryManager({
      guard: () => guard(),
      sleep: async () => undefined,
      maxAttempts: 2,
      backoffMs: [0],
      actions: {
        reconnectBridge: async () => 'recovered',
        restartTunnel: action,
        reopenBrowser: async () => 'recovered',
        wakePrime: async () => 'recovered'
      }
    });

    const result = await manager.recover('restart-tunnel');
    expect(result).toMatchObject({ outcome: 'failed', attempts: 2, reason: 'retry-budget-exhausted' });
    expect(action).toHaveBeenCalledTimes(2);
  });
});
