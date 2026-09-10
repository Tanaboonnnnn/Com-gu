import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const UNIT_NAME = 'comgu.service';

export type ServiceAction = 'install' | 'start' | 'stop' | 'restart' | 'status';

function systemdQuote(value: string): string {
  return /[\s"\\]/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value;
}

export function renderLinuxUserUnit(options: { executable: string; profileDir: string }): string {
  return [
    '[Unit]',
    'Description=ComGu local MCP runtime',
    'After=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${systemdQuote(options.executable)} start --profile ${systemdQuote(options.profileDir)}`,
    'Restart=on-failure',
    'RestartSec=3',
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n');
}

async function systemctl(args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('systemctl', ['--user', ...args], {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 256 * 1024
    });
    return result.stdout.trim();
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    if (args[0] === 'is-active' && (code === 3 || code === '3')) return 'inactive';
    throw new Error(`systemd user service command failed: ${args.join(' ')}`);
  }
}

export async function runLinuxServiceAction(
  action: ServiceAction,
  options: { executable: string; profileDir: string; home?: string }
): Promise<string> {
  if (process.platform !== 'linux') throw new Error('systemd user services are available on Linux only');
  const home = options.home ?? os.homedir();
  const unitDir = path.join(home, '.config', 'systemd', 'user');
  const unitPath = path.join(unitDir, UNIT_NAME);

  switch (action) {
    case 'install':
      await fs.mkdir(unitDir, { recursive: true });
      await fs.writeFile(unitPath, renderLinuxUserUnit(options), { encoding: 'utf8', mode: 0o644 });
      await systemctl(['daemon-reload']);
      await systemctl(['enable', UNIT_NAME]);
      return `Installed ${UNIT_NAME}`;
    case 'start':
      await systemctl(['start', UNIT_NAME]);
      return 'started';
    case 'stop':
      await systemctl(['stop', UNIT_NAME]);
      return 'stopped';
    case 'restart':
      await systemctl(['restart', UNIT_NAME]);
      return 'restarted';
    case 'status':
      return (await systemctl(['is-active', UNIT_NAME])) || 'unknown';
  }
}
