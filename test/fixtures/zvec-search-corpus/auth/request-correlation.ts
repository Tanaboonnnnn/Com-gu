// Request correlation joins an observed ChatGPT request id to one conversation before a filesystem
// tool can inherit chat workspace authority. The evidence is short lived and exact-id based.
export interface Correlation {
  requestId: string;
  conversationId: string;
  observedAt: number;
}

export function correlationFresh(row: Correlation, now: number, ttlMs: number): boolean {
  return now - row.observedAt <= ttlMs;
}
