import { describe, expect, it, vi } from 'vitest';
import { parseCliInvocation, runCli } from '../src/cli/index.js';

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    value: {
      writeOut: (text: string) => stdout.push(text),
      writeErr: (text: string) => stderr.push(text),
      isTTY: false,
      columns: 80
    }
  };
}

describe('ComGu CLI', () => {
  it('parses a profile override as a global option instead of passing it to the command', () => {
    expect(parseCliInvocation(['start', '--profile', 'C:\\profiles\\server', '--json'])).toEqual({
      command: 'start',
      args: [],
      json: true,
      profileDir: 'C:\\profiles\\server'
    });
    expect(() => parseCliInvocation(['start', '--profile'])).toThrow(/--profile <path>/);
  });
  it('prints machine-attributed status as JSON without starting a runtime', async () => {
    const output = io();
    const startOwner = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({
      runtime: 'running',
      mode: 'cli',
      machine: { id: 'machine-id', name: 'home-server' },
      connection: { state: 'connected', detail: '', surfaces: [] }
    }));
    expect(await runCli(['status', '--json'], { profileDir: 'ignored', request, startOwner }, output.value)).toBe(0);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({ machine: { name: 'home-server' }, connection: { state: 'connected' } });
    expect(startOwner).not.toHaveBeenCalled();
  });

  it('renders a compact non-TTY status without ANSI control codes', async () => {
    const output = io();
    const request = vi.fn(async () => ({
      runtime: 'running',
      mode: 'desktop-app',
      machine: { id: 'x', name: 'gaming-pc' },
      connection: { state: 'disconnected', detail: 'Not connected', surfaces: [] }
    }));
    const code = await runCli(['status'], { profileDir: 'ignored', request, startOwner: async () => undefined }, output.value);
    expect(code).toBe(0);
    expect(output.stdout.join('')).toContain('gaming-pc');
    expect(output.stdout.join('')).toContain('disconnected');
    expect(output.stdout.join('')).not.toMatch(/\x1b\[/);
  });

  it('routes administrative commands through the local owner', async () => {
    const output = io();
    const request = vi.fn(async (_method: 'status' | 'connect' | 'disconnect' | 'shutdown' | 'reload') => null);
    const deps = { profileDir: 'ignored', request, startOwner: async () => undefined };
    expect(await runCli(['connect'], deps, output.value)).toBe(0);
    expect(await runCli(['disconnect'], deps, output.value)).toBe(0);
    expect(await runCli(['stop'], deps, output.value)).toBe(0);
    expect(request.mock.calls.map(([method]) => method)).toEqual(['connect', 'disconnect', 'shutdown']);
  });

  it('starts an owner only for the start command and returns usage errors distinctly', async () => {
    const output = io();
    const startOwner = vi.fn(async () => undefined);
    const deps = { profileDir: 'ignored', request: vi.fn(async () => null), startOwner };
    expect(await runCli(['start'], deps, output.value)).toBe(0);
    expect(startOwner).toHaveBeenCalledTimes(1);
    expect(await runCli(['definitely-not-a-command'], deps, output.value)).toBe(2);
    expect(output.stderr.join('')).toMatch(/unknown command/i);
  });

  it('opens the lightweight dashboard for an interactive bare comgu invocation', async () => {
    const output = io();
    output.value.isTTY = true;
    const showDashboard = vi.fn(async () => undefined);
    const deps = {
      profileDir: 'ignored',
      request: vi.fn(async () => null),
      startOwner: vi.fn(async () => undefined),
      showDashboard
    };

    expect(await runCli([], deps, output.value)).toBe(0);
    expect(showDashboard).toHaveBeenCalledTimes(1);
    expect(deps.startOwner).not.toHaveBeenCalled();
  });
});
