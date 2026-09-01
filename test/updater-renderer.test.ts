import { promises as fs } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_GOAL_OBJECTIVE_SYSTEM_PROMPT, DEFAULT_GOAL_SYSTEM_PROMPT } from '../src/shared/goal.js';

let dom: JSDOM | null = null;
afterEach(() => {
  dom?.window.close();
  dom = null;
  vi.resetModules();
});

it('shows background availability but waits for manual panel confirmation before install', async () => {
  const html = await fs.readFile(path.join(process.cwd(), 'src', 'renderer', 'index.html'), 'utf8');
  dom = new JSDOM(html, { url: 'https://local.test/', pretendToBeVisual: true });
  const w = dom.window;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    HTMLElement: w.HTMLElement,
    Element: w.Element,
    Node: w.Node,
    DocumentFragment: w.DocumentFragment,
    HTMLInputElement: w.HTMLInputElement,
    HTMLSelectElement: w.HTMLSelectElement,
    HTMLTextAreaElement: w.HTMLTextAreaElement,
    HTMLButtonElement: w.HTMLButtonElement
  });
  if (!(w.HTMLElement.prototype as any).scrollIntoView) (w.HTMLElement.prototype as any).scrollIntoView = () => {};

  const config = {
    roots: [{ name: 'repo', path: 'C:\\repo' }],
    readOnly: false,
    capabilities: {
      browse: true, search: true, read: true, metadata: true, create: true, edit: true,
      move: true, deleteFile: true, command: true, screen: true, control: true,
      clipboardRead: true, clipboardWrite: true
    },
    tunnel: { kind: 'openai', tunnelId: 'tunnel_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', desktopTunnelId: '', binaryPath: '' },
    ui: { minimizeToTray: true, autoConnect: false, privacyScreenshots: false, theme: 'light', locale: 'en' },
    sessions: { record: true, retainDays: 30, advisoryTokens: 300000, limitTokens: 400000 },
    compaction: { auto: true, autoTokens: 300000 },
    multiAgent: { enabled: false, maxWorkers: 2 },
    goal: { enabled: false, model: 'deepseek/deepseek-v4-flash', reasoning: 'default', prompt: DEFAULT_GOAL_SYSTEM_PROMPT, objectivePrompt: DEFAULT_GOAL_OBJECTIVE_SYSTEM_PROMPT }
  };
  const appState = {
    config,
    status: { state: 'disconnected', detail: '', publicUrl: null, localUrl: null, handshakeAt: null, lastRequestAt: null, lastToolCallAt: null, health: null, surfaces: [] },
    platform: { family: 'windows', name: 'Windows', desktopAutomation: true },
    secureStorage: { available: true, detail: null },
    hasApiKey: false, hasGoalKey: false, resolvedBinary: null, bundledTunnelVersion: null,
    bridge: { running: true, port: 8765, paired: false, present: false, lastSeenAt: null }
  };
  const ok = (data: any) => Promise.resolve({ ok: true as const, data });
  let updateListener: (state: any) => void = () => undefined;
  const checks: string[] = [];
  const installs: string[] = [];
  const api: any = new Proxy({
    getState: () => ok(appState),
    getLog: () => ok([]),
    getSwarm: () => ok({ running: false, runId: null, agents: [], maxWorkers: 2, pendingReports: 0 }),
    getUpdateState: () => ok({ status: 'idle', currentVersion: '2.0.2' }),
    checkForUpdate: () => {
      checks.push('check');
      return ok({ status: 'available', currentVersion: '2.0.2', latestVersion: '2.1.0', releaseName: 'ComGu 2.1.0', releaseNotes: 'notes' });
    },
    installUpdate: () => {
      installs.push('install');
      return ok({ status: 'launched', currentVersion: '2.0.2', latestVersion: '2.1.0' });
    },
    onUpdateStateChanged: (fn: any) => { updateListener = fn; return () => undefined; },
    onStateChanged: () => () => undefined,
    onLogEntry: () => () => undefined,
    onSwarmChanged: () => () => undefined,
    onSessionChanged: () => () => undefined,
    listSessions: () => ok({ sessions: [], activeId: null, pressure: [], total: 0, nextCursor: null })
  }, { get(target, prop) { if (prop in target) return (target as any)[prop]; return (..._args: any[]) => ok(null); } });
  Object.defineProperty(w, 'api', { value: api, configurable: true });

  await import('../src/renderer/main.js');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const panel = w.document.getElementById('updatePanel')!;

  updateListener({ status: 'available', currentVersion: '2.0.2', latestVersion: '2.1.0', releaseName: 'ComGu 2.1.0', releaseNotes: 'background notes' });
  expect(panel.hidden).toBe(true);
  expect(installs).toEqual([]);
  expect(w.document.getElementById('versionBtn')!.textContent).toContain('2.1.0');

  (w.document.getElementById('versionBtn') as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(checks).toEqual(['check']);
  expect(panel.hidden).toBe(false);
  expect(w.document.getElementById('updateNotes')!.textContent).toBe('notes');
  expect(installs).toEqual([]);

  (w.document.getElementById('updateInstall') as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(installs).toEqual(['install']);
});
