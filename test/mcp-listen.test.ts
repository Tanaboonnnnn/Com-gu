import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { listenOnLoopback } from '../src/main/mcp/listen.js';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('listens on loopback with an OS-assigned port', async () => {
  const server = createServer(); servers.push(server);
  await listenOnLoopback(server);
  expect(server.address()).toMatchObject({ address: '127.0.0.1' });
});

it('retries transient EACCES without leaking error listeners', async () => {
  const server = createServer(); servers.push(server);
  const original = server.listen.bind(server);
  let attempts = 0;
  vi.spyOn(server, 'listen').mockImplementation(((...args: Parameters<typeof server.listen>) => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return original(...args);
  }) as typeof server.listen);
  await listenOnLoopback(server);
  expect(attempts).toBe(2);
  expect(server.listenerCount('error')).toBe(0);
});

it('does not retry unrelated errors', async () => {
  const server = createServer(); servers.push(server);
  const spy = vi.spyOn(server, 'listen').mockImplementation(() => { throw Object.assign(new Error('invalid'), { code: 'EINVAL' }); });
  await expect(listenOnLoopback(server)).rejects.toMatchObject({ code: 'EINVAL' });
  expect(spy).toHaveBeenCalledTimes(1);
});
