// Shutdown is bounded and ordered: stop accepting new work, drain MCP/bridge state, terminate child
// processes and helpers, close search engines, flush sessions, then release the app runtime.
export const shutdownPhases = [
  'stop-new-work',
  'drain-bridge',
  'process-cleanup',
  'flush-durable-state'
] as const;

export function boundedPhase(timeoutMs: number): number {
  return Math.max(1, Math.min(timeoutMs, 15_000));
}
