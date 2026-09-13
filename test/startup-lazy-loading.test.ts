import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-ignore performance audit scripts are intentionally plain ESM JavaScript.
import { traceMainStartupImports } from '../scripts/trace-main-startup-imports.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('startup static import audit', () => {
  it('classifies optional and core subsystems from the main entry static graph', async () => {
    const trace = await traceMainStartupImports(root);
    expect(trace.entry).toBe('src/main/index.ts');
    expect(trace.modules).toContain('src/main/index.ts');
    expect(trace.classifications.computerHelper.length).toBeGreaterThan(0);
    expect(trace.classifications.mxc.length).toBeGreaterThan(0);
    expect(trace.classifications.sessionAgent.length).toBeGreaterThan(0);
    expect(trace.classifications.goalAgents).toEqual([]);
    expect(trace.classifications.sharp).toBeDefined();
    expect(trace.classifications.updater.length).toBeGreaterThan(0);
    expect(trace.modules.some((item: string) => item.includes('zvec'))).toBe(false);
  });

  it('keeps Durable Run dormant without a periodic timer or busy loop', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile(path.join(root, 'src/main/run/durable-run.ts'), 'utf8')
    );
    expect(source).not.toMatch(/setInterval\s*\(/);
    expect(source).not.toMatch(/setTimeout\s*\(/);
  });
});
