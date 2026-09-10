import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const AUTH_FILE = 'control.auth';
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

  const close = async (): Promise<void> => {
    const current = server;
    server = null;
    if (current) {
      await new Promise<void>((resolve) => current.close(() => resolve())).catch(() => {});
    }
    if (started && platform !== 'win32') {
      await fs.rm(endpoint, { force: true }).catch(() => {});
    }
    started = false;
  };

  return {
    endpoint,
    authPath,
    async start() {
      if (started) return;
      const token = await ensureToken(authPath);

      if (await endpointAccepting(endpoint)) throw new Error('This ComGu profile already has an owner');
      if (platform !== 'win32') {
        // A Unix-domain socket pathname can survive an unclean process exit. Remove it only after
        // proving no process is accepting connections there; an active owner is never unlinked.
        await fs.rm(endpoint, { force: true }).catch(() => {});
      }

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
        await new Promise<void>((resolve, reject) => {
          candidate.once('error', reject);
          candidate.listen(
            platform === 'win32'
              ? { path: endpoint, readableAll: false, writableAll: false }
              : { path: endpoint },
            resolve
          );
        });
      } catch (error) {
        candidate.close();
        if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          throw new Error('This ComGu profile already has an owner');
        }
        throw error;
      }
      server = candidate;
      started = true;
      if (platform !== 'win32') await fs.chmod(endpoint, 0o600);
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
