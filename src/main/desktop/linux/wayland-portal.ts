import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { WaylandPortalSession } from './wayland.js';

const PORTAL_DESTINATION = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const MAX_PORTAL_OUTPUT_BYTES = 256 * 1024;
const MAX_SCREENSHOT_BYTES = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

export interface PortalResponse {
  code: number;
  sessionHandle: string | null;
  devices: number | null;
  clipboardEnabled: boolean | null;
  stream: { id: number; width: number; height: number } | null;
  uri: string | null;
}

export interface PortalTransport {
  request(method: string, args: string[]): Promise<PortalResponse>;
  call(method: string, args: string[], objectPath?: string): Promise<string>;
  onSessionClosed(sessionPath: string, handler: () => void): () => void;
  readUri?(uri: string): Promise<Buffer>;
  close(): Promise<void>;
}

function quoted(value: string): string {
  if (!/^[A-Za-z0-9_./:-]*$/.test(value)) {
    throw new Error('Wayland portal value contains unsupported characters');
  }
  return `'${value}'`;
}

function token(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function requestOptions(handleToken: string, extra = ''): string {
  const suffix = extra ? `, ${extra}` : '';
  return `{'handle_token': <${quoted(handleToken)}>${suffix}}`;
}

export function parseGdbusRequestPath(output: string): string {
  const path = output.match(/objectpath\s+'([^']+)'/)?.[1];
  if (!path?.startsWith('/org/freedesktop/portal/desktop/request/')) {
    throw new Error('Wayland portal returned an invalid request handle');
  }
  return path;
}

/**
 * Parse only the bounded primitive facts ComGu needs from `gdbus monitor` output. This is not a
 * general GVariant parser and deliberately never evaluates portal-controlled text.
 */
export function parsePortalResponse(line: string): PortalResponse {
  const code = Number(line.match(/Request\.Response\s+\(uint32\s+(\d+)/)?.[1]);
  if (!Number.isInteger(code)) throw new Error('Wayland portal returned an invalid response');
  const sessionHandle = line.match(/'session_handle':\s*<(?:objectpath\s+)?'([^']+)'/)?.[1] ?? null;
  const devicesText = line.match(/'devices':\s*<uint32\s+(\d+)>/)?.[1];
  const clipboardText = line.match(/'clipboard_enabled':\s*<(true|false)>/)?.[1];
  const uri = line.match(/'uri':\s*<'([^']+)'>/)?.[1] ?? null;
  const streamMatch = line.match(
    /'streams':\s*<\[\(uint32\s+(\d+),\s*\{[\s\S]*?'size':\s*<\((\d+),\s*(\d+)\)>[\s\S]*?\}\)\]>/
  );
  return {
    code,
    sessionHandle,
    devices: devicesText === undefined ? null : Number(devicesText),
    clipboardEnabled: clipboardText === undefined ? null : clipboardText === 'true',
    stream: streamMatch
      ? { id: Number(streamMatch[1]), width: Number(streamMatch[2]), height: Number(streamMatch[3]) }
      : null,
    uri
  };
}

function evdevButton(button: 'left' | 'middle' | 'right'): number {
  if (button === 'left') return 272;
  if (button === 'right') return 273;
  return 274;
}

export async function createPortalWaylandSession(options: {
  transport: PortalTransport;
  screenshotSupported: boolean;
  screenshotTargetSupported?: boolean;
}): Promise<WaylandPortalSession> {
  const create = await options.transport.request(
    'org.freedesktop.portal.RemoteDesktop.CreateSession',
    [`{'handle_token': <${quoted(token('comgu_create'))}>, 'session_handle_token': <${quoted(token('comgu_session'))}>}`]
  );
  if (create.code !== 0 || !create.sessionHandle) throw new Error('Wayland remote desktop session was not created');
  const sessionHandle = create.sessionHandle;

  const selectedDevices = await options.transport.request(
    'org.freedesktop.portal.RemoteDesktop.SelectDevices',
    [sessionHandle, requestOptions(token('comgu_devices'), "'types': <uint32 3>")]
  );
  if (selectedDevices.code !== 0) throw new Error('Wayland remote desktop device selection was denied');

  const selectedSource = await options.transport.request(
    'org.freedesktop.portal.ScreenCast.SelectSources',
    [
      sessionHandle,
      requestOptions(
        token('comgu_source'),
        "'types': <uint32 1>, 'multiple': <false>, 'cursor_mode': <uint32 2>"
      )
    ]
  );
  if (selectedSource.code !== 0) throw new Error('Wayland screen source selection was denied');

  const started = await options.transport.request(
    'org.freedesktop.portal.RemoteDesktop.Start',
    [sessionHandle, "''", requestOptions(token('comgu_start'))]
  );
  if (started.code !== 0) throw new Error('Wayland remote desktop permission was denied');

  const devices = started.devices ?? 0;
  let active = true;
  const stream = started.stream;
  const stopClosedListener = options.transport.onSessionClosed(sessionHandle, () => {
    active = false;
  });

  const grants = () => ({
    active,
    capture: active && options.screenshotSupported,
    pointer: active && Boolean(devices & 2) && stream !== null,
    keyboard: active && Boolean(devices & 1),
    // The Clipboard portal transfers bytes over Unix file descriptors. The gdbus CLI transport
    // intentionally does not fake that contract with command output or temporary plaintext files.
    clipboardRead: false,
    clipboardWrite: false,
    width: stream?.width ?? 0,
    height: stream?.height ?? 0
  });

  const assertActive = (): void => {
    if (!active) throw new Error('Wayland portal session is closed or permission was revoked');
  };

  return {
    grants,
    async screenshot() {
      assertActive();
      if (!options.screenshotSupported || !options.transport.readUri) {
        throw new Error('Wayland screenshot portal is unavailable');
      }
      const response = await options.transport.request(
        'org.freedesktop.portal.Screenshot.Screenshot',
        [
          "''",
          requestOptions(
            token('comgu_screenshot'),
            options.screenshotTargetSupported
              ? "'interactive': <false>, 'modal': <false>, 'target': <uint32 1>"
              : "'interactive': <false>, 'modal': <false>"
          )
        ]
      );
      if (response.code !== 0 || !response.uri) throw new Error('Wayland screenshot permission was denied');
      return options.transport.readUri(response.uri);
    },
    async move(x, y) {
      assertActive();
      if (!stream || !(devices & 2)) throw new Error('Wayland pointer permission was not granted');
      await options.transport.call('org.freedesktop.portal.RemoteDesktop.NotifyPointerMotionAbsolute', [
        sessionHandle,
        '{}',
        String(stream.id),
        String(x),
        String(y)
      ]);
    },
    async button(button, pressed) {
      assertActive();
      if (!(devices & 2)) throw new Error('Wayland pointer permission was not granted');
      await options.transport.call('org.freedesktop.portal.RemoteDesktop.NotifyPointerButton', [
        sessionHandle,
        '{}',
        String(evdevButton(button)),
        pressed ? '1' : '0'
      ]);
    },
    async scroll(dx, dy) {
      assertActive();
      if (!(devices & 2)) throw new Error('Wayland pointer permission was not granted');
      await options.transport.call('org.freedesktop.portal.RemoteDesktop.NotifyPointerAxis', [
        sessionHandle,
        '{}',
        String(dx),
        String(dy)
      ]);
    },
    async keysym(keysym, pressed) {
      assertActive();
      if (!(devices & 1)) throw new Error('Wayland keyboard permission was not granted');
      await options.transport.call('org.freedesktop.portal.RemoteDesktop.NotifyKeyboardKeysym', [
        sessionHandle,
        '{}',
        String(keysym),
        pressed ? '1' : '0'
      ]);
    },
    async readClipboard() {
      throw new Error('Wayland clipboard is unavailable with the current portal transport');
    },
    async writeClipboard() {
      throw new Error('Wayland clipboard is unavailable with the current portal transport');
    },
    async close() {
      if (active) {
        active = false;
        await options.transport.call('org.freedesktop.portal.Session.Close', [], sessionHandle).catch(() => undefined);
      }
      stopClosedListener();
      await options.transport.close();
    }
  };
}

interface ResponseWaiter {
  resolve(response: PortalResponse): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export function createGdbusPortalTransport(env: NodeJS.ProcessEnv = process.env): PortalTransport {
  const waiters = new Map<string, ResponseWaiter>();
  const earlyResponses = new Map<string, PortalResponse>();
  const closedListeners = new Map<string, Set<() => void>>();
  let monitor: ReturnType<typeof spawn> | null = null;
  let readyPromise: Promise<void> | null = null;
  let monitorBuffer = '';

  const failWaiters = (message: string): void => {
    const error = new Error(message);
    for (const waiter of waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    waiters.clear();
  };

  const handleMonitorLine = (line: string): void => {
    const path = line.match(/^(\/org\/freedesktop\/portal\/desktop\/(?:request|session)\/[^:]+):/)?.[1];
    if (!path) return;
    if (line.includes('org.freedesktop.portal.Request.Response')) {
      let response: PortalResponse;
      try {
        response = parsePortalResponse(line);
      } catch {
        return;
      }
      const waiter = waiters.get(path);
      if (waiter) {
        waiters.delete(path);
        clearTimeout(waiter.timer);
        waiter.resolve(response);
      } else {
        earlyResponses.set(path, response);
      }
      return;
    }
    if (line.includes('org.freedesktop.portal.Session.Closed')) {
      for (const listener of closedListeners.get(path) ?? []) listener();
    }
  };

  const ensureMonitor = async (): Promise<void> => {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise<void>((resolve, reject) => {
      const child = spawn('gdbus', ['monitor', '--session', '--dest', PORTAL_DESTINATION], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env,
        windowsHide: true
      });
      monitor = child;
      let ready = false;
      const readyTimer = setTimeout(() => {
        if (!ready) reject(new Error('Wayland portal monitor did not become ready'));
      }, 3_000);
      readyTimer.unref?.();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (!ready) {
          ready = true;
          clearTimeout(readyTimer);
          resolve();
        }
        if (Buffer.byteLength(monitorBuffer, 'utf8') + Buffer.byteLength(chunk, 'utf8') > MAX_PORTAL_OUTPUT_BYTES) {
          child.kill();
          failWaiters('Wayland portal monitor output exceeded its safety bound');
          return;
        }
        monitorBuffer += chunk;
        let newline = monitorBuffer.indexOf('\n');
        while (newline !== -1) {
          handleMonitorLine(monitorBuffer.slice(0, newline).trim());
          monitorBuffer = monitorBuffer.slice(newline + 1);
          newline = monitorBuffer.indexOf('\n');
        }
      });
      child.once('error', () => {
        clearTimeout(readyTimer);
        if (!ready) reject(new Error('gdbus is unavailable'));
        failWaiters('Wayland portal monitor stopped unexpectedly');
      });
      child.once('close', () => {
        clearTimeout(readyTimer);
        if (!ready) reject(new Error('Wayland portal monitor stopped before becoming ready'));
        failWaiters('Wayland portal monitor stopped unexpectedly');
      });
    });
    return readyPromise;
  };

  const call = async (method: string, args: string[], objectPath = PORTAL_PATH): Promise<string> => {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'gdbus',
        ['call', '--session', '--dest', PORTAL_DESTINATION, '--object-path', objectPath, '--method', method, ...args],
        { stdio: ['ignore', 'pipe', 'ignore'], env, windowsHide: true }
      );
      const chunks: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const finish = (error?: Error, value = ''): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error('Wayland portal call timed out'));
      }, 15_000);
      timer.unref?.();
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_PORTAL_OUTPUT_BYTES) {
          child.kill();
          finish(new Error('Wayland portal call output exceeded its safety bound'));
          return;
        }
        chunks.push(chunk);
      });
      child.once('error', () => finish(new Error('gdbus is unavailable')));
      child.once('close', (code) => {
        if (code !== 0) finish(new Error(`Wayland portal call failed: ${method}`));
        else finish(undefined, Buffer.concat(chunks).toString('utf8').trim());
      });
    });
  };

  const waitForResponse = async (path: string): Promise<PortalResponse> => {
    const early = earlyResponses.get(path);
    if (early) {
      earlyResponses.delete(path);
      return early;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(path);
        reject(new Error('Wayland portal permission request timed out'));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      waiters.set(path, { resolve, reject, timer });
    });
  };

  return {
    async request(method, args) {
      await ensureMonitor();
      const requestPath = parseGdbusRequestPath(await call(method, args));
      return waitForResponse(requestPath);
    },
    call,
    onSessionClosed(sessionPath, handler) {
      let listeners = closedListeners.get(sessionPath);
      if (!listeners) {
        listeners = new Set();
        closedListeners.set(sessionPath, listeners);
      }
      listeners.add(handler);
      return () => {
        listeners?.delete(handler);
        if (listeners?.size === 0) closedListeners.delete(sessionPath);
      };
    },
    async readUri(uri) {
      const url = new URL(uri);
      if (url.protocol !== 'file:') throw new Error('Wayland screenshot portal returned a non-file URI');
      const file = fileURLToPath(url);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_SCREENSHOT_BYTES) {
        throw new Error('Wayland screenshot exceeded its safety bound');
      }
      return fs.readFile(file);
    },
    async close() {
      failWaiters('Wayland portal transport closed');
      earlyResponses.clear();
      closedListeners.clear();
      monitor?.kill();
      monitor = null;
      readyPromise = null;
    }
  };
}

function parsePortalVersion(output: string): number {
  const value = Number(output.match(/uint32\s+(\d+)/)?.[1]);
  return Number.isInteger(value) ? value : 0;
}

export async function createGdbusWaylandPortalSession(
  env: NodeJS.ProcessEnv = process.env
): Promise<WaylandPortalSession> {
  const transport = createGdbusPortalTransport(env);
  try {
    const [remoteDesktop, screenCast, screenshot] = await Promise.all([
      transport.call('org.freedesktop.DBus.Properties.Get', [quoted('org.freedesktop.portal.RemoteDesktop'), quoted('version')]),
      transport.call('org.freedesktop.DBus.Properties.Get', [quoted('org.freedesktop.portal.ScreenCast'), quoted('version')]),
      transport.call('org.freedesktop.DBus.Properties.Get', [quoted('org.freedesktop.portal.Screenshot'), quoted('version')]).catch(() => '')
    ]);
    if (parsePortalVersion(remoteDesktop) < 1 || parsePortalVersion(screenCast) < 1) {
      throw new Error('Wayland RemoteDesktop/ScreenCast portal is unavailable');
    }
    const screenshotVersion = parsePortalVersion(screenshot);
    return await createPortalWaylandSession({
      transport,
      screenshotSupported: screenshotVersion >= 1,
      screenshotTargetSupported: screenshotVersion >= 3
    });
  } catch (error) {
    await transport.close();
    throw error;
  }
}
