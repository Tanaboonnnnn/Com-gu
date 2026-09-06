// Exact search stays available beside semantic search. Without command execution, find performs
// literal/name/content search. With commands enabled, bundled ripgrep (rg) is the exhaustive exact path.
export type ExactSearchBackend = 'find' | 'rg';

export function exactBackend(commandEnabled: boolean): ExactSearchBackend {
  return commandEnabled ? 'rg' : 'find';
}

// Semantic search must never silently replace exact regex or literal matching.
