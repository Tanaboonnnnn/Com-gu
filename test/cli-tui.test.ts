import { describe, expect, it } from 'vitest';
import { renderDashboard, runDashboard } from '../src/cli/tui.js';

const status = {
  runtime: 'running',
  mode: 'cli',
  machine: { id: 'm1', name: 'home-server' },
  connection: {
    state: 'connected',
    detail: '',
    surfaces: [
      { id: 'core', state: 'live', available: true },
      { id: 'desktop', state: 'off', available: false, detail: 'No graphical session' }
    ]
  }
};

describe('CLI terminal dashboard', () => {
  it('renders a compact beautiful wide dashboard without requiring color', () => {
    const text = renderDashboard(status, { columns: 72, color: false });
    expect(text).toContain('ComGu');
    expect(text).toContain('home-server');
    expect(text).toContain('Connected');
    expect(text).toContain('Core');
    expect(text).toContain('Desktop');
    expect(text).toContain('No graphical session');
    expect(text).toContain('[C]');
    expect(text).not.toMatch(/\x1b\[/);
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThanOrEqual(72);
  });

  it('degrades cleanly in a narrow terminal instead of overflowing', () => {
    const text = renderDashboard(status, { columns: 42, color: false });
    expect(text).toContain('home-server');
    expect(text).toContain('Connected');
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThanOrEqual(42);
  });

  it('uses ANSI only when color is explicitly enabled', () => {
    const text = renderDashboard(status, { columns: 72, color: true });
    expect(text).toMatch(/\x1b\[/);
  });

  it('reacts to connect, disconnect, refresh and quit without a busy loop', async () => {
    const commands: string[] = [];
    const frames: string[] = [];
    let keyHandler: ((key: string) => void) | null = null;
    let raw = false;
    const done = runDashboard({
      request: async (method) => {
        commands.push(method);
        if (method === 'status') return status;
        return null;
      },
      terminal: {
        columns: 72,
        color: false,
        write: (text) => frames.push(text),
        setRawMode: (enabled) => { raw = enabled; },
        onKey: (handler) => { keyHandler = handler; return () => { keyHandler = null; }; }
      },
      refreshMs: 60_000
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(raw).toBe(true);
    expect(commands).toEqual(['status']);
    expect(frames.join('')).toContain('home-server');

    keyHandler!('c');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    keyHandler!('d');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    keyHandler!('r');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    keyHandler!('q');
    await done;

    expect(commands).toEqual(['status', 'connect', 'status', 'disconnect', 'status', 'status']);
    expect(raw).toBe(false);
    expect(keyHandler).toBeNull();
    expect(frames[0]).toContain('\u001b[?1049h');
    expect(frames.at(-1)).toContain('\u001b[?1049l');
  });

  it('restores terminal state when an interrupt signal closes the dashboard', async () => {
    let signalHandler: (() => void) | null = null;
    let raw = false;
    const done = runDashboard({
      request: async () => status,
      terminal: {
        columns: 72,
        color: false,
        write: () => undefined,
        setRawMode: (enabled) => { raw = enabled; },
        onKey: () => () => undefined,
        onSignal: (handler) => { signalHandler = handler; return () => { signalHandler = null; }; }
      },
      refreshMs: 60_000
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(raw).toBe(true);
    signalHandler!();
    await done;
    expect(raw).toBe(false);
    expect(signalHandler).toBeNull();
  });
});
