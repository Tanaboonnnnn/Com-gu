import { spawn } from 'node:child_process';
import sharp from 'sharp';
import type { Action, Rect, Screenshot, WindowInfo } from '../../computer/index.js';
import type { DesktopCapabilities, DesktopDriver, DesktopObserveRequest, DesktopObserveResult } from '../driver.js';

export interface X11RunResult { code: number; stdout: Buffer; }
export type X11Runner = (command: string, args: string[], input?: Buffer | string) => Promise<X11RunResult>;

export function createX11ProcessRunner(env: NodeJS.ProcessEnv = process.env): X11Runner {
  return (command, args, input) => new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks) });
    };
    const timer = setTimeout(() => { child.kill(); finish(1); }, 15_000);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= 16 * 1024 * 1024) chunks.push(chunk);
      else { child.kill(); finish(1); }
    });
    child.once('error', () => finish(1));
    child.once('close', (code) => finish(code ?? 1));
    child.stdin.end(input ?? '');
  });
}
class X11DesktopError extends Error {
  override name = 'ComputerError';
}

function unsupported(message: string): never { throw new X11DesktopError(message); }
function button(value?: string): string {
  if (!value || value === 'left') return '1';
  if (value === 'middle') return '2';
  if (value === 'right') return '3';
  return unsupported(`Unsupported X11 mouse button: ${value}`);
}

export function createX11DesktopDriver(options: { commands: Set<string>; run: X11Runner }): DesktopDriver {
  const has = (name: string) => options.commands.has(name);
  let frame = 0;
  let lastFrame: { id: number; scale: number; region: Rect } | null = null;

  const caps = (): DesktopCapabilities => ({
    available: has('xdotool') && has('import'),
    capture: has('import'), pointer: has('xdotool'), keyboard: has('xdotool'),
    clipboardRead: has('xclip'), clipboardWrite: has('xclip'), windows: has('xdotool'),
    uiElements: false, focus: has('xdotool'),
    ...(!(has('xdotool') && has('import')) ? { reason: 'X11 requires xdotool and ImageMagick import.' } : {})
  });

  const runOk = async (command: string, args: string[], input?: Buffer | string): Promise<Buffer> => {
    const result = await options.run(command, args, input);
    if (result.code !== 0) throw new X11DesktopError(`X11 command failed: ${command}`);
    return result.stdout;
  };

  const displayGeometry = async (): Promise<Rect> => {
    const text = (await runOk('xdotool', ['getdisplaygeometry'])).toString('utf8').trim();
    const [width, height] = text.split(/\s+/).map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new X11DesktopError('Could not determine X11 display geometry.');
    return { x: 0, y: 0, width: width!, height: height! };
  };

  const capture = async (request: Extract<DesktopObserveRequest, { kind: 'screenshot' }> | { kind: 'screenshot'; window?: number; maxWidth?: number; crop?: Rect; full?: boolean }): Promise<Screenshot> => {
    if (!has('import')) unsupported('X11 screenshot capture is unavailable.');
    const target = request.window ? String(request.window) : 'root';
    let image = await runOk('import', ['-window', target, 'png:-']);
    let metadata = await sharp(image).metadata();
    const sourceWidth = metadata.width ?? 0;
    const sourceHeight = metadata.height ?? 0;
    if (!sourceWidth || !sourceHeight) throw new X11DesktopError('X11 screenshot returned invalid image data.');
    let region: Rect = request.window ? { x: 0, y: 0, width: sourceWidth, height: sourceHeight } : await displayGeometry();
    if (request.crop) {
      const left = Math.max(0, Math.floor(request.crop.x));
      const top = Math.max(0, Math.floor(request.crop.y));
      const width = Math.max(1, Math.min(sourceWidth - left, Math.floor(request.crop.width)));
      const height = Math.max(1, Math.min(sourceHeight - top, Math.floor(request.crop.height)));
      image = await sharp(image).extract({ left, top, width, height }).png().toBuffer();
      region = { x: region.x + left, y: region.y + top, width, height };
      metadata = await sharp(image).metadata();
    }
    const maxWidth = request.maxWidth ? Math.max(1, Math.floor(request.maxWidth)) : 1280;
    if ((metadata.width ?? 0) > maxWidth) image = await sharp(image).resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer();
    const final = await sharp(image).metadata();
    const width = final.width ?? 0;
    const height = final.height ?? 0;
    const frameId = ++frame;
    const scale = region.width > 0 ? width / region.width : 1;
    lastFrame = { id: frameId, scale, region };
    return {
      data: image.toString('base64'), frameId, width, height, region, scale,
      focused: request.window ? null : null,
      captureMode: request.window ? 'window' : 'screen', windowId: request.window ?? null
    };
  };

  const windowInfo = async (id: number, foreground = false): Promise<WindowInfo> => {
    const [titleBuf, geoBuf, pidBuf] = await Promise.all([
      runOk('xdotool', ['getwindowname', String(id)]),
      runOk('xdotool', ['getwindowgeometry', '--shell', String(id)]),
      runOk('xdotool', ['getwindowpid', String(id)]).catch(() => Buffer.from(''))
    ]);
    const geo = Object.fromEntries(geoBuf.toString('utf8').split(/\r?\n/).map((row) => row.split('=', 2)).filter((x) => x.length === 2));
    return { id, title: titleBuf.toString('utf8').trim(), process: pidBuf.toString('utf8').trim(), x: Number(geo.X ?? 0), y: Number(geo.Y ?? 0), width: Number(geo.WIDTH ?? 0), height: Number(geo.HEIGHT ?? 0), state: foreground ? 'foreground' : 'open' };
  };

  const observe = async (request: DesktopObserveRequest): Promise<DesktopObserveResult> => {
    if (request.kind === 'ui') unsupported('X11 semantic UI refs are unsupported; use screenshots and coordinates.');
    if (request.kind === 'state') {
      const activeId = request.window ?? Number((await runOk('xdotool', ['getactivewindow'])).toString('utf8').trim());
      return { kind: 'state', window: await windowInfo(activeId, true), snapshotId: null, screenshot: request.includeScreenshot === false ? null : await capture({ kind: 'screenshot', window: request.window, maxWidth: request.maxWidth }), elements: [] };
    }
    if (request.kind === 'active') {
      const screen = await displayGeometry();
      const id = Number((await runOk('xdotool', ['getactivewindow'])).toString('utf8').trim());
      return { kind: 'active', window: Number.isFinite(id) ? await windowInfo(id, true) : null, screen };
    }
    if (request.kind === 'windows') {
      const screen = await displayGeometry();
      const ids = (await runOk('xdotool', ['search', '--onlyvisible', '--name', '.'])).toString('utf8').trim().split(/\s+/).filter(Boolean).slice(0, 100).map(Number).filter(Number.isFinite);
      return { kind: 'windows', windows: await Promise.all(ids.map((id) => windowInfo(id))), screen };
    }
    if (request.kind === 'wait-window') {
      const deadline = Date.now() + (request.timeoutMs ?? 5000);
      while (Date.now() <= deadline) {
        const out = await options.run('xdotool', ['search', '--onlyvisible', '--name', request.title ?? '.']);
        const id = Number(out.stdout.toString('utf8').trim().split(/\s+/)[0]);
        if (out.code === 0 && Number.isFinite(id)) return { kind: 'wait-window', window: await windowInfo(id) };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new X11DesktopError('WINDOW_NOT_FOUND: no matching X11 window appeared before timeout.');
    }
    return { kind: 'screenshot', screenshot: await capture(request) };
  };

  const point = (x: number, y: number): { x: number; y: number } => {
    const current = lastFrame;
    if (!current || current.scale <= 0) return { x: Math.round(x), y: Math.round(y) };
    return {
      x: Math.round(current.region.x + x / current.scale),
      y: Math.round(current.region.y + y / current.scale)
    };
  };

  const actOne = async (action: Action, clipboard: string[]): Promise<'sendinput' | 'focus' | 'local'> => {
    switch (action.type) {
      case 'click_ref': case 'set_value': unsupported('X11 semantic UI refs are unsupported; use coordinates or typing.');
      case 'move': { const p = point(action.x, action.y); await runOk('xdotool', ['mousemove', String(p.x), String(p.y)]); return 'sendinput'; }
      case 'click': { const p = point(action.x, action.y); await runOk('xdotool', ['mousemove', String(p.x), String(p.y), 'click', button(action.button)]); return 'sendinput'; }
      case 'double_click': { const p = point(action.x, action.y); await runOk('xdotool', ['mousemove', String(p.x), String(p.y), 'click', '--repeat', '2', '--delay', '100', button(action.button)]); return 'sendinput'; }
      case 'type': await runOk('xdotool', ['type', '--delay', '1', '--', action.text]); return 'sendinput';
      case 'keypress': await runOk('xdotool', ['key', action.keys.join('+')]); return 'sendinput';
      case 'focus': await runOk('xdotool', ['windowactivate', '--sync', String(action.window)]); return 'focus';
      case 'wait': await new Promise((resolve) => setTimeout(resolve, action.ms ?? 100)); return 'local';
      case 'read_clipboard': if (!has('xclip')) unsupported('X11 clipboard access requires xclip.'); clipboard.push((await runOk('xclip', ['-selection', 'clipboard', '-o'])).toString('utf8')); return 'local';
      case 'write_clipboard': if (!has('xclip')) unsupported('X11 clipboard access requires xclip.'); await runOk('xclip', ['-selection', 'clipboard'], action.text); return 'local';
      case 'scroll': {
        const p = point(action.x, action.y); await runOk('xdotool', ['mousemove', String(p.x), String(p.y)]);
        const vertical = action.scroll_y ?? 0; const horizontal = action.scroll_x ?? 0;
        const clicks: Array<[number, string]> = [[vertical, vertical < 0 ? '4' : '5'], [horizontal, horizontal < 0 ? '6' : '7']];
        for (const [delta, key] of clicks) for (let i = 0; i < Math.min(50, Math.abs(Math.round(delta / 120))); i++) await runOk('xdotool', ['click', key]);
        return 'sendinput';
      }
      case 'drag': {
        const [first, ...rest] = action.path; if (!first) return 'sendinput';
        const start = point(first.x, first.y);
        await runOk('xdotool', ['mousemove', String(start.x), String(start.y), 'mousedown', button(action.button)]);
        for (const item of rest) { const p = point(item.x, item.y); await runOk('xdotool', ['mousemove', String(p.x), String(p.y)]); }
        await runOk('xdotool', ['mouseup', button(action.button)]); return 'sendinput';
      }
    }
  };

  return {
    capabilities: async () => caps(), observe: observe as DesktopDriver['observe'],
    async act(request) {
      if (request.frameId !== undefined && request.frameId !== lastFrame?.id) {
        throw new X11DesktopError('STALE_FRAME: the X11 screenshot frame is no longer current.');
      }
      const clipboard: string[] = []; const routes: Array<'sendinput' | 'focus' | 'local'> = [];
      let completedCount = 0;
      for (const action of request.actions) { routes.push(await actOne(action, clipboard)); completedCount += 1; }
      const screenshot = request.capture ? await capture({ kind: 'screenshot', window: request.capture.window, maxWidth: request.capture.maxWidth, crop: request.capture.crop, full: request.capture.full }) : null;
      if (request.verify) unsupported('X11 verification waits for semantic UI state are unsupported in V1.');
      return { cursor: null, clipboard, completedCount, routes, screenshot, verification: null };
    },
    async dispose() {}
  };
}
