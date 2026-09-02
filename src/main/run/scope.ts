import type { Root } from '../../shared/types.js';
import type { WorkspaceScope, WorkspaceScopeErrorCode, WorkspaceScopeSelection } from './types.js';

const REQUIRED_TEXT = 'WORKSPACE_SCOPE_REQUIRED: a run workspace scope must select approved roots by name.';
const ESCALATION_TEXT =
  'WORKSPACE_SCOPE_ESCALATION: requested workspace scope exceeds the prime/run workspace scope.';

export class WorkspaceScopeError extends Error {
  readonly code: WorkspaceScopeErrorCode;

  constructor(code: WorkspaceScopeErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceScopeError';
    this.code = code;
  }
}

function required(): never {
  throw new WorkspaceScopeError('WORKSPACE_SCOPE_REQUIRED', REQUIRED_TEXT);
}

function escalation(): never {
  throw new WorkspaceScopeError('WORKSPACE_SCOPE_ESCALATION', ESCALATION_TEXT);
}

function parseSelection(input: unknown): WorkspaceScopeSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) required();
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== 'primaryRoot' && key !== 'sharedRoots')) required();
  if (typeof record.primaryRoot !== 'string' || !record.primaryRoot) required();
  if (!Array.isArray(record.sharedRoots)) required();
  if (record.sharedRoots.some((name) => typeof name !== 'string' || !name)) required();
  return {
    primaryRoot: record.primaryRoot,
    sharedRoots: record.sharedRoots as string[]
  };
}

function snapshot(primaryRoot: string, sharedRoots: readonly string[]): WorkspaceScope {
  return Object.freeze({ primaryRoot, sharedRoots: Object.freeze([...sharedRoots]) });
}

function validatedScope(allowedNames: ReadonlySet<string>, input: unknown, outOfBounds: () => never): WorkspaceScope {
  const selection = parseSelection(input);
  const seen = new Set<string>();
  if (!allowedNames.has(selection.primaryRoot)) outOfBounds();
  seen.add(selection.primaryRoot);
  for (const name of selection.sharedRoots) {
    if (!allowedNames.has(name) || seen.has(name)) outOfBounds();
    seen.add(name);
  }
  return snapshot(selection.primaryRoot, selection.sharedRoots);
}

export function createWorkspaceScope(approvedRoots: readonly Root[], input: unknown): WorkspaceScope {
  const names = new Set(approvedRoots.map((root) => root.name));
  if (names.size === 0) required();
  return validatedScope(names, input, escalation);
}

export function workspaceScopeNames(scope: WorkspaceScope): readonly string[] {
  return Object.freeze([scope.primaryRoot, ...scope.sharedRoots]);
}

export function narrowWorkspaceScope(scope: WorkspaceScope, input?: unknown): WorkspaceScope {
  if (input === undefined) return snapshot(scope.primaryRoot, scope.sharedRoots);
  return validatedScope(new Set(workspaceScopeNames(scope)), input, escalation);
}

export function effectiveWorkspaceRoots(scope: WorkspaceScope, approvedRoots: readonly Root[]): readonly Root[] {
  const byName = new Map(approvedRoots.map((root) => [root.name, root]));
  const roots = workspaceScopeNames(scope).map((name) => {
    const root = byName.get(name);
    if (!root) escalation();
    return Object.freeze({ name: root.name, path: root.path });
  });
  return Object.freeze(roots);
}
