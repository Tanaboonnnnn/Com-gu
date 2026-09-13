import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeControlServer, sendRuntimeControlRequest } from '../src/main/runtime/control.js';
import { currentMachineProfile, initMachineProfile } from '../src/main/machine/profile.js';
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
  it('lets only the profile owner create the first machine identity and keeps memory equal to disk', async () => {
    const winnerUuid = '0a51e3f2-8429-4cba-9b5b-01f0f8f6e4f1';
    const loserUuid = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const winnerInit = vi.fn(async () => {
      await initMachineProfile(dir, { suggestedName: 'winner', uuid: () => winnerUuid });
    });
    const loserInit = vi.fn(async () => {
      await initMachineProfile(dir, { suggestedName: 'loser', uuid: () => loserUuid });
    });
    const winner = runCliOwner({
      profileDir: dir,
      machine: () => currentMachineProfile(),
      runtime: fakeRuntime([]),
      initialize: winnerInit,
      installSignalHandlers: false
    });
    await vi.waitFor(async () => {
      await fs.access(path.join(dir, 'control.auth'));
      expect(await sendRuntimeControlRequest(dir, 'status')).toBeTruthy();
    }, { timeout: 10_000 });

    await expect(runCliOwner({
      profileDir: dir,
      machine: () => currentMachineProfile(),
      runtime: fakeRuntime([]),
      initialize: loserInit,
      installSignalHandlers: false
    })).rejects.toThrow(/already has an owner/i);

    const persisted = JSON.parse(await fs.readFile(path.join(dir, 'machine.json'), 'utf8')) as { id: string };
    expect(winnerInit).toHaveBeenCalledTimes(1);
    expect(loserInit).not.toHaveBeenCalled();
    expect(persisted.id).toBe(winnerUuid);
    expect(currentMachineProfile()?.id).toBe(persisted.id);

    await sendRuntimeControlRequest(dir, 'shutdown');
    await winner;
  });

  it('attaches to a Desktop-owned profile and refuses to initialize a competing CLI runtime', async () => {
    const desktop = createRuntimeControlServer({
      profileDir: dir,
      handlers: {
        status: async () => ({ runtime: 'running', mode: 'desktop', machine: { id: 'desktop-machine' } }),
        connect: async () => undefined,
        disconnect: async () => undefined,
        shutdown: async () => undefined,
        reload: async () => undefined
      }
    });
    await desktop.start();
    const loserInit = vi.fn(async () => undefined);
    try {
      expect(await sendRuntimeControlRequest(dir, 'status')).toMatchObject({ mode: 'desktop' });
      await expect(runCliOwner({
        profileDir: dir,
        machine: { id: 'cli-machine', name: 'cli', createdAt: '2026-09-10T00:00:00.000Z', confirmed: true },
        runtime: fakeRuntime([]),
        initialize: loserInit,
        installSignalHandlers: false
      })).rejects.toThrow(/already has an owner/i);
      expect(loserInit).not.toHaveBeenCalled();
    } finally {
      await desktop.close();
    }
  });

  it('prevents a Desktop control owner from starting while the CLI owns the same profile', async () => {
    const events: string[] = [];
    const cli = runCliOwner({
      profileDir: dir,
      machine: { id: 'm1', name: 'one', createdAt: '2026-09-10T00:00:00.000Z', confirmed: true },
      runtime: fakeRuntime(events),
      installSignalHandlers: false
    });
    await vi.waitFor(async () => expect(await sendRuntimeControlRequest(dir, 'status')).toMatchObject({ mode: 'cli' }), { timeout: 10_000 });
    const desktop = createRuntimeControlServer({
      profileDir: dir,
      handlers: {
        status: async () => ({ mode: 'desktop' }),
        connect: async () => undefined,
        disconnect: async () => undefined,
        shutdown: async () => undefined,
        reload: async () => undefined
      }
    });
    await expect(desktop.start()).rejects.toThrow(/already has an owner/i);
    expect(events).toEqual(['start']);
    await sendRuntimeControlRequest(dir, 'shutdown');
    await cli;
    await desktop.close().catch(() => undefined);
  });

  it('acquires profile ownership before mutable initialization and never initializes the losing contender', async () => {
    const events: string[] = [];
    let releaseInit!: () => void;
    const initGate = new Promise<void>((resolve) => { releaseInit = resolve; });
    const firstInit = vi.fn(async () => {
      events.push('initialize');
      await initGate;
    });
    const first = runCliOwner({
      profileDir: dir,
      machine: { id: 'm1', name: 'one', createdAt: '2026-09-10T00:00:00.000Z', confirmed: true },
      runtime: fakeRuntime(events),
      initialize: firstInit,
      installSignalHandlers: false
    });
    await vi.waitFor(() => expect(firstInit).toHaveBeenCalledTimes(1), { timeout: 10_000 });

    const loserInit = vi.fn(async () => undefined);
    await expect(runCliOwner({
      profileDir: dir,
      machine: { id: 'm2', name: 'two', createdAt: '2026-09-10T00:00:00.000Z', confirmed: true },
      runtime: fakeRuntime([]),
      initialize: loserInit,
      installSignalHandlers: false
    })).rejects.toThrow(/already has an owner/i);
    expect(loserInit).not.toHaveBeenCalled();

    releaseInit();
    await vi.waitFor(async () => expect(await sendRuntimeControlRequest(dir, 'status')).toBeTruthy(), { timeout: 10_000 });
    await sendRuntimeControlRequest(dir, 'shutdown');
    await first;
  });

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
    }, { timeout: 10_000 });

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
    }, { timeout: 10_000 });
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
    await vi.waitFor(async () => expect(await sendRuntimeControlRequest(dir, 'status')).toBeTruthy(), { timeout: 10_000 });

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
