import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (file: string) => fs.readFile(path.join(root, file), 'utf8');

describe('Setup startup and browser controls', () => {
  it('shows an OS launch-at-login control and wires it through the dedicated IPC API', async () => {
    const [html, renderer, preload] = await Promise.all([
      text('src/renderer/index.html'),
      text('src/renderer/main.ts'),
      text('src/preload/index.ts')
    ]);
    expect(html).toContain('id="launchAtLogin"');
    expect(html).toContain('data-i18n="setup.launchAtLogin"');
    expect(renderer).toContain('api.getLaunchAtLogin()');
    expect(renderer).toContain('api.setLaunchAtLogin(');
    expect(preload).toContain("getLaunchAtLogin: () => call<LaunchAtLoginState>('startup:get')");
    expect(preload).toContain("setLaunchAtLogin: (enabled: boolean) => call<LaunchAtLoginState>('startup:set'");
  });

  it('shows a bounded browser preference picker populated from main-process detection', async () => {
    const [html, renderer, preload, ipc] = await Promise.all([
      text('src/renderer/index.html'),
      text('src/renderer/main.ts'),
      text('src/preload/index.ts'),
      text('src/main/ipc.ts')
    ]);
    expect(html).toContain('id="browserPreference"');
    expect(html).toContain('data-i18n="setup.browserPreference"');
    expect(renderer).toContain('api.getBrowserFamilies()');
    expect(renderer).toContain("$<HTMLSelectElement>('browserPreference')");
    expect(preload).toContain("getBrowserFamilies: () => call<BrowserFamily[]>('browser:list')");
    expect(ipc).toContain("handle('browser:list'");
    expect(ipc).toContain('installedBrowserFamilies()');
  });

  it('persists browser preference through the same three-way config merge as the other settings', async () => {
    const [preload, ipc, renderer] = await Promise.all([
      text('src/preload/index.ts'),
      text('src/main/ipc.ts'),
      text('src/renderer/main.ts')
    ]);
    expect(preload).toContain("browser: Config['browser'];");
    expect(ipc).toContain("browser: z.object({ preference: z.enum(['prime', ...BROWSER_FAMILIES]) })");
    expect(ipc).toContain('browser: {');
    expect(ipc).toContain('current.browser.preference');
    expect(renderer).toContain("browser: { preference: $<HTMLSelectElement>('browserPreference').value");
    expect(renderer).toContain('browser: previous.browser');
  });
});
