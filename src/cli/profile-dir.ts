import os from 'node:os';
import path from 'node:path';

/** Matches Electron's ComGu userData location without importing Electron. */
export function defaultComGuProfileDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string {
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'ComGu');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'ComGu');
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(configHome, 'ComGu');
}
