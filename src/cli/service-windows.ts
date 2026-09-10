import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ServiceAction } from './service-linux.js';

const execFileAsync = promisify(execFile);
const TASK_NAME = 'ComGu';

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderWindowsTaskXml(options: { executable: string; profileDir: string; userId: string }): string {
  const args = `start --profile &quot;${xml(options.profileDir)}&quot;`;
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <Triggers>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    `      <UserId>${xml(options.userId)}</UserId>`,
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    `      <UserId>${xml(options.userId)}</UserId>`,
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <Hidden>true</Hidden>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${xml(options.executable)}</Command>`,
    `      <Arguments>${args}</Arguments>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    ''
  ].join('\r\n');
}

async function schtasks(args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('schtasks.exe', args, {
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 256 * 1024
    });
    return result.stdout.trim();
  } catch {
    throw new Error(`Windows Task Scheduler command failed: ${args[0] ?? 'unknown'}`);
  }
}

async function currentUserSid(): Promise<string> {
  try {
    const result = await execFileAsync('whoami.exe', ['/user'], { windowsHide: true, timeout: 5_000 });
    const sid = result.stdout.match(/S-1-[0-9-]+/)?.[0];
    if (sid) return sid;
  } catch {
    // Classified below without echoing account-specific output.
  }
  throw new Error('Could not determine the current Windows user SID');
}

export async function runWindowsServiceAction(
  action: ServiceAction,
  options: { executable: string; profileDir: string; userId?: string }
): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Windows Task Scheduler services are available on Windows only');
  switch (action) {
    case 'install': { 
      const userId = options.userId ?? (await currentUserSid());
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-task-'));
      const file = path.join(tempDir, 'comgu-task.xml');
      try {
        await fs.writeFile(file, renderWindowsTaskXml({ ...options, userId }), 'utf16le');
        await schtasks(['/Create', '/TN', TASK_NAME, '/XML', file, '/F']);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
      return `Installed ${TASK_NAME}`;
    }
    case 'start':
      await schtasks(['/Run', '/TN', TASK_NAME]);
      return 'started';
    case 'stop':
      await schtasks(['/End', '/TN', TASK_NAME]);
      return 'stopped';
    case 'restart':
      await schtasks(['/End', '/TN', TASK_NAME]).catch(() => '');
      await schtasks(['/Run', '/TN', TASK_NAME]);
      return 'restarted';
    case 'status':
      return schtasks(['/Query', '/TN', TASK_NAME, '/FO', 'LIST']);
  }
}
