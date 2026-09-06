import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { perfMarkerPath, writePerfReadyMarker } from '../src/main/perf-marker.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let temp: string | undefined;

afterEach(async () => {
  if (temp) await removeTempDir(temp);
  temp = undefined;
});

describe('packaged performance ready marker', () => {
  it('is completely inert when the opt-in environment variable is absent', async () => {
    expect(perfMarkerPath({})).toBeNull();
    temp = await makeTempDir('comgu-perf-marker-');
    const sentinel = path.join(temp, 'must-not-exist.json');
    await writePerfReadyMarker({}, { pid: 123, now: () => 456 });
    await expect(fs.stat(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes only pid and ready timestamp to the explicit benchmark path', async () => {
    temp = await makeTempDir('comgu-perf-marker-');
    const marker = path.join(temp, 'ready.json');
    expect(perfMarkerPath({ COMGU_PERF_MARKER_FILE: marker })).toBe(marker);

    await writePerfReadyMarker(
      { COMGU_PERF_MARKER_FILE: marker },
      { pid: 789, now: () => 1_234_567 }
    );

    expect(JSON.parse(await fs.readFile(marker, 'utf8'))).toEqual({
      pid: 789,
      readyAtEpochMs: 1_234_567
    });
  });
});
