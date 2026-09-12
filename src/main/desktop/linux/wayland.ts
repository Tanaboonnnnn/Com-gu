import sharp from 'sharp';
import type { Action, Screenshot } from '../../computer/index.js';
import { DesktopError, type DesktopCapabilities, type DesktopDriver, type DesktopObserveRequest, type DesktopObserveResult } from '../driver.js';

export interface WaylandPortalGrants {
  active: boolean; capture: boolean; pointer: boolean; keyboard: boolean;
  clipboardRead: boolean; clipboardWrite: boolean; width: number; height: number;
}

export interface WaylandPortalSession {
  grants(): WaylandPortalGrants;
  screenshot(): Promise<Buffer>;
  move(x: number, y: number): Promise<void>;
  button(button: 'left' | 'middle' | 'right', pressed: boolean): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  keysym(keysym: number, pressed: boolean): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  close(): Promise<void>;
}

const fail = (message: string): never => { throw new DesktopError(message); };

function keySym(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0xff ? code : 0x01000000 | code;
}
const NAMED_KEYSYM: Record<string, number> = {
  enter: 0xff0d, return: 0xff0d, escape: 0xff1b, esc: 0xff1b, tab: 0xff09, backspace: 0xff08,
  delete: 0xffff, left: 0xff51, up: 0xff52, right: 0xff53, down: 0xff54,
  shift: 0xffe1, ctrl: 0xffe3, control: 0xffe3, alt: 0xffe9, meta: 0xffe7, super: 0xffeb
};

export function createWaylandDesktopDriver(portal: WaylandPortalSession): DesktopDriver {
  let frame = 0;
  let lastScale = 1;

  const sendKeySequence = async (syms: number[]): Promise<void> => {
    const pressed: number[] = [];
    let primaryError: unknown = null;
    try {
      for (const sym of syms) {
        await portal.keysym(sym, true);
        pressed.push(sym);
      }
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      let cleanupError: unknown = null;
      for (const sym of [...pressed].reverse()) {
        try {
          await portal.keysym(sym, false);
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (!primaryError && cleanupError) throw cleanupError;
    }
  };
  const requireActive = (): WaylandPortalGrants => {
    const grants = portal.grants();
    if (!grants.active) fail('Wayland portal session is closed or permission was revoked.');
    return grants;
  };
  const capabilities = async (): Promise<DesktopCapabilities> => {
    const g = portal.grants();
    if (!g.active) return { available: false, capture: false, pointer: false, keyboard: false, clipboardRead: false, clipboardWrite: false, windows: false, uiElements: false, focus: false, reason: 'Wayland portal session is closed or permission was revoked.' };
    return { available: g.capture || g.pointer || g.keyboard || g.clipboardRead || g.clipboardWrite, capture: g.capture, pointer: g.pointer, keyboard: g.keyboard, clipboardRead: g.clipboardRead, clipboardWrite: g.clipboardWrite, windows: false, uiElements: false, focus: false };
  };
  const capture = async (maxWidth?: number): Promise<Screenshot> => {
    const g = requireActive(); if (!g.capture) fail('Wayland screenshot permission was not granted by the portal.');
    let bytes = await portal.screenshot();
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) fail('Wayland portal returned invalid screenshot data.');
    const limit = Math.max(1, Math.floor(maxWidth ?? 1280));
    if (meta.width > limit) bytes = await sharp(bytes).resize({ width: limit, withoutEnlargement: true }).png().toBuffer();
    const final = await sharp(bytes).metadata();
    const width = final.width ?? meta.width; const height = final.height ?? meta.height;
    lastScale = width / (g.width || meta.width);
    return { data: bytes.toString('base64'), frameId: ++frame, width, height, region: { x: 0, y: 0, width: g.width || meta.width, height: g.height || meta.height }, scale: lastScale, focused: null, captureMode: 'screen', windowId: null };
  };

  const observe = async (request: DesktopObserveRequest): Promise<DesktopObserveResult> => {
    const g = requireActive();
    switch (request.kind) {
      case 'windows': return fail('Wayland window enumeration is unsupported by the granted portal interface.');
      case 'ui': return fail('Wayland semantic UI control is unsupported by the granted portal interface.');
      case 'wait-window': return fail('Wayland window waiting is unsupported by the granted portal interface.');
      case 'active': return { kind: 'active', window: null, screen: { x: 0, y: 0, width: g.width, height: g.height } };
      case 'state': return fail('Wayland window state inspection is unsupported; request a screenshot instead.');
      case 'screenshot': return { kind: 'screenshot', screenshot: await capture(request.maxWidth) };
    }
  };

  const point = (x: number, y: number): { x: number; y: number } => ({
    x: Math.round(x / Math.max(lastScale, Number.EPSILON)),
    y: Math.round(y / Math.max(lastScale, Number.EPSILON))
  });

  const doAction = async (action: Action, clipboard: string[]): Promise<'sendinput' | 'local'> => {
    const g = requireActive();
    switch (action.type) {
      case 'click_ref': case 'set_value': return fail('Wayland semantic UI control is unsupported by the granted portal interface.');
      case 'focus': return fail('Wayland window focus is unsupported by the granted portal interface.');
      case 'move': if (!g.pointer) fail('Wayland pointer permission was not granted by the portal.'); { const p = point(action.x, action.y); await portal.move(p.x, p.y); } return 'sendinput';
      case 'click': case 'double_click': {
        if (!g.pointer) fail('Wayland pointer permission was not granted by the portal.');
        const p = point(action.x, action.y); await portal.move(p.x, p.y); const b = (action.button ?? 'left') as 'left' | 'middle' | 'right'; const count = action.type === 'double_click' ? 2 : 1;
        for (let i = 0; i < count; i++) { await portal.button(b, true); await portal.button(b, false); }
        return 'sendinput';
      }
      case 'scroll': if (!g.pointer) fail('Wayland pointer permission was not granted by the portal.'); await portal.scroll(action.scroll_x ?? 0, action.scroll_y ?? 0); return 'sendinput';
      case 'drag': {
        if (!g.pointer) fail('Wayland pointer permission was not granted by the portal.'); const [first, ...rest] = action.path; if (!first) return 'sendinput';
        const mouseButton = (action.button ?? 'left') as 'left' | 'middle' | 'right';
        { const p = point(first.x, first.y); await portal.move(p.x, p.y); }
        await portal.button(mouseButton, true);
        try {
          for (const item of rest) { const p = point(item.x, item.y); await portal.move(p.x, p.y); }
        } finally {
          await portal.button(mouseButton, false);
        }
        return 'sendinput';
      }
      case 'type': if (!g.keyboard) fail('Wayland keyboard permission was not granted by the portal.'); for (const ch of action.text) await sendKeySequence([keySym(ch)]); return 'sendinput';
      case 'keypress': {
        if (!g.keyboard) fail('Wayland keyboard permission was not granted by the portal.'); const syms = action.keys.map((key) => NAMED_KEYSYM[key.toLowerCase()] ?? keySym(key)); await sendKeySequence(syms); return 'sendinput';
      }
      case 'wait': await new Promise((resolve) => setTimeout(resolve, action.ms ?? 100)); return 'local';
      case 'read_clipboard': if (!g.clipboardRead) fail('Wayland clipboard read permission was not granted by the portal.'); clipboard.push(await portal.readClipboard()); return 'local';
      case 'write_clipboard': if (!g.clipboardWrite) fail('Wayland clipboard write permission was not granted by the portal.'); await portal.writeClipboard(action.text); return 'local';
    }
  };

  return {
    capabilities,
    observe: observe as DesktopDriver['observe'],
    async act(request) {
      if (request.frameId !== undefined && request.frameId !== frame) fail('STALE_FRAME: the Wayland screenshot frame is no longer current.');
      if (request.verify) fail('Wayland semantic verification is unsupported by the granted portal interface.');
      const clipboard: string[] = []; const routes: Array<'sendinput' | 'local'> = []; let completedCount = 0;
      for (let index = 0; index < request.actions.length; index++) {
        const action = request.actions[index]!;
        try {
          routes.push(await doAction(action, clipboard));
          completedCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new DesktopError(
            `PARTIAL_BATCH: completed_count=${completedCount} failed_index=${index}. ${message}`,
            { completedCount, failedIndex: index }
          );
        }
      }
      const screenshot = request.capture ? await capture(request.capture.maxWidth) : null;
      return { cursor: null, clipboard, completedCount, routes, screenshot, verification: null };
    },
    async dispose() { await portal.close(); }
  } as DesktopDriver;
}
