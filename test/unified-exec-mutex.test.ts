import { expect, it } from 'vitest';
import { UnifiedExecProcessManager, applyUnifiedExecEnv } from '../src/main/codex/unified-exec.js';
import { prefixPowershellScriptWithUtf8 } from '../src/main/codex/shell.js';
import { DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS } from '../src/main/codex/unified-exec-constants.js';

const truncationPolicy = { kind: 'tokens' as const, tokens: 10_000 };

it('repairs built-in PowerShell module discovery from the selected shell home', () => {
  const requested = "Start-Sleep -Milliseconds 10; Write-Output 'done'";
  // Keep this parser contract platform-neutral. The production command carries an absolute
  // Windows path on Windows, but node:path on POSIX deliberately does not parse backslashes as
  // separators; a bare recognised shell token exercises the same PowerShell-prefix branch on
  // every CI runner instead of making this pure test depend on the host path grammar.
  const command = ['powershell', '-NoProfile', '-Command', requested];

  const prepared = prefixPowershellScriptWithUtf8(command);
  const script = prepared.at(-1) ?? '';

  expect(script.indexOf('$PSHOME')).toBeGreaterThanOrEqual(0);
  expect(script.indexOf('PSModulePath')).toBeGreaterThanOrEqual(0);
  expect(script.indexOf('$PSHOME')).toBeLessThan(script.indexOf(requested));
  expect(script).not.toContain('$env:USERPROFILE');
});

it('does not let capacity pruning steal an interaction lock from an already queued waiter', async () => {
  const manager = new UnifiedExecProcessManager(DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS);
  const processId = manager.allocateProcessId();
  const initial = manager.execCommand({
    command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    shellType: process.platform === 'win32' ? 'powershell' : 'bash',
    hookCommand: 'mutex handoff probe',
    processId,
    yieldTimeMs: 30_000,
    maxOutputTokens: undefined,
    truncationPolicy,
    cwd: process.cwd(),
    displayCwd: process.cwd(),
    env: applyUnifiedExecEnv(process.env),
    tty: false
  });

  try {
    const deadline = Date.now() + 2_000;
    while (!manager.listProcesses().some((entry) => entry.processId === processId)) {
      if (Date.now() >= deadline) throw new Error('process was not stored as live');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const entry = (manager as any).processes.get(processId);
    const mutex = entry.process.interactionLock as {
      lock(): Promise<() => void>;
      tryLock(): (() => void) | null;
    };

    const releaseFirst = await mutex.lock();
    const queuedSecond = mutex.lock();
    releaseFirst();

    // No await here on purpose: this is the exact handoff gap where a queued waiter already
    // exists but its continuation has not run yet. Tokio's try_lock cannot barge ahead of it.
    const stolen = mutex.tryLock();
    stolen?.();
    expect(stolen).toBeNull();

    const releaseSecond = await queuedSecond;
    releaseSecond();
  } finally {
    await manager.terminateProcess(processId);
    await initial.catch(() => undefined);
    await manager.terminateAllProcesses();
  }
});
