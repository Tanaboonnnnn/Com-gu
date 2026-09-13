import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITIES } from '../src/shared/types.js';
import { registerDesktopTools } from '../src/main/mcp/tools-desktop.js';
import type { DesktopDriver } from '../src/main/desktop/driver.js';

describe('Desktop MCP driver seam', () => {
  it('uses the injected DesktopDriver rather than Windows primitives', async () => {
    const handlers = new Map<string, (input: any) => Promise<any>>();
    const caps = { ...DEFAULT_CAPABILITIES, screen: true };
    const reg = {
      ctx: { roots: [], caps, readOnly: false },
      caps,
      exposedCaps: caps,
      sessionToolsLive: false,
      sessionToolsExposed: false,
      agentToolsLive: false,
      agentToolsExposed: false,
      findExposed: false,
      register: (name: string, _config: unknown, handler: (input: any) => Promise<any>) => handlers.set(name, handler),
      guarded: async (_cap: string, _name: string, fn: () => Promise<any>) => fn(),
      featureDisabled: () => ({ content: [{ type: 'text', text: 'disabled' }], isError: true }),
      registered: () => [...handlers.keys()]
    };
    const observe: DesktopDriver['observe'] = (async (request: any) => {
      if (request.kind !== 'active') throw new Error(`unexpected ${request.kind}`);
      return {
        kind: 'active',
        window: { id: 77, title: 'Injected Window', process: 'fake.exe', x: 1, y: 2, width: 800, height: 600, state: 'foreground' },
        screen: { x: 0, y: 0, width: 1920, height: 1080 }
      };
    }) as DesktopDriver['observe'];
    const driver: DesktopDriver = {
      capabilities: async () => ({
        available: true, capture: true, pointer: true, keyboard: true,
        clipboardRead: true, clipboardWrite: true, windows: true, uiElements: true, focus: true
      }),
      observe,
      act: async () => { throw new Error('not used'); },
      dispose: async () => undefined
    };

    const registerWithDriver = registerDesktopTools as unknown as (reg: any, driver: DesktopDriver) => void;
    registerWithDriver(reg, driver);
    const result = await handlers.get('observe')!({ what: 'active', screenshot: false });
    expect(result.content[0].text).toContain('Injected Window');
    expect(result.content[0].text).toContain('fake.exe');
  });

  it('requires frameId at the MCP handler boundary for pixels but keeps ref navigation frame-free', async () => {
    const configs = new Map<string, any>();
    const handlers = new Map<string, (input: any) => Promise<any>>();
    const caps = { ...DEFAULT_CAPABILITIES, screen: true, control: true };
    const reg = {
      ctx: { roots: [], caps, readOnly: false },
      caps,
      exposedCaps: caps,
      sessionToolsLive: false,
      sessionToolsExposed: false,
      agentToolsLive: false,
      agentToolsExposed: false,
      findExposed: false,
      register: (name: string, config: unknown, handler: (input: any) => Promise<any>) => {
        configs.set(name, config);
        handlers.set(name, handler);
      },
      guarded: async (_cap: string, _name: string, fn: () => Promise<any>) => fn(),
      featureDisabled: () => ({ content: [{ type: 'text', text: 'disabled' }], isError: true }),
      registered: () => [...configs.keys()]
    };
    const calls: any[] = [];
    const driver = {
      capabilities: async () => ({
        available: true, capture: true, pointer: true, keyboard: true,
        clipboardRead: false, clipboardWrite: false, windows: true, uiElements: true, focus: true
      }),
      observe: async () => { throw new Error('not used'); },
      act: async (request: unknown) => {
        calls.push(request);
        return { cursor: null, clipboard: [], screenshot: null, verification: null, routes: ['uia'], completedCount: 1 };
      },
      dispose: async () => undefined
    } as unknown as DesktopDriver;
    (registerDesktopTools as unknown as (reg: any, driver: DesktopDriver) => void)(reg, driver);
    const schema = configs.get('computer').inputSchema;

    expect(schema.safeParse({ actions: [{ type: 'click', x: 10, y: 20 }] }).success).toBe(true);
    expect(schema.safeParse({ actions: [{ type: 'move', x: 10, y: 20 }], frameId: 7 }).success).toBe(true);
    expect(schema.safeParse({ actions: [{ type: 'click_ref', ref: 'snapshot:button:1' }] }).success).toBe(true);
    expect(schema.safeParse({ actions: [{ type: 'keypress', keys: ['ctrl', 'l'] }] }).success).toBe(true);

    const missingFrame = await handlers.get('computer')!({ actions: [{ type: 'click', x: 10, y: 20 }] });
    expect(missingFrame.isError).toBe(true);
    expect(missingFrame.content[0].text).toContain('frameId is required for coordinate actions');
    expect(calls).toHaveLength(0);

    const refNavigation = await handlers.get('computer')!({ actions: [{ type: 'click_ref', ref: 'snapshot:button:1' }] });
    expect(refNavigation.isError).not.toBe(true);
    expect(calls).toHaveLength(1);
  });
});
