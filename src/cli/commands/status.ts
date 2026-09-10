export interface CliStatusShape {
  runtime?: string;
  mode?: string;
  machine?: { id?: string; name?: string } | null;
  connection?: { state?: string; detail?: string } | null;
  durableRuns?: Array<{ state?: string }>;
}

export function renderPlainStatus(value: unknown): string {
  const status = (value && typeof value === 'object' ? value : {}) as CliStatusShape;
  const machine = status.machine?.name || 'unknown-machine';
  const state = status.connection?.state || 'unknown';
  const mode = status.mode || 'unknown';
  const detail = status.connection?.detail?.trim();
  const durableRuns = status.durableRuns?.length ?? 0;
  return [
    `ComGu · ${machine}`,
    `Mode: ${mode}`,
    `Connection: ${state}`,
    ...(durableRuns > 0 ? [`Durable runs: ${durableRuns}`] : []),
    ...(detail ? [`Detail: ${detail}`] : [])
  ].join('\n');
}
