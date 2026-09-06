// Renderer settings use a three-way merge because the Chrome extension can update Goal and
// compaction settings concurrently. Fields unchanged by the renderer keep the latest main-process value.
export function mergeField<T>(live: T, base: T, wanted: T): T {
  return Object.is(base, wanted) ? live : wanted;
}

// Theme changes update both the renderer palette and Electron native chrome immediately.
export type Theme = 'light' | 'dark';
