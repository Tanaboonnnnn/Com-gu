import { describe, expect, it, vi } from 'vitest';
import { createWindowsDesktopDriver } from '../src/main/desktop/windows.js';
import type { DesktopCapabilities } from '../src/main/desktop/driver.js';

const fullWindows: DesktopCapabilities = {
  available: true,
  capture: true,
  pointer: true,
  keyboard: true,
  clipboardRead: true,
  clipboardWrite: true,
  windows: true,
  uiElements: true,
  focus: true
};

describe('DesktopDriver Windows adapter', () => {
  it('reports truthful Windows capabilities behind the small driver interface', async () => {
    const driver = createWindowsDesktopDriver({ available: async () => null } as never);
    expect(await driver.capabilities()).toEqual(fullWindows);
  });

  it('maps observe requests to the existing Windows implementation', async () => {
    const active = vi.fn(async () => ({ window: null, screen: { x: 0, y: 0, width: 1920, height: 1080 } }));
    const windows = vi.fn(async () => ({ windows: [], screen: { x: 0, y: 0, width: 1920, height: 1080 } }));
    const driver = createWindowsDesktopDriver({
      available: async () => null,
      activeWindow: active,
      listWindows: windows
    } as never);

    expect(await driver.observe({ kind: 'active' })).toMatchObject({ kind: 'active', window: null });
    expect(await driver.observe({ kind: 'windows' })).toMatchObject({ kind: 'windows', windows: [] });
    expect(active).toHaveBeenCalledTimes(1);
    expect(windows).toHaveBeenCalledTimes(1);
  });

  it('keeps ordered action/capture semantics behind one act call and disposes the helper', async () => {
    const actAndCapture = vi.fn(async () => ({
      cursor: null,
      clipboard: [],
      completedCount: 1,
      routes: ['sendinput'] as const,
      screenshot: null,
      verification: null
    }));
    const stop = vi.fn(async () => undefined);
    const driver = createWindowsDesktopDriver({
      available: async () => null,
      actAndCapture,
      stop
    } as never);

    const request = { actions: [{ type: 'keypress' as const, keys: ['ctrl', 's'] }] };
    expect(await driver.act(request)).toMatchObject({ completedCount: 1, screenshot: null });
    expect(actAndCapture).toHaveBeenCalledTimes(1);
    await driver.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable without pretending the backend is partially usable', async () => {
    const driver = createWindowsDesktopDriver({ available: async () => 'PowerShell unavailable' } as never);
    expect(await driver.capabilities()).toEqual({
      available: false,
      capture: false,
      pointer: false,
      keyboard: false,
      clipboardRead: false,
      clipboardWrite: false,
      windows: false,
      uiElements: false,
      focus: false,
      reason: 'PowerShell unavailable'
    });
  });
});
