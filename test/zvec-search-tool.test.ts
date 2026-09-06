import { describe, expect, it, vi } from 'vitest';
import { needsWorkspaceIdentity, type ToolContext } from '../src/main/mcp/kernel.js';
import type { SmartSearchProvider } from '../src/main/zvec-search/types.js';

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
});
