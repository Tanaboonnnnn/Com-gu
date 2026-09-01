import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('exposes launch-at-login as a dedicated OS-owned IPC setting rather than config', async () => {
  const ipc = await fs.readFile(path.join(process.cwd(), 'src', 'main', 'ipc.ts'), 'utf8');
  const preload = await fs.readFile(path.join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8');

  expect(ipc).toContain("handle('startup:get'");
  expect(ipc).toContain("handle('startup:set'");
  expect(ipc).toContain('launchAtLoginState()');
  expect(ipc).toContain('setLaunchAtLogin(enabled)');
  expect(preload).toContain("getLaunchAtLogin: () => call<LaunchAtLoginState>('startup:get')");
  expect(preload).toContain("setLaunchAtLogin: (enabled: boolean) => call<LaunchAtLoginState>('startup:set', { enabled })");

  // Launch-at-login is OS state, not part of the ordinary Config/settings snapshot.
  expect(ipc).not.toMatch(/settingsPatch[\s\S]{0,1400}launchAtLogin/);
});
