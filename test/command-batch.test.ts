import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { composeCommandBatch, parseCommandBatchSections } from '../src/main/codex/command-batch.js';

it.skipIf(process.platform === 'win32')('labels POSIX batch results even when a command writes no final newline', () => {
  const batch = composeCommandBatch(["printf '%s' partial; false", "printf '%s' done"], 'sh');
  const result = spawnSync('/bin/sh', ['-c', batch], { encoding: 'utf8' });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(parseCommandBatchSections(result.stdout)).toEqual([
    { index: 1, exitCode: 1, text: 'partial' },
    { index: 2, exitCode: 0, text: 'done' }
  ]);
});
