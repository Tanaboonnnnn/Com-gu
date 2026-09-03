import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Root } from '../src/shared/types.js';
import { flushDurable, initDurableStore, readDurable, resetDurableForTests } from '../src/main/durable.js';
import {
  CHAT_WORKSPACE_SCOPES_STATE,
  chatWorkspaceScope,
  chatWorkspaceScopeView,
  effectiveChatWorkspaceRoots,
  effectiveManualWorkspaceRoots,
  forgetChatWorkspaceRoot,
  manualWorkspacePending,
  manualWorkspaceScopeView,
  moveChatWorkspaceScope,
  pendingChatWorkspaceConversations,
  noteChatWorkspaceRequired,
  renameChatWorkspaceRoot,
  resetChatWorkspaceScopesForTests,
  restoreChatWorkspaceScopes,
  setChatWorkspaceScope,
  setManualWorkspaceScope,
  snapshotChatWorkspaceScopes
} from '../src/main/chat-workspace-scope.js';

const approved: readonly Root[] = [
  { name: 'comgu', path: 'C:\\work\\comgu' },
  { name: 'lecture', path: 'C:\\work\\lecture' },
  { name: 'shared', path: 'C:\\work\\shared' }
];

const cleanup: string[] = [];

afterEach(async () => {
  resetChatWorkspaceScopesForTests();
  resetDurableForTests();
  await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function store(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-chat-scope-'));
  cleanup.push(dir);
  initDurableStore(dir);
  return dir;
}

describe('per-chat workspace authority', () => {
  it('binds multiple approved roots to one exact conversation and exposes only names', async () => {
    await store();
    const view = await setChatWorkspaceScope('conv-a', approved, {
      primaryRoot: 'comgu',
      sharedRoots: ['lecture', 'shared']
    });

    expect(view).toEqual({ primaryRoot: 'comgu', sharedRoots: ['lecture', 'shared'] });
    expect(chatWorkspaceScope('conv-a')).toMatchObject({
      primaryRoot: 'comgu',
      sharedRoots: ['lecture', 'shared']
    });
    expect(effectiveChatWorkspaceRoots('conv-a', approved)).toEqual(approved);

    const serialized = JSON.stringify(snapshotChatWorkspaceScopes());
    expect(serialized).toContain('C:\\\\work\\\\comgu');
    expect(JSON.stringify(view)).not.toContain('C:\\');
  });

  it('keeps different conversations independent and missing selection has no authority', async () => {
    await store();
    await setChatWorkspaceScope('conv-a', approved, { primaryRoot: 'comgu', sharedRoots: [] });
    await setChatWorkspaceScope('conv-b', approved, { primaryRoot: 'lecture', sharedRoots: ['shared'] });

    expect(effectiveChatWorkspaceRoots('conv-a', approved).map((root) => root.name)).toEqual(['comgu']);
    expect(effectiveChatWorkspaceRoots('conv-b', approved).map((root) => root.name)).toEqual(['lecture', 'shared']);
    expect(() => effectiveChatWorkspaceRoots('conv-c', approved)).toThrowError(/WORKSPACE_SCOPE_REQUIRED/);
  });

  it('marks the proven conversation pending when effective authority is requested without a selection', async () => {
    await store();
    expect(() => effectiveChatWorkspaceRoots('conv-missing', approved)).toThrowError(/WORKSPACE_SCOPE_REQUIRED/);
    expect(pendingChatWorkspaceConversations()).toEqual(['conv-missing']);
  });

  it('marks only a proven scope-less conversation pending and clears it after the user selects approved roots', async () => {
    await store();

    expect(noteChatWorkspaceRequired('conv-pending')).toBe(true);
    expect(pendingChatWorkspaceConversations()).toEqual(['conv-pending']);
    expect(JSON.stringify(pendingChatWorkspaceConversations())).not.toContain('C:\\');

    await setChatWorkspaceScope('conv-pending', approved, { primaryRoot: 'comgu', sharedRoots: ['shared'] });
    expect(pendingChatWorkspaceConversations()).toEqual([]);
    expect(effectiveChatWorkspaceRoots('conv-pending', approved).map((root) => root.name)).toEqual(['comgu', 'shared']);
  });

  it('requires an explicit non-durable Desktop fallback before unidentified file or terminal calls gain authority', async () => {
    await store();

    expect(() => effectiveManualWorkspaceRoots(approved)).toThrowError(/WORKSPACE_SCOPE_REQUIRED/);
    expect(manualWorkspacePending()).toBe(true);
    expect(manualWorkspaceScopeView()).toBeNull();

    const view = setManualWorkspaceScope(approved, { primaryRoot: 'lecture', sharedRoots: ['shared'] });
    expect(view).toEqual({ primaryRoot: 'lecture', sharedRoots: ['shared'] });
    expect(effectiveManualWorkspaceRoots(approved).map((root) => root.name)).toEqual(['lecture', 'shared']);
    expect(manualWorkspacePending()).toBe(false);
    expect(JSON.stringify(view)).not.toContain('C:\\');
  });

  it('never persists or restores the unidentified Desktop fallback workspace', async () => {
    await store();
    setManualWorkspaceScope(approved, { primaryRoot: 'comgu', sharedRoots: [] });
    await flushDurable();

    const saved = await readDurable(CHAT_WORKSPACE_SCOPES_STATE);
    expect(JSON.stringify(saved)).not.toContain('manual');
    expect(JSON.stringify(saved)).not.toContain('C:\\\\work\\\\comgu');

    resetChatWorkspaceScopesForTests();
    restoreChatWorkspaceScopes(saved);
    expect(manualWorkspaceScopeView()).toBeNull();
    expect(() => effectiveManualWorkspaceRoots(approved)).toThrowError(/WORKSPACE_SCOPE_REQUIRED/);
  });
  it('fails closed if a removed root name is later re-approved for a different path', async () => {
    await store();
    await setChatWorkspaceScope('conv-a', approved, { primaryRoot: 'comgu', sharedRoots: ['shared'] });
    expect(() =>
      effectiveChatWorkspaceRoots('conv-a', [
        { name: 'comgu', path: 'D:\\other\\comgu' },
        { name: 'shared', path: 'C:\\work\\shared' }
      ])
    ).toThrowError(/WORKSPACE_ROOT_CHANGED/);
  });

  it('retires removed root authority so re-approving the same name and path cannot resurrect it', async () => {
    await store();
    await setChatWorkspaceScope('conv-a', approved, { primaryRoot: 'comgu', sharedRoots: ['shared'] });
    setManualWorkspaceScope(approved, { primaryRoot: 'comgu', sharedRoots: ['shared'] });

    expect(forgetChatWorkspaceRoot('comgu')).toBe(true);
    expect(chatWorkspaceScope('conv-a')).toBeNull();
    expect(manualWorkspaceScopeView()).toBeNull();

    expect(() => effectiveChatWorkspaceRoots('conv-a', approved)).toThrowError(/WORKSPACE_SCOPE_REQUIRED/);
    expect(() => effectiveManualWorkspaceRoots(approved)).toThrowError(/WORKSPACE_SCOPE_REQUIRED/);
  });

  it('follows a user rename only when the captured native root identity is unchanged', async () => {
    await store();
    await setChatWorkspaceScope('conv-a', approved, { primaryRoot: 'comgu', sharedRoots: ['shared'] });
    setManualWorkspaceScope(approved, { primaryRoot: 'shared', sharedRoots: ['comgu'] });

    expect(renameChatWorkspaceRoot('comgu', 'project', 'C:\\work\\comgu')).toBe(true);
    const renamedRoots: readonly Root[] = [
      { name: 'project', path: 'C:\\work\\comgu' },
      { name: 'lecture', path: 'C:\\work\\lecture' },
      { name: 'shared', path: 'C:\\work\\shared' }
    ];
    expect(chatWorkspaceScopeView('conv-a')).toEqual({ primaryRoot: 'project', sharedRoots: ['shared'] });
    expect(manualWorkspaceScopeView()).toEqual({ primaryRoot: 'shared', sharedRoots: ['project'] });
    expect(effectiveChatWorkspaceRoots('conv-a', renamedRoots).map((root) => root.name)).toEqual(['project', 'shared']);

    expect(renameChatWorkspaceRoot('project', 'wrong', 'D:\\different')).toBe(false);
    expect(chatWorkspaceScopeView('conv-a')).toEqual({ primaryRoot: 'project', sharedRoots: ['shared'] });
  });

  it('persists and restores bound root identity snapshots', async () => {
    await store();
    await setChatWorkspaceScope('conv-a', approved, { primaryRoot: 'comgu', sharedRoots: ['shared'] });
    await flushDurable();
    const saved = await readDurable(CHAT_WORKSPACE_SCOPES_STATE);
    expect(saved).not.toBeNull();

    resetChatWorkspaceScopesForTests();
    restoreChatWorkspaceScopes(saved);
    expect(effectiveChatWorkspaceRoots('conv-a', approved).map((root) => root.name)).toEqual(['comgu', 'shared']);
  });

  it('moves authority on Compact & Resume without overwriting a newer target selection', async () => {
    await store();
    await setChatWorkspaceScope('old-chat', approved, { primaryRoot: 'comgu', sharedRoots: ['shared'] });
    expect(await moveChatWorkspaceScope('old-chat', 'new-chat')).toBe(true);
    expect(chatWorkspaceScope('old-chat')).toBeNull();
    expect(effectiveChatWorkspaceRoots('new-chat', approved).map((root) => root.name)).toEqual(['comgu', 'shared']);

    await setChatWorkspaceScope('older-chat', approved, { primaryRoot: 'lecture', sharedRoots: [] });
    await setChatWorkspaceScope('newer-chat', approved, { primaryRoot: 'shared', sharedRoots: [] });
    expect(await moveChatWorkspaceScope('older-chat', 'newer-chat')).toBe(true);
    expect(chatWorkspaceScope('older-chat')).toBeNull();
    expect(effectiveChatWorkspaceRoots('newer-chat', approved).map((root) => root.name)).toEqual(['shared']);
  });
});


