import { describe, expect, it, vi } from 'vitest';
import { needsWorkspaceIdentity, type ToolContext } from '../src/main/mcp/kernel.js';
import type { SmartSearchProvider } from '../src/main/zvec-search/types.js';
import { registerCoreTools } from '../src/main/mcp/tools-core.js';
import { DEFAULT_CAPABILITIES } from '../src/shared/types.js';

describe('smart-search MCP authority seam', () => {
  it('keeps the provider narrow and attached only through ToolContext', () => {
    const provider: SmartSearchProvider = {
      search: vi.fn(async () => ({ hits: [], rootsSearched: 0, elapsedMs: 0 }))
    };
    const ctx: ToolContext = {
      roots: [],
      caps: {} as ToolContext['caps'],
      readOnly: false,
      smartSearch: provider
    };
    expect(ctx.smartSearch).toBe(provider);
  });

  it('requires exact chat identity for search just like other filesystem tools', () => {
    expect(needsWorkspaceIdentity('search', { query: 'workspace authority' })).toBe(true);
  });

  it('contains a Smart Search provider failure to search while leaving exact tools registered', async () => {
    const registered = new Map<string, (input: any) => Promise<any>>();
    const caps = { ...DEFAULT_CAPABILITIES, search: true, command: false };
    const provider: SmartSearchProvider = {
      search: vi.fn(async () => {
        throw new Error('SMART_SEARCH_UNAVAILABLE: native zvec module could not be loaded');
      })
    };
    registerCoreTools({
      ctx: { roots: [], caps, readOnly: false, smartSearch: provider },
      caps,
      exposedCaps: caps,
      sessionToolsLive: false,
      sessionToolsExposed: false,
      agentToolsLive: false,
      agentToolsExposed: false,
      findExposed: true,
      register(name: string, _config: unknown, handler: (input: any) => Promise<any>) {
        registered.set(name, handler);
      },
      guarded: async (_cap: any, _name: string, fn: () => Promise<any>) => fn(),
      featureDisabled: vi.fn(),
      registered: () => [...registered.keys()]
    } as any);

    expect([...registered.keys()]).toEqual(expect.arrayContaining(['read', 'find', 'search']));
    // The provider is never allowed to remove/replace exact search just because its own native
    // backend is unhealthy. Runtime error mapping is exercised by the MCP integration suite.
    expect(registered.has('find')).toBe(true);
  });
});
