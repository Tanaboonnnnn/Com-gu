/** Stable, name-based authority selected from Config.roots for one run. */
export interface WorkspaceScope {
  readonly primaryRoot: string;
  readonly sharedRoots: readonly string[];
}

export interface WorkspaceScopeSelection {
  readonly primaryRoot: string;
  readonly sharedRoots: readonly string[];
}

export type WorkspaceScopeErrorCode = 'WORKSPACE_SCOPE_REQUIRED' | 'WORKSPACE_SCOPE_ESCALATION';

