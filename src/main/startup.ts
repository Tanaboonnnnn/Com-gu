import { app } from 'electron';
import type { LaunchAtLoginState } from '../shared/types.js';

function supported(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

/**
 * Reads the operating system's current login-item registration.
 *
 * This state intentionally does not live in config.json: the OS is authoritative and can
 * change it outside ComGu (Task Manager/Login Items, policy, uninstall/reinstall, etc.).
 */
export function launchAtLoginState(platform: NodeJS.Platform = process.platform): LaunchAtLoginState {
  if (!supported(platform)) return { supported: false, enabled: false };
  const state = app.getLoginItemSettings();
  return { supported: true, enabled: state.openAtLogin === true };
}

/** Writes launch-at-login through Electron, then re-reads the OS-owned state. */
export function setLaunchAtLogin(
  enabled: boolean,
  platform: NodeJS.Platform = process.platform
): LaunchAtLoginState {
  if (!supported(platform)) return { supported: false, enabled: false };
  app.setLoginItemSettings({ openAtLogin: enabled });
  return launchAtLoginState(platform);
}
