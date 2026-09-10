import { describe, expect, it, vi } from 'vitest';
import { probeLinuxDesktop } from '../src/main/desktop/linux/index.js';
import { createX11DesktopDriver } from '../src/main/desktop/linux/x11.js';

const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

describe('Linux Desktop runtime probe', () => {
  it('reports headless sessions as unavailable without loading a graphical adapter', async () => {
    const loadX11 = vi.fn();
    const loadWayland = vi.fn();
    const result = await probeLinuxDesktop({ platform: 'linux', env: {}, commandExists: async () => true, loadX11, loadWayland });
    expect(result.kind).toBe('headless');
    expect(result.driver).toBeNull();
    expect(loadX11).not.toHaveBeenCalled();
    expect(loadWayland).not.toHaveBeenCalled();
  });

  it('selects X11 lazily only when DISPLAY and required tools are present', async () => {
    const driver = { capabilities: vi.fn() } as never;
    const loadX11 = vi.fn(async () => driver);
    const result = await probeLinuxDesktop({
      platform: 'linux', env: { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' },
      commandExists: async (name) => ['xdotool', 'import'].includes(name), loadX11, loadWayland: vi.fn()
    });
    expect(result.kind).toBe('x11');
    expect(result.driver).toBe(driver);
    expect(loadX11).toHaveBeenCalledTimes(1);
  });

  it('reports missing X11 dependencies truthfully', async () => {
    const result = await probeLinuxDesktop({
      platform: 'linux', env: { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' },
      commandExists: async (name) => name === 'xdotool', loadX11: vi.fn(), loadWayland: vi.fn()
    });
    expect(result).toMatchObject({ kind: 'unavailable', driver: null });
    expect(result.reason).toMatch(/import/i);
  });

  it('refuses a Wayland claim when the portal client is unavailable', async () => {
    const loadWayland = vi.fn();
    const result = await probeLinuxDesktop({
      platform: 'linux',
      env: { WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland' },
      commandExists: async () => false,
      loadX11: vi.fn(),
      loadWayland
    });
    expect(result).toMatchObject({ kind: 'unavailable', driver: null });
    expect(result.reason).toMatch(/gdbus/i);
    expect(loadWayland).not.toHaveBeenCalled();
  });
});

describe('Linux X11 DesktopDriver', () => {
  it('reports partial capabilities from the proven helper set', async () => {
    const driver = createX11DesktopDriver({
      commands: new Set(['xdotool', 'import']),
      run: vi.fn(async () => ({ code: 0, stdout: Buffer.from('') }))
    });
    expect(await driver.capabilities()).toMatchObject({ available: true, capture: true, pointer: true, keyboard: true, clipboardRead: false, clipboardWrite: false, windows: true, uiElements: false, focus: true });
  });

  it('captures the X11 root screen and returns a coordinate frame', async () => {
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'xdotool' && args[0] === 'getdisplaygeometry') return { code: 0, stdout: Buffer.from('1920 1080\n') };
      if (command === 'import') return { code: 0, stdout: png1x1 };
      return { code: 0, stdout: Buffer.from('') };
    });
    const driver = createX11DesktopDriver({ commands: new Set(['xdotool', 'import']), run });
    const result = await driver.observe({ kind: 'screenshot', maxWidth: 320 });
    expect(result.kind).toBe('screenshot');
    expect(result.screenshot.frameId).toBeGreaterThan(0);
    expect(result.screenshot.data.length).toBeGreaterThan(0);
    expect(result.screenshot.captureMode).toBe('screen');
  });

  it('maps coordinates from a scaled screenshot frame back to X11 desktop coordinates', async () => {
    const image = await (await import('sharp')).default({ create: { width: 1920, height: 1080, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'xdotool' && args[0] === 'getdisplaygeometry') return { code: 0, stdout: Buffer.from('1920 1080\n') };
      if (command === 'import') return { code: 0, stdout: image };
      return { code: 0, stdout: Buffer.from('') };
    });
    const driver = createX11DesktopDriver({ commands: new Set(['xdotool', 'import']), run });
    const frame = await driver.observe({ kind: 'screenshot', maxWidth: 960 });
    await driver.act({
      frameId: frame.screenshot.frameId,
      actions: [
        { type: 'move', x: 480, y: 270 },
        { type: 'click', x: 480, y: 270 },
        { type: 'drag', path: [{ x: 0, y: 0 }, { x: 480, y: 270 }] }
      ]
    });
    expect(run).toHaveBeenCalledWith('xdotool', ['mousemove', '960', '540'], undefined);
    expect(run).toHaveBeenCalledWith('xdotool', ['mousemove', '960', '540', 'click', '1'], undefined);
    expect(run).toHaveBeenCalledWith('xdotool', ['mousemove', '960', '540'], undefined);
  });

  it('rejects coordinates tied to a stale X11 screenshot frame', async () => {
    const image = await (await import('sharp')).default({ create: { width: 640, height: 480, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'xdotool' && args[0] === 'getdisplaygeometry') return { code: 0, stdout: Buffer.from('640 480\n') };
      if (command === 'import') return { code: 0, stdout: image };
      return { code: 0, stdout: Buffer.from('') };
    });
    const driver = createX11DesktopDriver({ commands: new Set(['xdotool', 'import']), run });
    const old = await driver.observe({ kind: 'screenshot' });
    await driver.observe({ kind: 'screenshot' });
    await expect(driver.act({ frameId: old.screenshot.frameId, actions: [{ type: 'click', x: 10, y: 10 }] })).rejects.toThrow(/STALE_FRAME/);
  });
  it('passes clipboard text to xclip over stdin rather than argv', async () => {
    const run = vi.fn(async (_command: string, _args: string[], _input?: Buffer | string) => ({ code: 0, stdout: Buffer.from('') }));
    const driver = createX11DesktopDriver({ commands: new Set(['xdotool', 'import', 'xclip']), run });
    await driver.act({ actions: [{ type: 'write_clipboard', text: 'secret clipboard text' }] });
    expect(run).toHaveBeenCalledWith('xclip', ['-selection', 'clipboard'], 'secret clipboard text');
    expect(run.mock.calls.flatMap((call) => call[1]).join(' ')).not.toContain('secret clipboard text');
  });
  it('fails semantic UI refs explicitly instead of pretending X11 supports them', async () => {
    const driver = createX11DesktopDriver({ commands: new Set(['xdotool', 'import']), run: vi.fn(async () => ({ code: 0, stdout: Buffer.from('') })) });
    await expect(driver.observe({ kind: 'ui' })).rejects.toThrow(/semantic UI/i);
    await expect(driver.act({ actions: [{ type: 'click_ref', ref: 'x' }] })).rejects.toThrow(/semantic UI/i);
  });
});
