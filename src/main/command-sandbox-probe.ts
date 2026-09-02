/**
 * Packaged-release security probe.
 *
 * This entrypoint is built from the same command-sandbox module as production and invoked only
 * by release smoke under ELECTRON_RUN_AS_NODE. It accepts paths created by the release script,
 * never by the app or renderer, and exits non-zero if the packaged sandbox can touch the outside
 * canary. Keeping this in src/main makes the release gate exercise the code that actually ships.
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSandboxedCommand } from './run/command-sandbox.js';

async function main(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('command-sandbox-probe is Windows-only');
  const [allowed, outsideSecret, outsideWrite] = process.argv.slice(2);
  if (!allowed || !outsideSecret || !outsideWrite) {
    throw new Error('usage: command-sandbox-probe <allowed-dir> <outside-secret> <outside-write>');
  }

  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  if (!existsSync(powershell)) throw new Error(`PowerShell not found at ${powershell}`);
  const insideWrite = path.join(allowed, 'inside-ok.txt');
  const script = [
    `$ErrorActionPreference = 'Continue'`,
    `Set-Content -LiteralPath ${JSON.stringify(insideWrite)} -Value 'inside-ok'`,
    `$outside = Get-Content -Raw -LiteralPath ${JSON.stringify(outsideSecret)} -ErrorAction SilentlyContinue`,
    `if ($outside) { Write-Output ('OUTSIDE_READ=' + $outside) }`,
    `Set-Content -LiteralPath ${JSON.stringify(outsideWrite)} -Value 'escaped' -ErrorAction SilentlyContinue`,
    `Write-Output 'PROBE_DONE'`
  ].join('; ');

  const child = await spawnSandboxedCommand({
    command: [powershell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    roots: [allowed],
    cwd: allowed,
    env: process.env,
    tty: false
  });
  if (child.kind !== 'child') throw new Error('packaged command sandbox probe expected pipe mode');

  let output = '';
  child.process.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.process.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.process.once('error', reject);
    child.process.once('close', resolve);
  });
  if (exitCode !== 0) throw new Error(`packaged sandbox child exited ${exitCode}: ${output}`);
  if (!output.includes('PROBE_DONE')) throw new Error(`packaged sandbox did not finish: ${output}`);
  if (output.includes('OUTSIDE_READ=outside-secret')) throw new Error('packaged sandbox read outside WorkspaceScope');
  await fs.access(insideWrite);
  if (existsSync(outsideWrite)) throw new Error('packaged sandbox wrote outside WorkspaceScope');
  process.stdout.write('packaged-command-sandbox-denied\n');
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
