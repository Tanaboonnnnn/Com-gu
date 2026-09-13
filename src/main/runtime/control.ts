import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const AUTH_FILE = 'control.auth';
const OWNERSHIP_OWNER_FILE = '.comgu-control.owner';
const OWNERSHIP_RECOVERY_FILE = '.comgu-control.recovery';
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

function ownershipOwnerPath(profileDir: string): string {
  return path.join(profileDir, OWNERSHIP_OWNER_FILE);
}

interface RuntimeOwnerRecord {
  version: 1;
  pid: number;
  processIdentity: string;
  nonce: string;
}

export interface RuntimeOwnershipRepairDependencies {
  processIdentity?: (pid: number) => Promise<string | null>;
  endpointAccepting?: (endpoint: string) => Promise<boolean>;
}

export interface RuntimeOwnershipRepairResult {
  repaired: boolean;
  detail: string;
}

export interface RuntimeOwnershipDependencies {
  pid?: number;
  processIdentity?: (pid: number) => Promise<string | null>;
  afterClaimPublished?: () => Promise<void>;
  afterStaleOwnerRemoved?: () => Promise<void>;
}

async function psProcessIdentity(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
        stdio: ['ignore', 'pipe', 'ignore']
      });
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
      child.once('error', () => finish(null));
      child.once('close', (code) => finish(code === 0 && stdout.trim() ? stdout.trim() : null));
    } catch {
      finish(null);
    }
  });
}

async function processStartIdentity(pid: number): Promise<string | null> {
  if (process.platform === 'win32') {
    const powershell = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    return new Promise((resolve) => {
      let stdout = '';
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const script = `$p = Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Out.Write($p.StartTime.ToUniversalTime().ToString('o'))`;
        const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
        child.once('error', () => finish(null));
        child.once('close', (code) => finish(code === 0 && stdout.trim() ? `win32:${stdout.trim()}` : null));
      } catch {
        finish(null);
      }
    });
  }
  if (process.platform === 'linux') {
    try {
      const [bootIdRaw, raw] = await Promise.all([
        fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
        fs.readFile(`/proc/${pid}/stat`, 'utf8')
      ]);
      const bootId = bootIdRaw.trim();
      const tail = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
      const startTicks = tail[19];
      return bootId && startTicks ? `linux:${bootId}:${startTicks}` : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }
  }
  if (process.platform === 'darwin') {
    const started = await psProcessIdentity(pid);
    return started ? `darwin:${started}` : null;
  }
  return null;
}

let ownProcessIdentityPromise: Promise<string | null> | null = null;

function cachedProcessStartIdentity(pid: number): Promise<string | null> {
  if (pid !== process.pid) return processStartIdentity(pid);
  ownProcessIdentityPromise ??= processStartIdentity(pid);
  return ownProcessIdentityPromise;
}

function parseOwnerRecord(raw: string): RuntimeOwnerRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<RuntimeOwnerRecord>;
    if (
      value.version !== 1 ||
      !Number.isInteger(value.pid) ||
      Number(value.pid) <= 0 ||
      typeof value.processIdentity !== 'string' ||
      value.processIdentity.length === 0 ||
      typeof value.nonce !== 'string' ||
      !/^[a-f0-9]{32}$/.test(value.nonce)
    ) return null;
    return value as RuntimeOwnerRecord;
  } catch {
    return null;
  }
}

export async function repairRuntimeControlOwnership(
  profileDir: string,
  dependencies: RuntimeOwnershipRepairDependencies = {}
): Promise<RuntimeOwnershipRepairResult> {
  await fs.mkdir(profileDir, { recursive: true });
  const recoveryPath = path.join(profileDir, OWNERSHIP_RECOVERY_FILE);
  const ownerPath = ownershipOwnerPath(profileDir);
  const identityOf = dependencies.processIdentity ?? cachedProcessStartIdentity;
  const accepting = dependencies.endpointAccepting ?? endpointAccepting;
  if (await accepting(runtimeControlEndpoint(profileDir))) {
    throw new Error('ComGu ownership repair refused because the control endpoint is still accepting connections');
  }
  const recoveryRaw = await fs.readFile(recoveryPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (recoveryRaw === null) return { repaired: false, detail: 'No stale ownership recovery marker exists.' };
  const recovery = parseOwnerRecord(recoveryRaw);
  if (!recovery) throw new Error('ComGu ownership recovery marker is malformed; refusing automatic repair');
  if (await identityOf(recovery.pid) === recovery.processIdentity) {
    throw new Error('ComGu ownership repair refused because the recovery contender is still active');
  }
  const ownerRaw = await fs.readFile(ownerPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (ownerRaw !== null) {
    const owner = parseOwnerRecord(ownerRaw);
    if (!owner) throw new Error('ComGu profile ownership record is malformed; refusing ownership repair');
    if (await identityOf(owner.pid) === owner.processIdentity) {
      throw new Error('ComGu ownership repair refused because the profile owner is still active');
    }
    const currentOwner = parseOwnerRecord(await fs.readFile(ownerPath, 'utf8'));
    if (!currentOwner || currentOwner.nonce !== owner.nonce) {
      throw new Error('ComGu ownership repair refused because the owner generation changed during verification');
    }
  }
  const currentRecovery = parseOwnerRecord(await fs.readFile(recoveryPath, 'utf8'));
  if (!currentRecovery || currentRecovery.nonce !== recovery.nonce) {
    throw new Error('ComGu ownership repair refused because the recovery generation changed during verification');
  }
  await fs.rm(recoveryPath);
  return { repaired: true, detail: 'Removed a verified stale ownership recovery marker.' };
}

async function publishOwnerRecord(
  profileDir: string,
  ownerPath: string,
  record: RuntimeOwnerRecord
): Promise<boolean> {
  const temp = path.join(profileDir, `.comgu-control.owner-${record.nonce}.tmp`);
  try {
    await fs.writeFile(temp, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      // The hard-link publication is atomic: the visible owner path never exists with partial
      // or empty contents, so there is no mkdir -> marker publication gap to age out.
      await fs.link(temp, ownerPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

async function ownerStillMatches(ownerPath: string, expected: RuntimeOwnerRecord): Promise<boolean> {
  try {
    const current = parseOwnerRecord(await fs.readFile(ownerPath, 'utf8'));
    return Boolean(current && current.nonce === expected.nonce);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function acquireRecoveryElection(profileDir: string, contender: RuntimeOwnerRecord): Promise<() => Promise<void>> {
  const recovery = path.join(profileDir, OWNERSHIP_RECOVERY_FILE);
  if (!(await publishOwnerRecord(profileDir, recovery, contender))) {
    // Ordinary startup stays fail-closed. The first-class doctor repair performs the stronger
    // endpoint + process-identity + generation checks needed to remove a crashed election.
    throw new Error('ComGu profile ownership recovery is already in progress; run `comgu doctor --repair-ownership` after verifying no ComGu runtime is active');
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const current = await fs.readFile(recovery, 'utf8').catch(() => '');
    const parsed = parseOwnerRecord(current);
    if (parsed?.nonce === contender.nonce) await fs.rm(recovery, { force: true }).catch(() => undefined);
  };
}

/**
 * Acquires the frontend-independent runtime owner lease for one profile.
 *
 * The visible owner record is published atomically as a hard link to a complete generation.
 * Stale cleanup is serialized by a separate fail-closed recovery election, and liveness is
 * keyed by both pid and process-start identity so pid reuse cannot impersonate the old owner.
 */
export async function acquireRuntimeControlOwnershipGate(
  profileDir: string,
  timeoutMs = 2_000,
  dependencies: RuntimeOwnershipDependencies = {}
): Promise<() => Promise<void>> {
  await fs.mkdir(profileDir, { recursive: true });
  const ownerPath = ownershipOwnerPath(profileDir);
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const pid = dependencies.pid ?? process.pid;
  const identityOf = dependencies.processIdentity ?? cachedProcessStartIdentity;
  const ownIdentity = await identityOf(pid);
  if (!ownIdentity) throw new Error('ComGu could not establish a stable process identity for profile ownership');
  const contender: RuntimeOwnerRecord = {
    version: 1,
    pid,
    processIdentity: ownIdentity,
    nonce: randomBytes(16).toString('hex')
  };

  for (;;) {
    if (await publishOwnerRecord(profileDir, ownerPath, contender)) {
      await dependencies.afterClaimPublished?.();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        if (await ownerStillMatches(ownerPath, contender)) {
          await fs.rm(ownerPath, { force: true }).catch(() => undefined);
        }
      };
    }

    let observed: RuntimeOwnerRecord | null = null;
    try {
      observed = parseOwnerRecord(await fs.readFile(ownerPath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!observed) throw new Error('ComGu profile ownership record is malformed; refusing automatic recovery');
    const liveIdentity = await identityOf(observed.pid);
    if (liveIdentity === observed.processIdentity) throw new Error('This ComGu profile already has an owner');

    const releaseRecovery = await acquireRecoveryElection(profileDir, contender);
    try {
      // Re-read under the recovery election. Another contender may have completed recovery
      // before we won this election; never delete a generation we did not actually inspect.
      const currentRaw = await fs.readFile(ownerPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (currentRaw === null) continue;
      const current = parseOwnerRecord(currentRaw);
      if (!current) throw new Error('ComGu profile ownership record is malformed; refusing automatic recovery');
      if (current.nonce !== observed.nonce) continue;
      const currentIdentity = await identityOf(current.pid);
      if (currentIdentity === current.processIdentity) throw new Error('This ComGu profile already has an owner');
      await fs.rm(ownerPath, { force: true });
      await dependencies.afterStaleOwnerRemoved?.();
    } finally {
      await releaseRecovery();
    }
    if (Date.now() >= deadline) throw new Error('ComGu profile ownership acquisition is busy');
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
      let acquiredOwnership: (() => Promise<void>) | null = await acquireRuntimeControlOwnershipGate(options.profileDir);
      try {
        const token = await ensureToken(authPath);
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
        }
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
