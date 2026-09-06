import { promises as fs } from 'node:fs';
import path from 'node:path';

type PerfEnvironment = Record<string, string | undefined>;

interface PerfMarkerRuntime {
  pid?: number;
  now?: () => number;
}

export function perfMarkerPath(env: PerfEnvironment): string | null {
  const configured = env.COMGU_PERF_MARKER_FILE?.trim();
  return configured ? configured : null;
}

export async function writePerfReadyMarker(
  env: PerfEnvironment,
  runtime: PerfMarkerRuntime = {}
): Promise<void> {
  const marker = perfMarkerPath(env);
  if (!marker) return;

  const payload = {
    pid: runtime.pid ?? process.pid,
    readyAtEpochMs: (runtime.now ?? Date.now)()
  };
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, `${JSON.stringify(payload)}\n`, 'utf8');
}
