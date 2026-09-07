/**
 * Minimal parent environment inherited by any ComGu child process.
 *
 * The default is an allowlist, not a denylist: a terminal can hold arbitrary provider,
 * cloud, CI and package-manager credentials whose names this app cannot predict. Callers
 * that deliberately need a protocol credential add it through childEnv(overrides).
 */

const COMMON = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LANGUAGE',
  'TERM',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY'
]);

const WINDOWS = new Set([
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432'
]);

const POSIX_PREFIXES = ['LC_', 'XDG_'];

export function inheritedChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [rawKey, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const key = rawKey.toUpperCase();
    const allowed =
      COMMON.has(key) ||
      (platform === 'win32' && WINDOWS.has(key)) ||
      (platform !== 'win32' && POSIX_PREFIXES.some((prefix) => key.startsWith(prefix)));
    if (allowed) out[rawKey] = value;
  }
  return out;
}
