// Compaction saves a handoff summary for the same ChatGPT conversation, then a fresh context can
// continue from that durable brief. Tokens are estimated locally and thresholds are advisory.
export function shouldCompact(estimatedTokens: number, threshold: number): boolean {
  return estimatedTokens >= threshold;
}

export function handoffKey(sessionId: string, handoffId: string): string {
  return `${sessionId}/${handoffId}`;
}
