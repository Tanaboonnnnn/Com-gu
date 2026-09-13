import { describe, expect, it, vi } from 'vitest';
import { renderLinuxUserUnit } from '../src/cli/service-linux.js';
import { renderWindowsTaskXml } from '../src/cli/service-windows.js';
import { runCli } from '../src/cli/index.js';

describe('CLI background service lifecycle', () => {
  it('renders a headless-safe systemd user unit with restart policy and no credentials', () => {
    const unit = renderLinuxUserUnit({ executable: '/opt/comgu/comgu', profileDir: '/home/alice/.config/ComGu' });
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).toContain('ExecStart=/opt/comgu/comgu start --profile /home/alice/.config/ComGu');
    expect(unit).not.toMatch(/graphical-session|DISPLAY=|WAYLAND_DISPLAY=/);
    expect(unit).not.toMatch(/API_KEY|TOKEN|PASSWORD|COMGU_CREDENTIAL_KEY/i);
  });

  it('renders a per-user Windows logon task that never uses Session 0 or stores a password', () => {
    const xml = renderWindowsTaskXml({
      executable: 'C:\\Program Files\\ComGu\\comgu.exe',
      profileDir: 'C:\\Users\\alice\\AppData\\Roaming\\ComGu',
      userId: 'S-1-5-21-1000'
    });
    expect(xml).toContain('<LogonTrigger>');
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(xml).toContain('<Hidden>true</Hidden>');
    expect(xml).toContain('<Command>C:\\Program Files\\ComGu\\comgu.exe</Command>');
    expect(xml).toContain('<Arguments>start --profile &quot;C:\\Users\\alice\\AppData\\Roaming\\ComGu&quot;</Arguments>');
    expect(xml).not.toMatch(/<Password>|API_KEY|COMGU_CREDENTIAL_KEY|openaiApiKey|bridgeToken/i);
  });

  it('routes service lifecycle actions without importing them for ordinary status commands', async () => {
    const serviceAction = vi.fn(async () => 'running');
    const stdout: string[] = [];
    const deps = {
      profileDir: 'profile',
      request: vi.fn(async () => null),
      startOwner: vi.fn(async () => undefined),
      serviceAction
    };
    const io = { writeOut: (text: string) => stdout.push(text), writeErr: vi.fn(), isTTY: false, columns: 80 };

    expect(await runCli(['service', 'status'], deps, io)).toBe(0);
    expect(serviceAction).toHaveBeenCalledWith('status');
    expect(stdout.join('')).toContain('running');
  });
});
