import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function localDependencyGraph(entry: string, includeDynamic = false): Promise<Set<string>> {
  const seen = new Set<string>();
  const visit = async (relativeFile: string): Promise<void> => {
    const normalized = relativeFile.replace(/\\/g, '/');
    if (seen.has(normalized)) return;
    seen.add(normalized);
    const source = await fs.readFile(path.join(repo, normalized), 'utf8');
    const imports: string[] = [];
    for (const statement of source.split(/;\s*(?:\r?\n|$)/)) {
      const trimmed = statement.trim();
      if (!trimmed.startsWith('import ') || trimmed.startsWith('import type ')) continue;
      const match = trimmed.match(/(?:\bfrom\s+)?['"](\.[^'"]+)['"]\s*$/);
      if (match) imports.push(match[1]!);
    }
    if (includeDynamic) {
      imports.push(...[...source.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((match) => match[1]!));
    }
    for (const specifier of imports) {
      const base = path.resolve(path.dirname(path.join(repo, normalized)), specifier);
      const candidates = specifier.endsWith('.js')
        ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
        : [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
      let found: string | null = null;
      for (const candidate of candidates) {
        if (!candidate.startsWith(repo)) continue;
        if (await fs.stat(candidate).then(() => true, () => false)) {
          found = candidate;
          break;
        }
      }
      if (found) await visit(path.relative(repo, found));
    }
  };
  await visit(entry);
  return seen;
}

function expectNoOptionalCliWeight(graph: Set<string>): void {
  const joined = [...graph].join('\n').replace(/\\/g, '/');
  for (const forbidden of [
    'src/main/bridge.ts',
    'src/main/agents.ts',
    'src/main/session/recorder.ts',
    'src/main/session/store.ts',
    'src/main/goal.ts',
    'src/main/desktop/windows.ts',
    'src/main/computer/index.ts',
    'src/cli/tui.ts'
  ]) {
    expect(joined, `dependency graph unexpectedly includes ${forbidden}`).not.toContain(forbidden);
  }
}

describe('lightweight CLI dependency graph', () => {
  it('keeps status/json imports administrative and free of runtime/TUI weight', async () => {
    const graph = await localDependencyGraph('src/cli/index.ts');
    expectNoOptionalCliWeight(graph);
    expect([...graph]).not.toContain('src/cli/owner.ts');
  });

  it('keeps the shared runtime seam free of Electron/browser/session/agent/Desktop implementations', async () => {
    const graph = await localDependencyGraph('src/main/runtime/runtime.ts', true);
    expectNoOptionalCliWeight(graph);
    expect([...graph].join('\n')).not.toContain('src/main/secrets.ts');
  });

  it('keeps the Core connection startup static graph free of optional browser/session/Desktop implementations', async () => {
    const graph = await localDependencyGraph('src/main/connection.ts');
    expectNoOptionalCliWeight(graph);
    expect([...graph].join('\n')).not.toContain('src/main/secrets.ts');
  });
});
