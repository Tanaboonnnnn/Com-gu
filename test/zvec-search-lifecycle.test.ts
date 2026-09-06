import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmartSearchManager } from '../src/main/zvec-search/manager.js';

beforeEach(() => {
  vi.resetModules();
});

describe('smart-search process lifecycle', () => {
  it('is unavailable before initialization and exposes the initialized manager afterwards', async () => {
    const mod = await import('../src/main/zvec-search/index.js');
    expect(() => mod.smartSearchProvider()).toThrow(/not initialized/i);
    const fake: SmartSearchManager = {
      search: vi.fn(async () => ({ hits: [], rootsSearched: 0, elapsedMs: 0 })),
      close: vi.fn(async () => undefined)
    };
    const managerFactory = vi.fn(() => fake);
    const userData = path.join('C:', 'Users', 'u', 'ComGu');
    mod.initSmartSearch(userData, { managerFactory, embedding: 'local/test-model' });
    expect(mod.smartSearchProvider()).toBe(fake);
    expect(managerFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: 'local/test-model',
        storage: expect.objectContaining({ base: path.join(userData, 'search') })
      })
    );
  });

  it('closes the manager exactly once even when shutdown is repeated', async () => {
    const mod = await import('../src/main/zvec-search/index.js');
    const close = vi.fn(async () => undefined);
    const fake: SmartSearchManager = {
      search: vi.fn(async () => ({ hits: [], rootsSearched: 0, elapsedMs: 0 })),
      close
    };
    mod.initSmartSearch('C:\\user-data', { managerFactory: () => fake, embedding: 'local/test-model' });
    await Promise.all([mod.shutdownSmartSearch(), mod.shutdownSmartSearch()]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => mod.smartSearchProvider()).toThrow(/not initialized/i);
  });
});
