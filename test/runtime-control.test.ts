import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireRuntimeControlOwnershipGate,
  createRuntimeControlServer,
  repairRuntimeControlOwnership,
  runtimeControlEndpoint,
  sendRuntimeControlRequest
} from '../src/main/runtime/control.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir('comgu-control-');
});

afterEach(async () => {
  await removeTempDir(dir);
});

describe('runtime local control channel', () => {
  it.runIf(process.platform !== 'win32')('never treats a paused live ownership generation as stale before publication completes', async () => {
    let reachedClaim!: () => void;
    const claimed = new Promise<void>((resolve) => { reachedClaim = resolve; });
    let resumeOwner!: () => void;
    const ownerMayFinish = new Promise<void>((resolve) => { resumeOwner = resolve; });
    const identities = new Map<number, string | null>([[41001, 'start-a'], [41002, 'start-b']]);

    const firstPending = acquireRuntimeControlOwnershipGate(dir, 2_000, {
      pid: 41001,
      processIdentity: async (pid) => identities.get(pid) ?? null,
      afterClaimPublished: async () => {
        reachedClaim();
        await ownerMayFinish;
      }
    });
    await claimed;
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    await expect(acquireRuntimeControlOwnershipGate(dir, 100, {
      pid: 41002,
      processIdentity: async (pid) => identities.get(pid) ?? null
    })).rejects.toThrow(/already has an owner/i);

    resumeOwner();
    const release = await firstPending;
    const ownerRecord = JSON.parse(await fs.readFile(`${dir}/.comgu-control.owner`, 'utf8')) as { pid: number };
    expect(ownerRecord.pid).toBe(41001);
    await release();
  });

  it.runIf(process.platform !== 'win32')('cannot let an older stale reaper publish into or release a newer ownership generation', async () => {
    const identities = new Map<number, string | null>([
      [42001, 'start-old'],
      [42002, 'start-reaper'],
      [42003, 'start-winner'],
      [42004, 'start-loser']
    ]);
    const identity = async (pid: number) => identities.get(pid) ?? null;
    const oldRelease = await acquireRuntimeControlOwnershipGate(dir, 2_000, {
      pid: 42001,
      processIdentity: identity
    });
    identities.set(42001, null);

    let staleRemoved!: () => void;
    const removed = new Promise<void>((resolve) => { staleRemoved = resolve; });
    let resumeReaper!: () => void;
    const reaperMayContinue = new Promise<void>((resolve) => { resumeReaper = resolve; });
    const reaper = acquireRuntimeControlOwnershipGate(dir, 2_000, {
      pid: 42002,
      processIdentity: identity,
      afterStaleOwnerRemoved: async () => {
        staleRemoved();
        await reaperMayContinue;
      }
    });
    await removed;

    const winnerRelease = await acquireRuntimeControlOwnershipGate(dir, 2_000, {
      pid: 42003,
      processIdentity: identity
    });
    resumeReaper();
    await expect(reaper).rejects.toThrow(/already has an owner/i);

    // The old owner's delayed cleanup must not unlink the winner's generation.
    await oldRelease();
    await expect(acquireRuntimeControlOwnershipGate(dir, 100, {
      pid: 42004,
      processIdentity: identity
    })).rejects.toThrow(/already has an owner/i);
    const ownerRecord = JSON.parse(await fs.readFile(`${dir}/.comgu-control.owner`, 'utf8')) as { pid: number };
    expect(ownerRecord.pid).toBe(42003);
    await winnerRelease();
  });

  it('holds the atomic Unix ownership gate for the owner lifetime and allows reacquisition after release', async () => {
    const identity = async (pid: number) => `test:${pid}`;
    const first = await acquireRuntimeControlOwnershipGate(dir, 2_000, { processIdentity: identity });
    await expect(acquireRuntimeControlOwnershipGate(dir, 100, { processIdentity: identity })).rejects.toThrow(/already has an owner/i);
    await first();
    const second = await acquireRuntimeControlOwnershipGate(dir, 2_000, { processIdentity: identity });
    await second();
  });

  it('serves only the narrow administrative methods with per-profile authentication', async () => {
    const connect = vi.fn(async () => undefined);
    const server = createRuntimeControlServer({
      profileDir: dir,
      handlers: {
        status: async () => ({ state: 'connected', machine: 'test-machine' }),
        connect,
        disconnect: async () => undefined,
        shutdown: async () => undefined,
        reload: async () => undefined
      }
    });
    await server.start();
    try {
      expect(await sendRuntimeControlRequest(dir, 'status')).toEqual({ state: 'connected', machine: 'test-machine' });
      await sendRuntimeControlRequest(dir, 'connect');
      expect(connect).toHaveBeenCalledTimes(1);
      await expect(sendRuntimeControlRequest(dir, 'exec_command' as never)).rejects.toThrow(/unsupported control method/i);
    } finally {
      await server.close();
    }
  });

  it('refuses a second runtime owner for the same profile', async () => {
    const handlers = {
      status: async () => ({ state: 'disconnected' }),
      connect: async () => undefined,
      disconnect: async () => undefined,
      shutdown: async () => undefined,
      reload: async () => undefined
    };
    const first = createRuntimeControlServer({ profileDir: dir, handlers });
    const second = createRuntimeControlServer({ profileDir: dir, handlers });
    await first.start();
    try {
      await expect(second.start()).rejects.toThrow(/already has an owner/i);
    } finally {
      await first.close();
      await second.close().catch(() => undefined);
    }
  });

  it.runIf(process.platform !== 'win32')('keeps exactly one reachable owner across concurrent Unix starts and loser cleanup', async () => {
    const handlers = {
      status: async () => ({ state: 'connected' }),
      connect: async () => undefined,
      disconnect: async () => undefined,
      shutdown: async () => undefined,
      reload: async () => undefined
    };
    const first = createRuntimeControlServer({ profileDir: dir, handlers });
    const second = createRuntimeControlServer({ profileDir: dir, handlers });
    const results = await Promise.allSettled([first.start(), second.start()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await sendRuntimeControlRequest(dir, 'status')).toEqual({ state: 'connected' });

    const winner = results[0]?.status === 'fulfilled' ? first : second;
    const loser = winner === first ? second : first;
    await loser.close().catch(() => undefined);
    expect(await sendRuntimeControlRequest(dir, 'status')).toEqual({ state: 'connected' });
    await winner.close();
    await expect(fs.stat(runtimeControlEndpoint(dir))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps authentication material out of responses and locks its token file down', async () => {
    const server = createRuntimeControlServer({
      profileDir: dir,
      handlers: {
        status: async () => ({ state: 'connected' }),
        connect: async () => undefined,
        disconnect: async () => undefined,
        shutdown: async () => undefined,
        reload: async () => undefined
      }
    });
    await server.start();
    try {
      const response = JSON.stringify(await sendRuntimeControlRequest(dir, 'status'));
      const token = (await fs.readFile(server.authPath, 'utf8')).trim();
      expect(token.length).toBeGreaterThan(40);
      expect(response).not.toContain(token);
      if (process.platform !== 'win32') {
        expect((await fs.stat(server.authPath)).mode & 0o777).toBe(0o600);
        expect((await fs.stat(runtimeControlEndpoint(dir))).mode & 0o777).toBe(0o600);
      }
    } finally {
      await server.close();
    }
  });

  it('releases profile ownership when control authentication bootstrap fails', async () => {
    await fs.writeFile(`${dir}/control.auth`, 'not-a-valid-control-token\n', 'utf8');
    const handlers = {
      status: async () => ({ state: 'disconnected' }),
      connect: async () => undefined,
      disconnect: async () => undefined,
      shutdown: async () => undefined,
      reload: async () => undefined
    };
    const failed = createRuntimeControlServer({ profileDir: dir, handlers });
    await expect(failed.start()).rejects.toThrow(/authentication.*invalid/i);
    await fs.rm(`${dir}/control.auth`, { force: true });

    const next = createRuntimeControlServer({ profileDir: dir, handlers });
    await expect(next.start()).resolves.toBeUndefined();
    await next.close();
  });

  it('repairs only a stale recovery election and leaves stale owner cleanup to normal acquisition', async () => {
    const owner = { version: 1, pid: 51001, processIdentity: 'old-owner', nonce: '11111111111111111111111111111111' };
    const recovery = { version: 1, pid: 51002, processIdentity: 'dead-reaper', nonce: '22222222222222222222222222222222' };
    await fs.writeFile(`${dir}/.comgu-control.owner`, JSON.stringify(owner), 'utf8');
    await fs.writeFile(`${dir}/.comgu-control.recovery`, JSON.stringify(recovery), 'utf8');

    const result = await repairRuntimeControlOwnership(dir, {
      processIdentity: async () => null,
      endpointAccepting: async () => false
    });

    expect(result).toMatchObject({ repaired: true });
    await expect(fs.stat(`${dir}/.comgu-control.recovery`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await fs.readFile(`${dir}/.comgu-control.owner`, 'utf8'))).toEqual(owner);
  });

  it('refuses ownership repair if the recovery contender is still alive', async () => {
    const recovery = { version: 1, pid: 52002, processIdentity: 'live-reaper', nonce: '33333333333333333333333333333333' };
    await fs.writeFile(`${dir}/.comgu-control.recovery`, JSON.stringify(recovery), 'utf8');

    await expect(repairRuntimeControlOwnership(dir, {
      processIdentity: async (pid) => pid === 52002 ? 'live-reaper' : null,
      endpointAccepting: async () => false
    })).rejects.toThrow(/recovery.*active|still active/i);
    await expect(fs.stat(`${dir}/.comgu-control.recovery`)).resolves.toBeTruthy();
  });

  it('fails closed if the owner generation changes while stale recovery repair is verifying', async () => {
    const owner = { version: 1, pid: 53001, processIdentity: 'old-owner', nonce: '55555555555555555555555555555555' };
    const recovery = { version: 1, pid: 53002, processIdentity: 'dead-reaper', nonce: '55555555555555555555555555555555' };
    await fs.writeFile(`${dir}/.comgu-control.owner`, JSON.stringify(owner), 'utf8');
    await fs.writeFile(`${dir}/.comgu-control.recovery`, JSON.stringify(recovery), 'utf8');

    await expect(repairRuntimeControlOwnership(dir, {
      endpointAccepting: async () => false,
      processIdentity: async (pid) => {
        if (pid === owner.pid) {
          await fs.writeFile(`${dir}/.comgu-control.owner`, JSON.stringify({
            version: 1, pid: 53003, processIdentity: 'new-owner', nonce: '66666666666666666666666666666666'
          }), 'utf8');
        }
        return null;
      }
    })).rejects.toThrow(/owner generation changed/i);

    await expect(fs.stat(`${dir}/.comgu-control.recovery`)).resolves.toBeTruthy();
  });
});
