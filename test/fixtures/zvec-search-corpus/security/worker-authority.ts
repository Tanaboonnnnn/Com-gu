// A worker inherits a subset of the Prime run workspace. It cannot widen itself to another root,
// even when the root is globally approved in desktop settings.
export function workerRoots(primeRoots: string[], requested: string[]): string[] {
  const allowed = new Set(primeRoots);
  if (requested.some((root) => !allowed.has(root))) throw new Error('WORKSPACE_OUTSIDE_RUN');
  return requested;
}

// Worker identity is bound to the exact ChatGPT conversation for that worker slot.
export function workerOwnsConversation(expected: string, actual: string): boolean {
  return expected === actual;
}
