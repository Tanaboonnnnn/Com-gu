import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendRuntimeControlRequest } from '../src/main/runtime/control.js';
import { runCliOwner, type CliOwnerRuntime } from '../src/cli/owner.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir('comgu-cli-owner-');
});

afterEach(async () => removeTempDir(dir));

function fakeRuntime(events: string[]): CliOwnerRuntime {
  let state = 'disconnected';
  return {
    start: async () => { events.push('start'); },
    connect: async () => { events.push('connect'); state = 'connected'; },
    disconnect: async () => { events.push('disconnect'); state = 'disconnected'; },
    status: () => ({ state, detail: '', surfaces: [] }) as never,
    shutdown: async () => { events.push('shutdown'); state = 'disconnected'; }
  };
}

describe('CLI runtime owner', () => {
  it('owns one profile and exposes only lifecycle administration until shutdown', async () => {
    const events: string[] = [];
    const owner = runCliOwner({
      profileDir: dir,
      machine: { id: 'machine-1', name: 'server-one', createdAt: '2026-09-10T00:00:00.000Z', confirmed: true },
      runtime: fakeRuntime(events),
      reload: async () => { events.push('reload'); },
      installSignalHandlers: false
    });
    await vi.waitFor(async () => {
      expect(await sendRuntimeControlRequest(dir, 'status')).toMatchObject({
        runtime: 'running',
        mode: 'cli',
        machine: { id: 'machine-1', name: 'server-one' },
        connection: { state: 'disconnected' },
        durableRuns: []
      });
    });

    await sendRuntimeControlRequest(dir, 'connect');
    await sendRuntimeControlRequest(dir, 'disconnect');
    await sendRuntimeControlRequest(dir, 'reload');
    await sendRuntimeControlRequest(dir, 'shutdown');
    await owner;

    expect(events).toEqual(['start', 'connect', 'disconnect', 'reload', 'shutdown']);
    await expect(sendRuntimeControlRequest(dir, 'status')).rejects.toThrow(/No ComGu runtime owns|authentication/i);
  });

  it('exposes compact Durable Run status only through an injected lazy owner dependency', async () => {
    const events: string[] = [];
    const durableRunStatus = vi.fn(async () => [
      { id: 'run-1', objective: 'finish release', state: 'suspended', action: 'resume' }
    ]);
    const owner = runCliOwner({
      profileDir: dir,
      machine: { id: 'm1', name: 'one', createdAt: '2026-09-10T00:00:00.000Z', confirmed: true },
      runtime: fakeRuntime(events),
      durableRunStatus,
      installSignalHandlers: false
    });
    await vi.waitFor(async () => {
      expect(await sendRuntimeControlRequest(dir, 'status')).toMatchObject({
        durableRuns: [{ id: 'run-1', state: 'suspended', action: 'resume' }]
      });
    });
    expect(durableRunStatus).toHaveBeenCalled();
    await sendRuntimeControlRequest(dir, 'shutdown');
    await owner;
  });

  it('refuses a competing owner without shutting down the existing runtime', async () => {
    const firstEvents: string[] = [];
    const first = runCliOwner({
      profileDir: dir,
      machine: { id: 'm1', name: 'one', createdAt: '2026-09-10T00:00:00.000Z', confirmed: true },
      runtime: fakeRuntime(firstEvents),
      installSignalHandlers: false
    });
    await vi.waitFor(async () => expect(await sendRuntimeControlRequest(dir, 'status')).toBeTruthy());

    await expect(runCliOwner({
      profileDir: dir,
      machine: { id: 'm2', name: 'two', createdAt: '2026-09-10T00:00:00.000Z', confirmed: true },
      runtime: fakeRuntime([]),
      installSignalHandlers: false
    })).rejects.toThrow(/already has an owner/i);

    expect(firstEvents).toEqual(['start']);
    await sendRuntimeControlRequest(dir, 'shutdown');
    await first;
  });
});
