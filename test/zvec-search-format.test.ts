import { describe, expect, it } from 'vitest';
import { formatSmartSearchResponse } from '../src/main/zvec-search/format.js';
import { SMART_SEARCH_MAX_OUTPUT_BYTES, type SmartSearchHit } from '../src/main/zvec-search/types.js';

describe('smart-search model-facing formatting', () => {
  it('prints only virtual paths and bounded result metadata', () => {
    const hit: SmartSearchHit = {
      virtualPath: '/repo/src/main.ts',
      startLine: 4,
      endLine: 9,
      content: 'workspace authority',
      matchedBy: 'vector',
      score: 0.8,
      freshness: 'fresh'
    };
    const text = formatSmartSearchResponse({ hits: [hit], rootsSearched: 1, elapsedMs: 12 });
    expect(text).toContain('/repo/src/main.ts');
    expect(text).toContain('lines: 4-9');
    expect(text).toContain('workspace authority');
    expect(text).not.toMatch(/[A-Z]:\\Users\\/i);
  });

  it('stops at an item boundary below the 96 KiB budget and states truncation', () => {
    const huge = 'x'.repeat(60 * 1024);
    const hits: SmartSearchHit[] = [1, 2, 3].map((line) => ({
      virtualPath: `/repo/file-${line}.txt`,
      startLine: line,
      endLine: line,
      content: huge,
      matchedBy: 'vector',
      freshness: 'fresh'
    }));
    const text = formatSmartSearchResponse({ hits, rootsSearched: 1, elapsedMs: 1 });
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(SMART_SEARCH_MAX_OUTPUT_BYTES);
    expect(text).toContain('output_truncated: true');
    expect(text).toContain('/repo/file-1.txt');
    expect(text).not.toContain('/repo/file-2.txt');
  });
});
