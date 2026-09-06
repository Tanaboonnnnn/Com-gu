import { describe, expect, it } from 'vitest';
import {
  SMART_SEARCH_DEFAULT_LIMIT,
  SMART_SEARCH_MAX_LIMIT,
  SMART_SEARCH_MODES
} from '../src/main/zvec-search/types.js';
import { loadZvecModule, zvecModuleLoadedForTest } from '../src/main/zvec-search/loader.js';

describe('smart-search public contract', () => {
  it('keeps the model-facing modes and result limits deliberately small', () => {
    expect(SMART_SEARCH_MODES).toEqual(['auto', 'hybrid', 'lexical', 'semantic']);
    expect(SMART_SEARCH_DEFAULT_LIMIT).toBe(8);
    expect(SMART_SEARCH_MAX_LIMIT).toBe(20);
  });
});

it('loads zvec only on first explicit request', async () => {
  expect(zvecModuleLoadedForTest()).toBe(false);
  const first = await loadZvecModule();
  expect(typeof first.createZvecGrep).toBe('function');
  expect(zvecModuleLoadedForTest()).toBe(true);
  expect(await loadZvecModule()).toBe(first);
});
