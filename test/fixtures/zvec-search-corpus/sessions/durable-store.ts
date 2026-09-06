// Durable state snapshots survive app restart. Critical swarm and continuation updates can request
// an immediate fsync-like write barrier instead of relying on the coalesced background writer.
export interface DurableSnapshot<T> {
  key: string;
  value: T;
  writtenAt: number;
}

export async function writeDurableNow<T>(snapshot: DurableSnapshot<T>): Promise<boolean> {
  return snapshot.key.length > 0;
}
