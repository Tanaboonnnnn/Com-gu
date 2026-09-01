import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('starts exactly one nonblocking background update check after main startup', async () => {
  const source = await fs.readFile(path.join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8');
  const calls = [...source.matchAll(/void checkForUpdatesInBackground\(\);/g)];
  expect(calls).toHaveLength(1);
  expect(source).toContain('void checkForUpdatesInBackground();');
  expect(source).not.toContain('await checkForUpdatesInBackground()');
});
