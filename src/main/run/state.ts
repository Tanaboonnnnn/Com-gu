import type { Root } from '../../shared/types.js';
import {
  WorkspaceScopeError,
  createWorkspaceScope,
  narrowWorkspaceScope,
  restoreWorkspaceScopeSnapshot
} from './scope.js';
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
  return restoreWorkspaceScopeSnapshot(input);
}
