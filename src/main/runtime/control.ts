import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const AUTH_FILE = 'control.auth';
const OWNERSHIP_GATE_DIR = '.comgu-control.acquire';
const MAX_MESSAGE_BYTES = 16 * 1024;
const CONTROL_METHODS = new Set(['status', 'connect', 'disconnect', 'shutdown', 'reload']);

export type RuntimeControlMethod = 'status' | 'connect' | 'disconnect' | 'shutdown' | 'reload';

export interface RuntimeControlHandlers {
  status(): unknown | Promise<unknown>;
  connect(): void | Promise<void>;
  disconnect(): void | Promise<void>;
  shutdown(): void | Promise<void>;
  reload(): void | Promise<void>;
}

export interface RuntimeControlServer {
  readonly endpoint: string;
  readonly authPath: string;
  start(): Promise<void>;
  close(): Promise<void>;
}

function profileHash(profileDir: string): string {
  const normalized = path.resolve(profileDir).toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24);
}

export function runtimeControlEndpoint(
  profileDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') return `\\\\.\\pipe\\comgu-${profileHash(profileDir)}`;
  return path.join(profileDir, '.comgu-control.sock');
}

function authFile(profileDir: string): string {
  return path.join(profileDir, AUTH_FILE);
}

function ownershipGatePath(profileDir: string): string {
  return path.join(profileDir, OWNERSHIP_GATE_DIR);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquires the Unix runtime owner lease for one profile with an atomic mkdir.
 *
 * The lease is held for the whole runtime lifetime, not merely around bind. That means no
 * second ComGu process can ever reach stale-socket cleanup while a live owner exists. Crash
 * recovery removes only the exact owner file whose pid was proven dead; a contender that
 * observed an older generation therefore cannot delete a newer owner's lease.
 */
export async function acquireRuntimeControlOwnershipGate(
  profileDir: string,
  timeoutMs = 2_000
): Promise<() => Promise<void>> {
  await fs.mkdir(profileDir, { recursive: true });
  const gate = ownershipGatePath(profileDir);
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const ownerPattern = /^owner-(\d+)-([a-f0-9]{16})$/;
  const processAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  };
  for (;;) {
    try {
      await fs.mkdir(gate, { mode: 0o700 });
      const ownerName = `owner-${process.pid}-${randomBytes(8).toString('hex')}`;
      const ownerPath = path.join(gate, ownerName);
      await fs.writeFile(ownerPath, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        const removedOwnMarker = await fs.unlink(ownerPath).then(
          () => true,
          () => false
        );
        // Never remove the directory if our exact generation marker is already gone: the path
        // may now belong to a newer owner generation.
        if (removedOwnMarker) await fs.rmdir(gate).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      const entries = await fs.readdir(gate).catch((readError: NodeJS.ErrnoException) => {
        if (readError.code === 'ENOENT') return null;
        throw readError;
      });
      if (entries === null) continue;
      const ownerName = entries.find((entry) => ownerPattern.test(entry));
      if (ownerName) {
        const match = ownerName.match(ownerPattern)!;
        const pid = Number(match[1]);
        if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) {
          throw new Error('This ComGu profile already has an owner');
        }
        // Compare-by-name cleanup: if another contender already replaced this stale generation,
        // this exact unlink returns ENOENT and we deliberately do not rmdir the new generation.
        const removedStaleMarker = await fs.unlink(path.join(gate, ownerName)).then(
          () => true,
          (unlinkError: NodeJS.ErrnoException) => {
            if (unlinkError.code === 'ENOENT') return false;
            throw unlinkError;
          }
        );
        if (removedStaleMarker) await fs.rmdir(gate).catch(() => undefined);
        continue;
      }

      // A creator may have completed mkdir but not yet written its marker. Give that bounded
      // critical section time to finish. An old empty directory is safe to remove because no
      // owner generation exists inside it to be confused with a newer one.
      const stat = await fs.stat(gate).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs >= 1_000) {
        await fs.rmdir(gate).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error('ComGu profile ownership acquisition is busy');
      }
      await sleep(20);
    }
  }
}

async function readToken(file: string): Promise<string> {
  const token = (await fs.readFile(file, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('ComGu local control authentication is invalid');
  return token;
}

async function ensureToken(file: string): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    return await readToken(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const token = randomBytes(32).toString('hex');
  try {
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      await handle.writeFile(`${token}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    await fs.chmod(file, 0o600).catch(() => {});
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return readToken(file);
    throw error;
  }
}

function endpointAccepting(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint);
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

function safeControlError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300).replace(/[\r\n]+/g, ' ');
}

export function createRuntimeControlServer(options: {
  profileDir: string;
  handlers: RuntimeControlHandlers;
  platform?: NodeJS.Platform;
}): RuntimeControlServer {
  const platform = options.platform ?? process.platform;
  const endpoint = runtimeControlEndpoint(options.profileDir, platform);
  const authPath = authFile(options.profileDir);
  let server: net.Server | null = null;
  let started = false;
  let ownedEndpointIdentity: { dev: number; ino: number } | null = null;
  let releaseOwnershipGate: (() => Promise<void>) | null = null;

  const close = async (): Promise<void> => {
    try {
      const current = server;
      server = null;
      if (current) {
        await new Promise<void>((resolve) => current.close(() => resolve())).catch(() => {});
      }
      if (started && platform !== 'win32' && ownedEndpointIdentity) {
        const identity = await fs.stat(endpoint).then(
          (stat) => ({ dev: stat.dev, ino: stat.ino }),
          () => null
        );
        if (identity && identity.dev === ownedEndpointIdentity.dev && identity.ino === ownedEndpointIdentity.ino) {
          await fs.rm(endpoint, { force: true }).catch(() => {});
        }
      }
      ownedEndpointIdentity = null;
      started = false;
    } finally {
      const release = releaseOwnershipGate;
      releaseOwnershipGate = null;
      await release?.();
    }
  };

  return {
    endpoint,
    authPath,
    async start() {
      if (started) return;
      const token = await ensureToken(authPath);
      let acquiredOwnership = platform !== 'win32'
        ? await acquireRuntimeControlOwnershipGate(options.profileDir)
        : null;

      const candidate = net.createServer((socket) => {
        let bytes = 0;
        let body = '';
        let handled = false;
        const respond = (reply: unknown): void => {
          if (handled) return;
          handled = true;
          socket.end(`${JSON.stringify(reply)}\n`);
        };
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => {
          if (handled) return;
          bytes += Buffer.byteLength(chunk, 'utf8');
          if (bytes > MAX_MESSAGE_BYTES) {
            respond({ ok: false, error: 'Control request is too large' });
            return;
          }
          body += chunk;
          const newline = body.indexOf('\n');
          if (newline === -1) return;
          const row = body.slice(0, newline);
          void (async () => {
            try {
              const request = JSON.parse(row) as Record<string, unknown>;
              if (request['token'] !== token) throw new Error('Local control authentication failed');
              const method = request['method'];
              if (typeof method !== 'string' || !CONTROL_METHODS.has(method)) {
                throw new Error('Unsupported control method');
              }
              switch (method as RuntimeControlMethod) {
                case 'status':
                  respond({ ok: true, data: await options.handlers.status() });
                  return;
                case 'connect':
                  await options.handlers.connect();
                  break;
                case 'disconnect':
                  await options.handlers.disconnect();
                  break;
                case 'shutdown':
                  await options.handlers.shutdown();
                  break;
                case 'reload':
                  await options.handlers.reload();
                  break;
              }
              respond({ ok: true, data: null });
            } catch (error) {
              respond({ ok: false, error: safeControlError(error) });
            }
          })();
        });
      });

      try {
        if (await endpointAccepting(endpoint)) throw new Error('This ComGu profile already has an owner');
        if (platform !== 'win32') {
          // The ownership gate serializes this stale-path recovery with every other start/close.
          // No second ComGu process can bind this pathname between the failed probe and unlink.
          await fs.rm(endpoint, { force: true }).catch(() => {});
        }
        await new Promise<void>((resolve, reject) => {
          candidate.once('error', reject);
          candidate.listen(
            platform === 'win32'
              ? { path: endpoint, readableAll: false, writableAll: false }
              : { path: endpoint },
            resolve
          );
        });
        if (platform !== 'win32') {
          await fs.chmod(endpoint, 0o600);
          const stat = await fs.stat(endpoint);
          ownedEndpointIdentity = { dev: stat.dev, ino: stat.ino };
        }
        server = candidate;
        started = true;
        releaseOwnershipGate = acquiredOwnership;
        acquiredOwnership = null;
      } catch (error) {
        candidate.close();
        if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          throw new Error('This ComGu profile already has an owner');
        }
        throw error;
      } finally {
        await acquiredOwnership?.();
      }
    },
    close
  };
}

export async function sendRuntimeControlRequest(
  profileDir: string,
  method: string,
  platform: NodeJS.Platform = process.platform
): Promise<unknown> {
  const endpoint = runtimeControlEndpoint(profileDir, platform);
  const token = await readToken(authFile(profileDir));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let body = '';
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    socket.setEncoding('utf8');
    socket.setTimeout(2_000, () => finish(new Error('ComGu runtime control timed out')));
    socket.once('error', () => finish(new Error('No ComGu runtime owns this profile')));
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ token, method })}\n`);
    });
    socket.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > MAX_MESSAGE_BYTES) {
        finish(new Error('ComGu runtime control response is too large'));
        return;
      }
      body += chunk;
      const newline = body.indexOf('\n');
      if (newline === -1) return;
      try {
        const reply = JSON.parse(body.slice(0, newline)) as { ok?: unknown; data?: unknown; error?: unknown };
        if (reply.ok !== true) {
          finish(new Error(typeof reply.error === 'string' ? reply.error : 'ComGu runtime control failed'));
          return;
        }
        finish(undefined, reply.data);
      } catch {
        finish(new Error('ComGu runtime control returned invalid data'));
      }
    });
  });
}
