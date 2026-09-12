import { describe, expect, it, vi } from 'vitest';
import { createWaylandDesktopDriver, type WaylandPortalSession } from '../src/main/desktop/linux/wayland.js';

function session(overrides: Partial<WaylandPortalSession> = {}): WaylandPortalSession {
  return {
    grants: () => ({ active: true, capture: true, pointer: true, keyboard: true, clipboardRead: false, clipboardWrite: false, width: 1920, height: 1080 }),
    screenshot: vi.fn(async () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')),
    move: vi.fn(async () => undefined), button: vi.fn(async () => undefined), scroll: vi.fn(async () => undefined), keysym: vi.fn(async () => undefined),
    readClipboard: vi.fn(async () => ''), writeClipboard: vi.fn(async () => undefined), close: vi.fn(async () => undefined), ...overrides
  };
}

describe('Wayland portal DesktopDriver', () => {
  it('reports only capabilities granted by the portal session', async () => {
    const portal = session({ grants: () => ({ active: true, capture: true, pointer: false, keyboard: false, clipboardRead: false, clipboardWrite: false, width: 1280, height: 720 }) });
    const driver = createWaylandDesktopDriver(portal);
    expect(await driver.capabilities()).toEqual({ available: true, capture: true, pointer: false, keyboard: false, clipboardRead: false, clipboardWrite: false, windows: false, uiElements: false, focus: false });
    await expect(driver.act({ actions: [{ type: 'click', x: 1, y: 1 }] })).rejects.toThrow(/pointer.*not granted/i);
  });

  it('maps coordinates and keyboard only through the portal session', async () => {
    const portal = session(); const driver = createWaylandDesktopDriver(portal);
    await driver.act({ actions: [{ type: 'move', x: 10, y: 20 }, { type: 'click', x: 30, y: 40 }, { type: 'type', text: 'A' }] });
    expect(portal.move).toHaveBeenCalledWith(10, 20); expect(portal.move).toHaveBeenCalledWith(30, 40);
    expect(portal.button).toHaveBeenCalledWith('left', true); expect(portal.button).toHaveBeenCalledWith('left', false); expect(portal.keysym).toHaveBeenCalled();
  });

  it('maps scaled screenshot pixels back to portal logical coordinates', async () => {
    const image = await (await import('sharp')).default({ create: { width: 1920, height: 1080, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const portal = session({ screenshot: vi.fn(async () => image) }); const driver = createWaylandDesktopDriver(portal);
    const frame = await driver.observe({ kind: 'screenshot', maxWidth: 960 });
    await driver.act({ frameId: frame.screenshot.frameId, actions: [{ type: 'move', x: 480, y: 270 }] });
    expect(portal.move).toHaveBeenCalledWith(960, 540);
  });
  it('never falls back to unsupported semantic window/UI control', async () => {
    const driver = createWaylandDesktopDriver(session());
    await expect(driver.observe({ kind: 'windows' })).rejects.toThrow(/window enumeration.*unsupported/i);
    await expect(driver.observe({ kind: 'ui' })).rejects.toThrow(/semantic UI.*unsupported/i);
    await expect(driver.act({ actions: [{ type: 'focus', window: 1 }] })).rejects.toThrow(/window focus.*unsupported/i);
    await expect(driver.act({ actions: [{ type: 'click_ref', ref: 'x' }] })).rejects.toThrow(/semantic UI.*unsupported/i);
  });

  it('fails closed when the portal session is revoked', async () => {
    let active = true; const portal = session({ grants: () => ({ active, capture: true, pointer: true, keyboard: true, clipboardRead: false, clipboardWrite: false, width: 1920, height: 1080 }) });
    const driver = createWaylandDesktopDriver(portal); expect((await driver.capabilities()).available).toBe(true); active = false;
    expect(await driver.capabilities()).toMatchObject({ available: false, capture: false, pointer: false, keyboard: false });
    await expect(driver.observe({ kind: 'screenshot' })).rejects.toThrow(/portal session.*closed/i);
  });

  it('uses portal screenshot bytes for frames', async () => {
    const portal = session(); const driver = createWaylandDesktopDriver(portal); const shot = await driver.observe({ kind: 'screenshot', maxWidth: 320 });
    expect(shot.screenshot.frameId).toBeGreaterThan(0); expect(shot.screenshot.captureMode).toBe('screen'); expect(portal.screenshot).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported verification before sending any Wayland input', async () => {
    const portal = session();
    const driver = createWaylandDesktopDriver(portal);
    await expect(driver.act({ actions: [{ type: 'move', x: 1, y: 2 }], verify: { until: 'foreground', window: 42 } })).rejects.toThrow(/verification.*unsupported/i);
    expect(portal.move).not.toHaveBeenCalled();
    expect(portal.button).not.toHaveBeenCalled();
  });

  it('reports exact partial execution metadata when a Wayland batch action fails', async () => {
    let moves = 0;
    const portal = session({
      move: vi.fn(async () => {
        moves += 1;
        if (moves === 3) throw new Error('portal move failed');
      })
    });
    const driver = createWaylandDesktopDriver(portal);
    await expect(driver.act({ actions: [
      { type: 'move', x: 1, y: 1 },
      { type: 'move', x: 2, y: 2 },
      { type: 'move', x: 3, y: 3 }
    ] })).rejects.toMatchObject({ name: 'ComputerError', completedCount: 2, failedIndex: 2 });
  });

  it('releases the Wayland mouse button when a drag move fails after press', async () => {
    let moves = 0;
    const portal = session({
      move: vi.fn(async () => {
        moves += 1;
        if (moves === 2) throw new Error('portal drag move failed');
      })
    });
    const driver = createWaylandDesktopDriver(portal);
    await expect(driver.act({ actions: [{ type: 'drag', path: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] })).rejects.toThrow();
    expect(portal.button).toHaveBeenCalledWith('left', false);
  });

  it('releases already-pressed Wayland keys when a later key-down fails', async () => {
    const calls: Array<[number, boolean]> = [];
    const portal = session({
      keysym: vi.fn(async (sym: number, pressed: boolean) => {
        calls.push([sym, pressed]);
        if (pressed && sym === 0x4c) throw new Error('portal key-down failed');
      })
    });
    const driver = createWaylandDesktopDriver(portal);
    await expect(driver.act({ actions: [{ type: 'keypress', keys: ['CTRL', 'L'] }] })).rejects.toThrow(/key-down failed/i);
    expect(calls).toContainEqual([0xffe3, false]);
  });

  it('preserves the original Wayland keypress error when cleanup also fails', async () => {
    const portal = session({
      keysym: vi.fn(async (sym: number, pressed: boolean) => {
        if (pressed && sym === 0x4c) throw new Error('original key-down failure');
        if (!pressed && sym === 0xffe3) throw new Error('cleanup key-up failure');
      })
    });
    const driver = createWaylandDesktopDriver(portal);
    await expect(driver.act({ actions: [{ type: 'keypress', keys: ['CTRL', 'L'] }] })).rejects.toThrow(/original key-down failure/i);
  });
});
