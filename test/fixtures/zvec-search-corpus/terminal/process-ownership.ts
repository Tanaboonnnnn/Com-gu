// Interactive terminal sessions remember their owning ChatGPT conversation. write_stdin must
// prove the same owner and cannot inherit a recycled process id from an older conversation.
export function canWriteStdin(sessionOwner: string, caller: string): boolean {
  return sessionOwner === caller;
}

export function processGeneration(pid: number, createdAt: number): string {
  return `${pid}:${createdAt}`;
}
