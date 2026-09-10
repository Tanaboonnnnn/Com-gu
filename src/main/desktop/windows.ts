import {
  actAndCapture,
  activeWindow,
  checkAvailable,
  findUi,
  getWindowState,
  listWindows,
  screenshot,
  stopComputerHelper,
  waitForWindow
} from '../computer/index.js';
import type { DesktopCapabilities, DesktopDriver, DesktopObserveRequest, DesktopObserveResult } from './driver.js';

export interface WindowsDesktopOperations {
  available(): Promise<string | null>;
  activeWindow: typeof activeWindow;
  listWindows: typeof listWindows;
  findUi: typeof findUi;
  getWindowState: typeof getWindowState;
  waitForWindow: typeof waitForWindow;
  screenshot: typeof screenshot;
  actAndCapture: typeof actAndCapture;
  stop(): Promise<void>;
}

const defaultOperations: WindowsDesktopOperations = {
  available: checkAvailable,
  activeWindow,
  listWindows,
  findUi,
  getWindowState,
  waitForWindow,
  screenshot,
  actAndCapture,
  stop: stopComputerHelper
};

const FULL_WINDOWS_CAPABILITIES: DesktopCapabilities = {
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

function unavailableCapabilities(reason: string): DesktopCapabilities {
  return {
    available: false,
    capture: false,
    pointer: false,
    keyboard: false,
    clipboardRead: false,
    clipboardWrite: false,
    windows: false,
    uiElements: false,
    focus: false,
    reason
  };
}

export function createWindowsDesktopDriver(
  operations: Partial<WindowsDesktopOperations> = defaultOperations
): DesktopDriver {
  const ops = { ...defaultOperations, ...operations };

  const observe = async (request: DesktopObserveRequest): Promise<DesktopObserveResult> => {
    switch (request.kind) {
      case 'active':
        return { kind: 'active', ...(await ops.activeWindow()) };
      case 'windows':
        return { kind: 'windows', ...(await ops.listWindows()) };
      case 'ui': {
        const { kind: _kind, ...options } = request;
        return { kind: 'ui', ...(await ops.findUi(options)) };
      }
      case 'state': {
        const { kind: _kind, ...options } = request;
        return { kind: 'state', ...(await ops.getWindowState(options)) };
      }
      case 'wait-window': {
        const { kind: _kind, ...options } = request;
        return { kind: 'wait-window', window: await ops.waitForWindow(options) };
      }
      case 'screenshot': {
        const { kind: _kind, ...options } = request;
        return { kind: 'screenshot', screenshot: await ops.screenshot(options) };
      }
    }
  };

  return {
    async capabilities() {
      const reason = await ops.available();
      return reason ? unavailableCapabilities(reason) : { ...FULL_WINDOWS_CAPABILITIES };
    },
    observe: observe as DesktopDriver['observe'],
    act(request) {
      return ops.actAndCapture(request.actions, {
        frameId: request.frameId,
        capture: request.capture,
        verify: request.verify
      });
    },
    dispose: ops.stop
  };
}

let defaultDriver: DesktopDriver | null = null;

export function windowsDesktopDriver(): DesktopDriver {
  defaultDriver ??= createWindowsDesktopDriver();
  return defaultDriver;
}

export async function resetWindowsDesktopDriverForTests(): Promise<void> {
  if (defaultDriver) await defaultDriver.dispose();
  defaultDriver = null;
}
