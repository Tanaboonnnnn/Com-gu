/**
 * Explicit filesystem/terminal authority chosen by the user for one ChatGPT conversation.
 *
 * This is deliberately separate from workspace.ts. That older module remembers a convenient
 * cwd after a proven call; convenience must never mint authority. A chat scope is authority:
 * it is created only from already-approved roots, snapshots their current identities, persists
 * across restart, and fails closed if a root name is later rebound to another native path.
 */

import type { Root } from '../shared/types.js';
import type { WorkspaceScopeView } from '../shared/session.js';
import { writeDurableNow, writeDurableSoon } from './durable.js';
import {
  WorkspaceScopeError,
  createWorkspaceScope,
  effectiveWorkspaceRoots,
  restoreWorkspaceScopeSnapshot
} from './run/scope.js';
import type { WorkspaceScope } from './run/types.js';

export const CHAT_WORKSPACE_SCOPES_STATE = 'chat-workspace-scopes';

interface StoredChatWorkspaceScope {
  conversationId: string;
  scope: WorkspaceScope;
}

export interface ChatWorkspaceScopesSnapshot {
  version: 1;
  savedAt: number;
  entries: StoredChatWorkspaceScope[];
}

const scopes = new Map<string, WorkspaceScope>();
/** Scope-less conversations that proved a file/command call and need a Desktop fallback choice. Not authority and not durable. */
const pending = new Set<string>();
/** Explicit Desktop fallback for unidentified ordinary calls. It is never persisted. */
let manualScope: WorkspaceScope | null = null;
let manualPending = false;
const listeners = new Set<() => void>();

function validConversationId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function view(scope: WorkspaceScope): WorkspaceScopeView {
  return { primaryRoot: scope.primaryRoot, sharedRoots: [...scope.sharedRoots] };
}

function rebuildScope(
  primaryRoot: string,
  sharedRoots: readonly string[],
  rootIdentities: readonly Readonly<{ name: string; path: string }>[]
): WorkspaceScope {
  const rebuilt = restoreWorkspaceScopeSnapshot({ primaryRoot, sharedRoots: [...sharedRoots], rootIdentities: [...rootIdentities] });
  if (!rebuilt) throw new Error('Internal workspace scope rebuild failed');
  return rebuilt;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function changed(): void {
  writeDurableSoon(CHAT_WORKSPACE_SCOPES_STATE, snapshotChatWorkspaceScopes());
  notify();
}

async function changedNow(): Promise<void> {
  await writeDurableNow(CHAT_WORKSPACE_SCOPES_STATE, snapshotChatWorkspaceScopes());
  notify();
}

export function onChatWorkspaceScopeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshotChatWorkspaceScopes(): ChatWorkspaceScopesSnapshot {
  return {
    version: 1,
    savedAt: Date.now(),
    entries: [...scopes.entries()].map(([conversationId, scope]) => ({ conversationId, scope }))
  };
}

/** Restores only exact authority snapshots written by this feature. Invalid rows are ignored. */
export function restoreChatWorkspaceScopes(input: unknown): void {
  scopes.clear();
  manualScope = null;
  manualPending = false;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const snapshot = input as Partial<ChatWorkspaceScopesSnapshot>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.entries)) return;
  for (const row of snapshot.entries) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Partial<StoredChatWorkspaceScope>;
    if (!validConversationId(record.conversationId)) continue;
    const scope = restoreWorkspaceScopeSnapshot(record.scope);
    if (scope) scopes.set(record.conversationId, scope);
  }
}

export function chatWorkspaceScope(conversationId: string): WorkspaceScope | null {
  return scopes.get(conversationId) ?? null;
}

export function chatWorkspaceScopeView(conversationId: string): WorkspaceScopeView | null {
  const scope = chatWorkspaceScope(conversationId);
  return scope ? view(scope) : null;
}

/** Marks an exact, already-proven conversation as waiting for a user workspace choice. */
export function noteChatWorkspaceRequired(conversationId: string): boolean {
  if (!validConversationId(conversationId) || scopes.has(conversationId)) return false;
  const before = pending.size;
  pending.add(conversationId);
  if (pending.size !== before) notify();
  return true;
}

export function pendingChatWorkspaceConversations(): string[] {
  return [...pending].sort();
}

export function isChatWorkspacePending(conversationId: string): boolean {
  return pending.has(conversationId);
}

/**
 * User-owned mutation boundary. The caller must already have proved which conversation the UI
 * is controlling; this function only accepts approved-root names and captures native identity
 * from Config.roots supplied by the main process.
 */
export async function setChatWorkspaceScope(
  conversationId: string,
  approvedRoots: readonly Root[],
  selection: unknown
): Promise<WorkspaceScopeView> {
  if (!validConversationId(conversationId)) {
    throw new WorkspaceScopeError('WORKSPACE_SCOPE_REQUIRED', 'WORKSPACE_SCOPE_REQUIRED: a valid conversation is required.');
  }
  const scope = createWorkspaceScope(approvedRoots, selection);
  // Prove the freshly captured identities still match the current approval set before publishing.
  effectiveWorkspaceRoots(scope, approvedRoots);
  const wasPending = pending.delete(conversationId);
  scopes.set(conversationId, scope);
  try {
    await changedNow();
  } catch (error) {
    scopes.delete(conversationId);
    if (wasPending) pending.add(conversationId);
    changed();
    throw error;
  }
  return view(scope);
}

export function manualWorkspaceScopeView(): WorkspaceScopeView | null {
  return manualScope ? view(manualScope) : null;
}

export function manualWorkspacePending(): boolean {
  return manualPending;
}

/** Explicit user grant for calls that cannot be tied to a ChatGPT conversation without the extension. */
export function setManualWorkspaceScope(approvedRoots: readonly Root[], selection: unknown): WorkspaceScopeView {
  const scope = createWorkspaceScope(approvedRoots, selection);
  effectiveWorkspaceRoots(scope, approvedRoots);
  manualScope = scope;
  manualPending = false;
  notify();
  return view(scope);
}

export function clearManualWorkspaceScope(): boolean {
  const changed = manualScope !== null || manualPending;
  manualScope = null;
  manualPending = false;
  if (changed) notify();
  return changed;
}

export function effectiveManualWorkspaceRoots(approvedRoots: readonly Root[]): readonly Root[] {
  if (!manualScope) {
    if (!manualPending) {
      manualPending = true;
      notify();
    }
    throw new WorkspaceScopeError(
      'WORKSPACE_SCOPE_REQUIRED',
      'WORKSPACE_SCOPE_REQUIRED: choose a Desktop fallback workspace before using file or command tools without extension identity.'
    );
  }
  return effectiveWorkspaceRoots(manualScope, approvedRoots);
}

/**
 * Retires authority for a root the user removed. A removed primary invalidates the whole
 * selection; a removed shared root safely narrows it. This prevents delete/re-add — even at
 * the same native path — from resurrecting an old user grant.
 */
export function forgetChatWorkspaceRoot(name: string): boolean {
  let durableChanged = false;
  let visibleChanged = false;
  for (const [conversationId, scope] of scopes) {
    if (scope.primaryRoot === name) {
      scopes.delete(conversationId);
      durableChanged = true;
      visibleChanged = true;
      continue;
    }
    if (!scope.sharedRoots.includes(name)) continue;
    scopes.set(
      conversationId,
      rebuildScope(
        scope.primaryRoot,
        scope.sharedRoots.filter((rootName) => rootName !== name),
        scope.rootIdentities.filter((root) => root.name !== name)
      )
    );
    durableChanged = true;
    visibleChanged = true;
  }

  if (manualScope?.primaryRoot === name) {
    manualScope = null;
    manualPending = false;
    visibleChanged = true;
  } else if (manualScope?.sharedRoots.includes(name)) {
    manualScope = rebuildScope(
      manualScope.primaryRoot,
      manualScope.sharedRoots.filter((rootName) => rootName !== name),
      manualScope.rootIdentities.filter((root) => root.name !== name)
    );
    visibleChanged = true;
  }

  if (durableChanged) changed();
  else if (visibleChanged) notify();
  return visibleChanged;
}

/** Follows a display-name rename only when the captured native identity is unchanged. */
export function renameChatWorkspaceRoot(name: string, newName: string, expectedPath: string): boolean {
  let durableChanged = false;
  let visibleChanged = false;
  const renamed = (scope: WorkspaceScope): WorkspaceScope | null => {
    const captured = scope.rootIdentities.find((root) => root.name === name);
    if (!captured || captured.path !== expectedPath) return null;
    return rebuildScope(
      scope.primaryRoot === name ? newName : scope.primaryRoot,
      scope.sharedRoots.map((rootName) => (rootName === name ? newName : rootName)),
      scope.rootIdentities.map((root) => (root.name === name ? { name: newName, path: root.path } : root))
    );
  };

  for (const [conversationId, scope] of scopes) {
    const next = renamed(scope);
    if (!next) continue;
    scopes.set(conversationId, next);
    durableChanged = true;
    visibleChanged = true;
  }
  if (manualScope) {
    const next = renamed(manualScope);
    if (next) {
      manualScope = next;
      visibleChanged = true;
    }
  }

  if (durableChanged) changed();
  else if (visibleChanged) notify();
  return visibleChanged;
}

export function effectiveChatWorkspaceRoots(conversationId: string, approvedRoots: readonly Root[]): readonly Root[] {
  const scope = chatWorkspaceScope(conversationId);
  if (!scope) {
    noteChatWorkspaceRequired(conversationId);
    throw new WorkspaceScopeError(
      'WORKSPACE_SCOPE_REQUIRED',
      'WORKSPACE_SCOPE_REQUIRED: choose a workspace for this ChatGPT conversation before using file or command tools.'
    );
  }
  return effectiveWorkspaceRoots(scope, approvedRoots);
}

/**
 * Compact & Resume projection move. A target that already has a newer explicit choice wins;
 * the stale source authority is still retired so opening the old chat cannot keep using it.
 */
export async function moveChatWorkspaceScope(fromConversationId: string, toConversationId: string): Promise<boolean> {
  const moved = moveChatWorkspaceScopeProjection(fromConversationId, toConversationId);
  if (!moved) return false;
  await changedNow();
  return true;
}

/** Pure publish-phase counterpart used by continuation recovery after its own durable WAL commits. */
export function moveChatWorkspaceScopeProjection(fromConversationId: string, toConversationId: string): boolean {
  if (!validConversationId(fromConversationId) || !validConversationId(toConversationId) || fromConversationId === toConversationId) {
    return false;
  }
  const source = scopes.get(fromConversationId);
  if (!source) return false;
  scopes.delete(fromConversationId);
  if (!scopes.has(toConversationId)) scopes.set(toConversationId, source);
  changed();
  return true;
}

export async function clearChatWorkspaceScope(conversationId: string): Promise<boolean> {
  if (!scopes.delete(conversationId)) return false;
  await changedNow();
  return true;
}

export function resetChatWorkspaceScopesForTests(): void {
  scopes.clear();
  pending.clear();
  manualScope = null;
  manualPending = false;
  listeners.clear();
}

/**
 * Test fixture seam for subsystems whose subject is not workspace persistence itself.
 * Production callers must use setChatWorkspaceScope(), which crosses the durable acceptance
 * barrier before reporting success. Keeping this explicit avoids weakening spawn() merely so
 * older broker/bridge fixtures can establish the user authority they now require.
 */
export function setChatWorkspaceScopeForTests(
  conversationId: string,
  approvedRoots: readonly Root[],
  selection: unknown
): WorkspaceScopeView {
  if (!validConversationId(conversationId)) {
    throw new WorkspaceScopeError('WORKSPACE_SCOPE_REQUIRED', 'WORKSPACE_SCOPE_REQUIRED: a valid conversation is required.');
  }
  const scope = createWorkspaceScope(approvedRoots, selection);
  effectiveWorkspaceRoots(scope, approvedRoots);
  scopes.set(conversationId, scope);
  return view(scope);
}

