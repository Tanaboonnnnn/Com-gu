import { accessSync, constants, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchCommand } from './exec.js';
import type { BrowserFamily, BrowserPreference } from '../shared/types.js';

export interface BrowserCandidate {
  family: BrowserFamily;
  executable: string;
}

type Exists = (candidate: string) => boolean;
type Launch = typeof launchCommand;

export interface BrowserResolveOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  preference?: BrowserPreference;
  /** Proven browser family of the prime ChatGPT conversation. Required for `prime` affinity. */
  primeFamily?: BrowserFamily | null;
}

export interface PreferredBrowserOpenOptions extends BrowserResolveOptions {
  /** Test seam and alternate host probe; defaults to executable-file validation. */
  usable?: Exists;
  /** Test seam for launch failure/retry ordering. */
  launch?: Launch;
}

function isExecutableBrowser(candidate: string, platform: NodeJS.Platform): boolean {
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return false;
    if (platform !== 'win32') accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidate(family: BrowserFamily, executable: string | undefined | false): BrowserCandidate[] {
  return executable ? [{ family, executable }] : [];
}

/** Known Chromium-family browser installs. No renderer-provided executable path is accepted. */
export function browserCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = env.HOME ?? env.USERPROFILE ?? os.homedir()
): BrowserCandidate[] {
  if (platform === 'win32') {
    const p = path.win32;
    const roots = [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(
      (value): value is string => Boolean(value)
    );
    const out: BrowserCandidate[] = [];
    for (const root of roots) {
      out.push(...candidate('chrome', p.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')));
      out.push(...candidate('chromium', p.join(root, 'Chromium', 'Application', 'chrome.exe')));
      out.push(...candidate('brave', p.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')));
      out.push(...candidate('edge', p.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')));
    }
    return out;
  }

  if (platform === 'darwin') {
    const apps: ReadonlyArray<readonly [BrowserFamily, string, string]> = [
      ['chrome', 'Google Chrome.app', 'Google Chrome'],
      ['chrome', 'Google Chrome Beta.app', 'Google Chrome Beta'],
      ['chrome', 'Google Chrome Dev.app', 'Google Chrome Dev'],
      ['chrome', 'Google Chrome Canary.app', 'Google Chrome Canary'],
      ['brave', 'Brave Browser.app', 'Brave Browser'],
      ['brave', 'Brave Browser Beta.app', 'Brave Browser Beta'],
      ['brave', 'Brave Browser Nightly.app', 'Brave Browser Nightly'],
      ['edge', 'Microsoft Edge.app', 'Microsoft Edge'],
      ['edge', 'Microsoft Edge Beta.app', 'Microsoft Edge Beta'],
      ['edge', 'Microsoft Edge Dev.app', 'Microsoft Edge Dev'],
      ['chromium', 'Chromium.app', 'Chromium']
    ];
    return apps.flatMap(([family, bundle, executable]) => [
      { family, executable: path.posix.join('/Applications', bundle, 'Contents', 'MacOS', executable) },
      ...(home
        ? [{ family, executable: path.posix.join(home, 'Applications', bundle, 'Contents', 'MacOS', executable) }]
        : [])
    ]);
  }

  if (platform === 'linux') {
    const pathValue = env.PATH ?? '';
    const names: ReadonlyArray<readonly [BrowserFamily, string]> = [
      ['chrome', 'google-chrome'],
      ['chrome', 'google-chrome-stable'],
      ['chrome', 'google-chrome-beta'],
      ['chrome', 'google-chrome-unstable'],
      ['brave', 'brave-browser'],
      ['brave', 'brave-browser-stable'],
      ['brave', 'brave-browser-beta'],
      ['brave', 'brave-browser-nightly'],
      ['edge', 'microsoft-edge'],
      ['edge', 'microsoft-edge-stable'],
      ['edge', 'microsoft-edge-beta'],
      ['edge', 'microsoft-edge-dev'],
      ['chromium', 'chromium'],
      ['chromium', 'chromium-browser']
    ];
    const fromPath = pathValue
      .split(':')
      .filter(Boolean)
      .flatMap((dir) => names.map(([family, name]) => ({ family, executable: path.posix.join(dir, name) })));
    const userFlatpak = home ? path.posix.join(home, '.local', 'share', 'flatpak', 'exports', 'bin') : '';
    const fixed: BrowserCandidate[] = [
      { family: 'chrome', executable: '/opt/google/chrome/google-chrome' },
      { family: 'chrome', executable: '/opt/google/chrome-beta/google-chrome-beta' },
      { family: 'chrome', executable: '/opt/google/chrome-unstable/google-chrome-unstable' },
      { family: 'brave', executable: '/opt/brave.com/brave/brave-browser' },
      { family: 'chromium', executable: '/snap/bin/chromium' },
      ...(userFlatpak
        ? [
            { family: 'chrome' as const, executable: path.posix.join(userFlatpak, 'com.google.Chrome') },
            { family: 'chrome' as const, executable: path.posix.join(userFlatpak, 'com.google.ChromeDev') },
            { family: 'brave' as const, executable: path.posix.join(userFlatpak, 'com.brave.Browser') },
            { family: 'edge' as const, executable: path.posix.join(userFlatpak, 'com.microsoft.Edge') },
            { family: 'chromium' as const, executable: path.posix.join(userFlatpak, 'org.chromium.Chromium') }
          ]
        : []),
      { family: 'chrome', executable: '/var/lib/flatpak/exports/bin/com.google.Chrome' },
      { family: 'chrome', executable: '/var/lib/flatpak/exports/bin/com.google.ChromeDev' },
      { family: 'brave', executable: '/var/lib/flatpak/exports/bin/com.brave.Browser' },
      { family: 'edge', executable: '/var/lib/flatpak/exports/bin/com.microsoft.Edge' },
      { family: 'chromium', executable: '/var/lib/flatpak/exports/bin/org.chromium.Chromium' }
    ];
    return [...fromPath, ...fixed];
  }

  return [];
}

/** Backward-compatible path-only projection used by existing probes/tests. */
export function preferredBrowserCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = env.HOME ?? env.USERPROFILE ?? os.homedir()
): string[] {
  const all = browserCandidates(platform, env, home);
  const familyOrder: BrowserFamily[] = ['chrome', 'chromium', 'brave', 'edge'];
  return familyOrder.flatMap((family) =>
    all.filter((item) => item.family === family).map((item) => item.executable)
  );
}

/**
 * Resolve only candidates compatible with the requested browser affinity.
 * `prime` is intentionally fail-closed until the caller supplies proven prime-family evidence.
 */
export function resolveBrowserCandidates(options: BrowserResolveOptions = {}): BrowserCandidate[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? env.HOME ?? env.USERPROFILE ?? os.homedir();
  const preference = options.preference;
  if (preference === 'prime' && !options.primeFamily) return [];
  const family = preference === 'prime' ? options.primeFamily : preference;
  const all = browserCandidates(platform, env, home);
  return family ? all.filter((item) => item.family === family) : all;
}

export function findPreferredBrowser(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
  exists: Exists = (candidate) => isExecutableBrowser(candidate, platform)
): string | null {
  for (const item of browserCandidates(platform, env, home)) {
    if (exists(item.executable)) return item.executable;
  }
  return null;
}

/** Opens an orchestration URL without crossing a requested browser-family boundary. */
export async function openInPreferredBrowser(
  url: string,
  options: PreferredBrowserOpenOptions = {}
): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const usable = options.usable ?? ((candidatePath: string) => isExecutableBrowser(candidatePath, platform));
  const launch = options.launch ?? launchCommand;
  let lastError: unknown = null;

  for (const item of resolveBrowserCandidates(options)) {
    const browser = item.executable;
    if (!usable(browser)) continue;
    try {
      await launch(browser, [url], path.dirname(browser));
      return browser;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return null;
}
