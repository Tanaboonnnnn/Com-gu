import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DesktopDriver } from '../driver.js';

const execFileAsync = promisify(execFile);

export interface LinuxDesktopProbeOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  commandExists?: (name: string) => Promise<boolean>;
  loadX11?: () => Promise<DesktopDriver>;
  loadWayland?: () => Promise<DesktopDriver>;
}

export type LinuxDesktopProbeResult =
  | { kind: 'headless'; driver: null; reason: string }
  | { kind: 'unavailable'; driver: null; reason: string }
  | { kind: 'x11' | 'wayland'; driver: DesktopDriver; reason: null };

async function commandExists(name: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'sh', process.platform === 'win32' ? [name] : ['-lc', `command -v -- ${name}`], {
      windowsHide: true,
      timeout: 2000,
      env: process.env
    });
    return true;
  } catch {
    return false;
  }
}

export async function probeLinuxDesktop(options: LinuxDesktopProbeOptions = {}): Promise<LinuxDesktopProbeResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') return { kind: 'unavailable', driver: null, reason: 'Linux Desktop is available on Linux only.' };
  const env = options.env ?? process.env;
  const exists = options.commandExists ?? commandExists;
  const session = (env.XDG_SESSION_TYPE ?? '').toLowerCase();
  const hasWayland = Boolean(env.WAYLAND_DISPLAY) || session === 'wayland';
  const hasX11 = Boolean(env.DISPLAY) || session === 'x11';
  if (!hasWayland && !hasX11) return { kind: 'headless', driver: null, reason: 'No graphical Linux session is available.' };

  if (hasWayland) {
    if (!(await exists('gdbus'))) {
      return { kind: 'unavailable', driver: null, reason: 'Linux Wayland Desktop requires gdbus and xdg-desktop-portal.' };
    }
    const load = options.loadWayland ?? (async () => {
      const [{ createWaylandDesktopDriver }, { createGdbusWaylandPortalSession }] = await Promise.all([
        import('./wayland.js'),
        import('./wayland-portal.js')
      ]);
      return createWaylandDesktopDriver(await createGdbusWaylandPortalSession(env));
    });
    try {
      return { kind: 'wayland', driver: await load(), reason: null };
    } catch (error) {
      return { kind: 'unavailable', driver: null, reason: error instanceof Error ? error.message : 'Wayland Desktop is unavailable.' };
    }
  }

  const missing: string[] = [];
  for (const dependency of ['xdotool', 'import']) if (!(await exists(dependency))) missing.push(dependency);
  if (missing.length > 0) return { kind: 'unavailable', driver: null, reason: `Linux X11 Desktop requires: ${missing.join(', ')}.` };
  const clipboard = (await exists('xclip')) ? 'xclip' : null;
  const load = options.loadX11 ?? (async () => {
    const { createX11DesktopDriver, createX11ProcessRunner } = await import('./x11.js');
    return createX11DesktopDriver({ commands: new Set(['xdotool', 'import', ...(clipboard ? [clipboard] : [])]), run: createX11ProcessRunner(env) });
  });
  return { kind: 'x11', driver: await load(), reason: null };
}
