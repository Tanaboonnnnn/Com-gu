export interface CliStatusShape {
  runtime?: string;
  mode?: string;
  machine?: { id?: string; name?: string } | null;
  connection?: { state?: string; detail?: string } | null;
}

export function renderPlainStatus(value: unknown): string {
  const status = (value && typeof value === 'object' ? value : {}) as CliStatusShape;
  const machine = status.machine?.name || 'unknown-machine';
  const state = status.connection?.state || 'unknown';
  const mode = status.mode || 'unknown';
  const detail = status.connection?.detail?.trim();
  return [
    `ComGu · ${machine}`,
    `Mode: ${mode}`,
    `Connection: ${state}`,
    ...(detail ? [`Detail: ${detail}`] : [])
  ].join('\n');
}
