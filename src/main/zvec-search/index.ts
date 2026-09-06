import { createSmartSearchManager, type SmartSearchManager, type SmartSearchManagerOptions } from './manager.js';
import { smartSearchStoragePaths } from './paths.js';
import type { SmartSearchProvider } from './types.js';

// Measured winner of the frozen 10-Thai/10-English retrieval gate documented under
// docs/performance/2026-09-06-zvec-search-model-benchmark.md.
export const DEFAULT_SMART_SEARCH_EMBEDDING = 'local/potion-code-16m-v2';

interface InitSmartSearchOptions {
  embedding?: string;
  managerFactory?: (options: SmartSearchManagerOptions) => SmartSearchManager;
}

let manager: SmartSearchManager | null = null;
let closeWork: Promise<void> | null = null;

export function initSmartSearch(userData: string, options: InitSmartSearchOptions = {}): void {
  if (manager) throw new Error('Smart Search is already initialized.');
  closeWork = null;
  const factory = options.managerFactory ?? createSmartSearchManager;
  manager = factory({
    storage: smartSearchStoragePaths(userData),
    embedding: options.embedding ?? DEFAULT_SMART_SEARCH_EMBEDDING
  });
}

export function smartSearchProvider(): SmartSearchProvider {
  if (!manager) throw new Error('Smart Search is not initialized.');
  return manager;
}

export function shutdownSmartSearch(): Promise<void> {
  if (closeWork) return closeWork;
  const current = manager;
  manager = null;
  if (!current) return Promise.resolve();
  closeWork = current.close().finally(() => {
    closeWork = null;
  });
  return closeWork;
}
