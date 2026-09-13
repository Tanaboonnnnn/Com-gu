import os from 'node:os';
import path from 'node:path';
import { resolveCompatibleUserDataPath } from '../main/migration.js';

/** Matches Electron's ComGu userData location without importing Electron. */
export function defaultComGuProfileDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string {
  const appDataDir = platform === 'win32'
    ? (env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    : platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : (env.XDG_CONFIG_HOME || path.join(home, '.config'));
  const current = path.join(appDataDir, 'ComGu');
  return resolveCompatibleUserDataPath({ appDataDir, defaultUserDataDir: current });
}
