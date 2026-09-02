import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UnifiedExecProcessManager } from '../src/main/codex/unified-exec.js';
import { DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS } from '../src/main/codex/unified-exec-constants.js';
import { findPowerShell } from '../src/main/exec.js';
import { spawnSandboxedCommand } from '../src/main/run/command-sandbox.js';

const created: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
});

describe.skipIf(process.platform !== 'win32')('Windows command WorkspaceScope confinement', () => {
  it('allows workspace IO but denies a child process reading or writing an outside canary', async () => {
    const allowed = await tempDir('comgu-scope-');
    const outside = await tempDir('comgu-outside-');
    const outsideSecret = path.join(outside, 'secret.txt');
    const outsideWrite = path.join(outside, 'escaped.txt');
    await fs.writeFile(outsideSecret, 'outside-secret', 'utf8');
    const shell = findPowerShell();
    expect(shell).toBeTruthy();

    const script = [
      `$ErrorActionPreference = 'Continue'`,
      `Set-Content -LiteralPath ${JSON.stringify(path.join(allowed, 'inside.txt'))} -Value 'inside-ok'`,
      `$read = Get-Content -Raw -LiteralPath ${JSON.stringify(outsideSecret)} -ErrorAction SilentlyContinue`,
      `Set-Content -LiteralPath ${JSON.stringify(outsideWrite)} -Value 'escape' -ErrorAction SilentlyContinue`,
      `if ($read) { Write-Output ('OUTSIDE_READ=' + $read) }`,
      `Write-Output 'DONE'`
    ].join('; ');

    const child = await spawnSandboxedCommand({
      command: [shell!, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      cwd: allowed,
      roots: [allowed],
      env: process.env,
      tty: false
    });
    expect(child.kind).toBe('child');
    if (child.kind !== 'child') throw new Error('expected pipe child');

    let stdout = '';
    let stderr = '';
    child.process.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.process.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.process.once('error', reject);
      child.process.once('close', resolve);
    });

    expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
    expect(stdout).toContain('DONE');
    expect(stdout).not.toContain('OUTSIDE_READ=outside-secret');
    expect(stderr).not.toContain('outside-secret');
    await expect(fs.readFile(path.join(allowed, 'inside.txt'), 'utf8')).resolves.toContain('inside-ok');
    await expect(fs.stat(outsideWrite)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(outsideSecret, 'utf8')).resolves.toBe('outside-secret');
  }, 30_000);

  it('routes the unified exec process manager through the same OS sandbox when a Run scope is supplied', async () => {
    const allowed = await tempDir('comgu-manager-scope-');
    const outside = await tempDir('comgu-manager-outside-');
    const outsideSecret = path.join(outside, 'manager-secret.txt');
    await fs.writeFile(outsideSecret, 'manager-outside-secret', 'utf8');
    const shell = findPowerShell();
    expect(shell).toBeTruthy();
    const manager = new UnifiedExecProcessManager(DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS);
    const processId = manager.allocateProcessId();

    try {
      const output = await manager.execCommand({
        command: [
          shell!,
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$v = Get-Content -Raw -LiteralPath ${JSON.stringify(outsideSecret)} -ErrorAction SilentlyContinue; if ($v) { Write-Output ('ESCAPED=' + $v) } else { Write-Output 'DENIED' }`
        ],
        shellType: 'powershell',
        hookCommand: 'sandbox manager regression',
        processId,
        yieldTimeMs: 2_000,
        maxOutputTokens: 2_000,
        truncationPolicy: { kind: 'tokens', tokens: 2_000 },
        cwd: allowed,
        displayCwd: '/scope',
        env: process.env,
        tty: false,
        sandbox: {
          roots: [allowed],
          authority: {
            conversationId: 'conv-scope',
            runId: 'run-scope',
            scopeFingerprint: 'scope-fingerprint'
          }
        }
      } as Parameters<typeof manager.execCommand>[0] & {
        sandbox: {
          roots: string[];
          authority: { conversationId: string; runId: string; scopeFingerprint: string };
        };
      });

      let rawOutput = output.rawOutput.toString('utf8');
      let liveProcessId = output.processId;
      // MXC startup can legitimately outlive the initial 2 s exec yield on a loaded Windows
      // host. Follow the same live session instead of mistaking "still running" for a failed
      // confinement proof. Polling stays bounded and presents the exact Run/scope authority on
      // every continuation, which also exercises the stale-session fence.
      for (let poll = 0; poll < 3 && liveProcessId !== null && !rawOutput.includes('DENIED'); poll += 1) {
        const polled = await manager.writeStdin({
          processId: liveProcessId,
          input: '',
          yieldTimeMs: 5_000,
          maxWriteStdinYieldTimeMs: 5_000,
          maxOutputTokens: 2_000,
          truncationPolicy: { kind: 'tokens', tokens: 2_000 },
          authority: {
            conversationId: 'conv-scope',
            runId: 'run-scope',
            scopeFingerprint: 'scope-fingerprint'
          }
        });
        rawOutput += polled.rawOutput.toString('utf8');
        liveProcessId = polled.processId;
      }

      expect(rawOutput).toContain('DENIED');
      expect(rawOutput).not.toContain('ESCAPED=manager-outside-secret');
    } finally {
      await manager.terminateAllProcesses();
    }
  }, 30_000);

  it('terminates a live sandbox session when write_stdin presents a different Run or scope fingerprint', async () => {
    const allowed = await tempDir('comgu-stale-scope-');
    const shell = findPowerShell();
    expect(shell).toBeTruthy();
    const manager = new UnifiedExecProcessManager(DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS);
    const processId = manager.allocateProcessId();
    const authority = {
      conversationId: 'conv-stale',
      runId: 'run-original',
      scopeFingerprint: 'fingerprint-original'
    };

    try {
      const started = await manager.execCommand({
        command: [
          shell!,
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Write-Output 'READY'; while ($true) { Start-Sleep -Milliseconds 200 }`
        ],
        shellType: 'powershell',
        hookCommand: 'stale sandbox session',
        processId,
        yieldTimeMs: 500,
        maxOutputTokens: 2_000,
        truncationPolicy: { kind: 'tokens', tokens: 2_000 },
        cwd: allowed,
        displayCwd: '/scope',
        env: process.env,
        tty: true,
        sandbox: { roots: [allowed], authority }
      });
      expect(started.processId).toBe(processId);

      await expect(
        manager.writeStdin({
          processId,
          input: '',
          yieldTimeMs: 100,
          maxOutputTokens: 2_000,
          truncationPolicy: { kind: 'tokens', tokens: 2_000 },
          authority: { ...authority, runId: 'run-replaced' }
        } as Parameters<typeof manager.writeStdin>[0] & { authority: typeof authority })
      ).rejects.toThrow('WORKSPACE_SESSION_STALE');
      expect(manager.listProcesses()).toEqual([]);
    } finally {
      await manager.terminateAllProcesses();
    }
  }, 30_000);

  it('terminates a pre-Run unrestricted session when write_stdin later presents Run authority', async () => {
    const allowed = await tempDir('comgu-pre-run-');
    const shell = findPowerShell();
    expect(shell).toBeTruthy();
    const manager = new UnifiedExecProcessManager(DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS);
    const processId = manager.allocateProcessId();

    try {
      const started = await manager.execCommand({
        command: [
          shell!,
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Write-Output 'READY'; while ($true) { Start-Sleep -Milliseconds 200 }`
        ],
        shellType: 'powershell',
        hookCommand: 'pre-run unrestricted session',
        processId,
        yieldTimeMs: 500,
        maxOutputTokens: 2_000,
        truncationPolicy: { kind: 'tokens', tokens: 2_000 },
        cwd: allowed,
        displayCwd: '/scope',
        env: process.env,
        tty: true
      });
      expect(started.processId).toBe(processId);

      await expect(
        manager.writeStdin({
          processId,
          input: '',
          yieldTimeMs: 100,
          maxOutputTokens: 2_000,
          truncationPolicy: { kind: 'tokens', tokens: 2_000 },
          authority: {
            conversationId: 'conv-now-in-run',
            runId: 'run-now-active',
            scopeFingerprint: 'scope-now-active'
          }
        })
      ).rejects.toThrow('WORKSPACE_SESSION_STALE');
      expect(manager.listProcesses()).toEqual([]);
    } finally {
      await manager.terminateAllProcesses();
    }
  }, 30_000);

  it('confines nested child processes, environment expansion, redirection, and junction targets', async () => {
    const allowed = await tempDir('comgu-tree-scope-');
    const outside = await tempDir('comgu-tree-outside-');
    const outsideSecret = path.join(outside, 'tree-secret.txt');
    const outsideWrite = path.join(outside, 'redirect-escape.txt');
    const junction = path.join(allowed, 'outside-link');
    await fs.writeFile(outsideSecret, 'tree-outside-secret', 'utf8');
    await fs.symlink(outside, junction, 'junction');
    const shell = findPowerShell();
    expect(shell).toBeTruthy();

    const script = [
      `$child = & $env:ComSpec /d /c type $env:COMGU_OUTSIDE_SECRET 2>$null`,
      `if ($child) { Write-Output ('CHILD_ESCAPED=' + $child) }`,
      `& $env:ComSpec /d /c ('echo ESCAPE > "' + $env:COMGU_OUTSIDE_WRITE + '"') 2>$null`,
      `$junctionRead = Get-Content -Raw -LiteralPath ${JSON.stringify(path.join(junction, 'tree-secret.txt'))} -ErrorAction SilentlyContinue`,
      `if ($junctionRead) { Write-Output ('JUNCTION_ESCAPED=' + $junctionRead) }`,
      `Write-Output 'TREE_DONE'`
    ].join('; ');

    const child = await spawnSandboxedCommand({
      command: [shell!, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      cwd: allowed,
      roots: [allowed],
      env: { ...process.env, COMGU_OUTSIDE_SECRET: outsideSecret, COMGU_OUTSIDE_WRITE: outsideWrite },
      tty: false
    });
    if (child.kind !== 'child') throw new Error('expected pipe child');
    let output = '';
    child.process.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.process.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    await new Promise<void>((resolve, reject) => {
      child.process.once('error', reject);
      child.process.once('close', () => resolve());
    });

    expect(output).toContain('TREE_DONE');
    expect(output).not.toContain('CHILD_ESCAPED=tree-outside-secret');
    expect(output).not.toContain('JUNCTION_ESCAPED=tree-outside-secret');
    await expect(fs.stat(outsideWrite)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(outsideSecret, 'utf8')).resolves.toBe('tree-outside-secret');
  }, 30_000);

  it('applies the same filesystem boundary to PTY sessions', async () => {
    const allowed = await tempDir('comgu-pty-scope-');
    const outside = await tempDir('comgu-pty-outside-');
    const outsideSecret = path.join(outside, 'pty-secret.txt');
    await fs.writeFile(outsideSecret, 'pty-outside-secret', 'utf8');
    const shell = findPowerShell();
    expect(shell).toBeTruthy();

    const pty = await spawnSandboxedCommand({
      command: [
        shell!,
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$v = Get-Content -Raw -LiteralPath ${JSON.stringify(outsideSecret)} -ErrorAction SilentlyContinue; if ($v) { Write-Output ('PTY_ESCAPED=' + $v) } else { Write-Output 'PTY_DENIED' }`
      ],
      cwd: allowed,
      roots: [allowed],
      env: process.env,
      tty: true
    });
    expect(pty.kind).toBe('pty');
    if (pty.kind !== 'pty') throw new Error('expected PTY process');
    let output = '';
    pty.process.onData((data) => (output += data));
    const exitCode = await new Promise<number>((resolve) => pty.process.onExit((event) => resolve(event.exitCode)));

    expect(exitCode).toBe(0);
    expect(output).toContain('PTY_DENIED');
    expect(output).not.toContain('PTY_ESCAPED=pty-outside-secret');
  }, 30_000);

  it('still permits common developer tools to execute against data inside the scope', async () => {
    const allowed = await tempDir('comgu-tool-scope-');
    await fs.writeFile(path.join(allowed, 'package.json'), '{"name":"sandbox-smoke","version":"1.0.0"}\n', 'utf8');
    const shell = process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe';

    const child = await spawnSandboxedCommand({
      command: [
        shell,
        '/d',
        '/s',
        '/c',
        `git --version && node --version && npm --version`
      ],
      cwd: allowed,
      roots: [allowed],
      env: process.env,
      tty: false
    });
    if (child.kind !== 'child') throw new Error('expected pipe child');
    let output = '';
    child.process.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.process.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.process.once('error', reject);
      child.process.once('close', resolve);
    });

    expect(exitCode, output).toBe(0);
    expect(output).toMatch(/git version/i);
    expect(output).toMatch(/v\d+\.\d+/);
    expect(output).toMatch(/\d+\.\d+\.\d+/);
  }, 30_000);
});
