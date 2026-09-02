import { describe, expect, it } from 'vitest';
import type { Root } from '../src/shared/types.js';
import {
  WorkspaceScopeError,
  createWorkspaceScope,
  effectiveWorkspaceRoots,
  narrowWorkspaceScope,
  workspaceScopeNames
} from '../src/main/run/scope.js';
import {
  bindRunWorkspaceScope,
  effectiveWorkerWorkspaceScope,
  restoreRunWorkspaceScope
} from '../src/main/run/state.js';

const approvedRoots: readonly Root[] = [
  { name: 'project', path: 'C:\\work\\project' },
  { name: 'shared', path: 'C:\\work\\shared' },
  { name: 'docs', path: 'C:\\work\\docs' }
];

describe('run workspace scope', () => {
  it('selects approved roots by stable name and snapshots the selection immutably', () => {
    const sharedRoots = ['shared'];
    const input = { primaryRoot: 'project', sharedRoots };

    const scope = createWorkspaceScope(approvedRoots, input);
    sharedRoots.push('docs');
    input.primaryRoot = 'docs';

    expect(scope).toEqual({ primaryRoot: 'project', sharedRoots: ['shared'] });
    expect(workspaceScopeNames(scope)).toEqual(['project', 'shared']);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.sharedRoots)).toBe(true);
  });

  it('derives only currently approved Root snapshots for the selected names', () => {
    const scope = createWorkspaceScope(approvedRoots, { primaryRoot: 'project', sharedRoots: ['shared'] });
    const roots = effectiveWorkspaceRoots(scope, approvedRoots);

    expect(roots).toEqual([
      { name: 'project', path: 'C:\\work\\project' },
      { name: 'shared', path: 'C:\\work\\shared' }
    ]);
    expect(Object.isFrozen(roots)).toBe(true);
    expect(Object.isFrozen(roots[0])).toBe(true);
  });

  it('rejects empty, duplicate, unknown, and widening-shaped selections', () => {
    const invalid: unknown[] = [
      null,
      {},
      { primaryRoot: '', sharedRoots: [] },
      { primaryRoot: 'project', sharedRoots: ['project'] },
      { primaryRoot: 'project', sharedRoots: ['shared', 'shared'] },
      { primaryRoot: 'outside', sharedRoots: [] },
      { primaryRoot: 'project', sharedRoots: ['outside'] },
      { primaryRoot: 'project', sharedRoots: [], roots: ['outside'] }
    ];

    for (const value of invalid) {
      expect(() => createWorkspaceScope(approvedRoots, value)).toThrow(WorkspaceScopeError);
    }
  });

  it('defaults a worker to the prime scope and permits only a strict subset or equal scope', () => {
    const runScope = createWorkspaceScope(approvedRoots, {
      primaryRoot: 'project',
      sharedRoots: ['shared', 'docs']
    });

    const inherited = narrowWorkspaceScope(runScope);
    const narrowed = narrowWorkspaceScope(runScope, { primaryRoot: 'shared', sharedRoots: [] });

    expect(inherited).toEqual(runScope);
    expect(inherited).not.toBe(runScope);
    expect(narrowed).toEqual({ primaryRoot: 'shared', sharedRoots: [] });
    expect(() =>
      narrowWorkspaceScope(runScope, { primaryRoot: 'project', sharedRoots: ['outside'] })
    ).toThrowError(
      'WORKSPACE_SCOPE_ESCALATION: requested workspace scope exceeds the prime/run workspace scope.'
    );
  });

  it('fails closed for legacy scope-less state instead of inventing authority', () => {
    const runScope = bindRunWorkspaceScope(approvedRoots, {
      primaryRoot: 'project',
      sharedRoots: ['shared']
    });
    expect(effectiveWorkerWorkspaceScope(runScope, undefined)).toEqual(runScope);
    expect(() => effectiveWorkerWorkspaceScope(null, undefined)).toThrowError(
      'WORKSPACE_SCOPE_REQUIRED: this run has no workspace authority. Start a scoped run before accessing workspace resources.'
    );
    expect(restoreRunWorkspaceScope(undefined)).toBeNull();
    expect(restoreRunWorkspaceScope({ primaryRoot: 'project', sharedRoots: ['shared'] })).toEqual(runScope);
    expect(restoreRunWorkspaceScope({ primaryRoot: 'project', sharedRoots: ['project'] })).toBeNull();
  });
});
