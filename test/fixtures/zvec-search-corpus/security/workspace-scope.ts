// WorkspaceScope is the per-call filesystem authority. A chat may use only approved roots that
// belong to its current conversation, and an active Run can narrow those roots further.
export function effectiveWorkspaceRoots(chatRoots: string[], runRoots: string[] | null): string[] {
  if (!runRoots) return [...chatRoots];
  return chatRoots.filter((root) => runRoots.includes(root));
}

// Missing caller identity during an active Run is a fail-closed condition, never global access.
export function requireWorkspaceIdentity(conversationId: string | null): string {
  if (!conversationId) throw new Error('WORKSPACE_SCOPE_REQUIRED');
  return conversationId;
}
