import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRuntimeControlServer,
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
});
