import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadOrCreateMcpSecrets } from '../src/main/mcp/credential.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

it('keeps independent secret paths stable after restart and does not regenerate them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-mcp-secret-'));
  dirs.push(dir);
  const first = await loadOrCreateMcpSecrets(dir);
  const second = await loadOrCreateMcpSecrets(dir);
  expect(second).toEqual(first);
  expect(first.core).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(first.desktop).not.toBe(first.core);
});

it('fails closed on corrupted credentials rather than silently rotating published URLs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-mcp-secret-'));
  dirs.push(dir);
  await fs.writeFile(path.join(dir, 'mcp-credentials.json'), '{"core":"bad"}');
  await expect(loadOrCreateMcpSecrets(dir)).rejects.toThrow(/credential/i);
});
