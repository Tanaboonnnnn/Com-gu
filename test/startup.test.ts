import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLoginItemSettings = vi.fn();
const setLoginItemSettings = vi.fn();

vi.mock('electron', () => ({
  app: { getLoginItemSettings, setLoginItemSettings }
}));

const { launchAtLoginState, setLaunchAtLogin } = await import('../src/main/startup.js');

describe('OS launch-at-login state', () => {
  beforeEach(() => {
    getLoginItemSettings.mockReset();
    setLoginItemSettings.mockReset();
  });

  it('reads the current state from Electron instead of a config value', () => {
    getLoginItemSettings.mockReturnValue({ openAtLogin: true });
    expect(launchAtLoginState('win32')).toEqual({ supported: true, enabled: true });
    expect(getLoginItemSettings).toHaveBeenCalledTimes(1);
  });

  it('writes only through Electron login-item settings and reports the OS result', () => {
    getLoginItemSettings.mockReturnValue({ openAtLogin: false });
    expect(setLaunchAtLogin(true, 'win32')).toEqual({ supported: true, enabled: false });
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    expect(getLoginItemSettings).toHaveBeenCalledTimes(1);
  });

  it('does not invent persistence on unsupported hosts', () => {
    expect(launchAtLoginState('linux')).toEqual({ supported: false, enabled: false });
    expect(setLaunchAtLogin(true, 'linux')).toEqual({ supported: false, enabled: false });
    expect(getLoginItemSettings).not.toHaveBeenCalled();
    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });
});
