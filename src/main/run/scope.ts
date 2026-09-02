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

export function parseWorkspaceScopeSelection(input: unknown): WorkspaceScopeSelection {
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

function snapshot(
  primaryRoot: string,
  sharedRoots: readonly string[],
  identities: readonly Readonly<{ name: string; path: string }>[]
): WorkspaceScope {
  return Object.freeze({
    primaryRoot,
    sharedRoots: Object.freeze([...sharedRoots]),
    rootIdentities: Object.freeze(identities.map((root) => Object.freeze({ name: root.name, path: root.path })))
  });
}

function validatedScope(
  allowedRoots: ReadonlyMap<string, Readonly<{ name: string; path: string }>>,
  input: unknown,
  outOfBounds: () => never
): WorkspaceScope {
  const selection = parseWorkspaceScopeSelection(input);
  const seen = new Set<string>();
  if (!allowedRoots.has(selection.primaryRoot)) outOfBounds();
  seen.add(selection.primaryRoot);
  for (const name of selection.sharedRoots) {
    if (!allowedRoots.has(name) || seen.has(name)) outOfBounds();
    seen.add(name);
  }
  const names = [selection.primaryRoot, ...selection.sharedRoots];
  return snapshot(
    selection.primaryRoot,
    selection.sharedRoots,
    names.map((name) => allowedRoots.get(name) as Readonly<{ name: string; path: string }>)
  );
}

export function createWorkspaceScope(approvedRoots: readonly Root[], input: unknown): WorkspaceScope {
  const roots = new Map(approvedRoots.map((root) => [root.name, root]));
  if (roots.size === 0) required();
  return validatedScope(roots, input, escalation);
}

export function workspaceScopeNames(scope: WorkspaceScope): readonly string[] {
  return Object.freeze([scope.primaryRoot, ...scope.sharedRoots]);
}

export function narrowWorkspaceScope(scope: WorkspaceScope, input?: unknown): WorkspaceScope {
  const roots = new Map(scope.rootIdentities.map((root) => [root.name, root]));
  if (input === undefined) return snapshot(scope.primaryRoot, scope.sharedRoots, scope.rootIdentities);
  return validatedScope(roots, input, escalation);
}

export function effectiveWorkspaceRoots(scope: WorkspaceScope, approvedRoots: readonly Root[]): readonly Root[] {
  const byName = new Map(approvedRoots.map((root) => [root.name, root]));
  const persisted = new Map(scope.rootIdentities.map((root) => [root.name, root.path]));
  const roots = workspaceScopeNames(scope).map((name) => {
    const root = byName.get(name);
    if (!root || persisted.get(name) !== root.path) escalation();
    return Object.freeze({ name: root.name, path: root.path });
  });
  return Object.freeze(roots);
}

/** Parse the exact persisted authority shape; legacy name-only scopes intentionally restore as null. */
export function restoreWorkspaceScopeSnapshot(input: unknown): WorkspaceScope | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'primaryRoot' && key !== 'sharedRoots' && key !== 'rootIdentities')) {
    return null;
  }
  let selection: WorkspaceScopeSelection;
  try {
    selection = parseWorkspaceScopeSelection({ primaryRoot: record.primaryRoot, sharedRoots: record.sharedRoots });
  } catch {
    return null;
  }
  if (!Array.isArray(record.rootIdentities)) return null;
  const identities: Array<{ name: string; path: string }> = [];
  for (const value of record.rootIdentities) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const root = value as Record<string, unknown>;
    if (Object.keys(root).some((key) => key !== 'name' && key !== 'path')) return null;
    if (typeof root.name !== 'string' || !root.name || typeof root.path !== 'string' || !root.path) return null;
    identities.push({ name: root.name, path: root.path });
  }
  const names = [selection.primaryRoot, ...selection.sharedRoots];
  if (new Set(names).size !== names.length) return null;
  if (identities.length !== names.length) return null;
  if (identities.some((root, index) => root.name !== names[index])) return null;
  return snapshot(selection.primaryRoot, selection.sharedRoots, identities);
}
