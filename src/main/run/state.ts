import type { Root } from '../../shared/types.js';
import { WorkspaceScopeError, createWorkspaceScope, narrowWorkspaceScope } from './scope.js';
import type { WorkspaceScope } from './types.js';

const NO_AUTHORITY_TEXT =
  'WORKSPACE_SCOPE_REQUIRED: this run has no workspace authority. Start a scoped run before accessing workspace resources.';

export function bindRunWorkspaceScope(approvedRoots: readonly Root[], input: unknown): WorkspaceScope {
  return createWorkspaceScope(approvedRoots, input);
}

export function effectiveWorkerWorkspaceScope(runScope: WorkspaceScope | null, requested?: unknown): WorkspaceScope {
  if (!runScope) throw new WorkspaceScopeError('WORKSPACE_SCOPE_REQUIRED', NO_AUTHORITY_TEXT);
  return narrowWorkspaceScope(runScope, requested);
}

/**
 * Restores only authority that was explicitly persisted by a scoped build.
 * Legacy snapshots have no field and therefore restore with no workspace authority.
 */
export function restoreRunWorkspaceScope(input: unknown): WorkspaceScope | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'primaryRoot' && key !== 'sharedRoots')) return null;
  if (typeof record.primaryRoot !== 'string' || !record.primaryRoot || !Array.isArray(record.sharedRoots)) return null;
  if (record.sharedRoots.some((name) => typeof name !== 'string' || !name)) return null;
  const names = [record.primaryRoot, ...(record.sharedRoots as string[])];
  if (new Set(names).size !== names.length) return null;
  return Object.freeze({
    primaryRoot: record.primaryRoot,
    sharedRoots: Object.freeze([...(record.sharedRoots as string[])])
  });
}

