import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-ignore Benchmark scripts are intentionally plain ESM JavaScript.
import { createSearchFixture, metricStats } from '../scripts/benchmark-mcp-latency.mjs';
import { makeTempDir, removeTempDir } from './helpers.js';

let temp: string | undefined;

afterEach(async () => {
  if (temp) await removeTempDir(temp);
  temp = undefined;
});

describe('MCP latency benchmark helpers', () => {
  it('uses nearest-rank percentiles so p50/p95 are stable and auditable', () => {
    expect(metricStats([1, 2, 3, 4, 5])).toEqual({ count: 5, p50Ms: 3, p95Ms: 5, minMs: 1, maxMs: 5 });
  });

  it('creates a deterministic search corpus of at least five MiB with ignored-folder canaries', async () => {
    temp = await makeTempDir('comgu-perf-search-');
    const fixture = await createSearchFixture(temp);
    expect(fixture.totalBytes).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    for (const query of fixture.queries) {
      expect(await fs.readFile(path.join(temp, query.expected.replace('/fixture/', '')), 'utf8')).toContain(query.query);
    }
    expect(await fs.readFile(path.join(temp, 'node_modules', 'ignored.txt'), 'utf8')).toContain('COMGU_PERF_ALPHA_WORKSPACE');
    expect(await fs.readFile(path.join(temp, 'dist', 'ignored.txt'), 'utf8')).toContain('COMGU_PERF_BETA_SESSION');
  });
});
