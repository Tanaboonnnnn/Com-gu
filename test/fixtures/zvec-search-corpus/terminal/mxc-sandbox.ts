// Every real command in an active Run is launched through the MXC OS sandbox. The sandbox receives
// the effective canonical root list and an authority fingerprint; unavailable confinement fails closed.
export interface CommandSandbox {
  roots: readonly string[];
  conversationId: string;
  runId: string;
  scopeFingerprint: string;
}

export function requireMxc(available: boolean): void {
  if (!available) throw new Error('COMMAND_SANDBOX_UNAVAILABLE');
}
