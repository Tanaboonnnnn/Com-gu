import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { resetChatWorkspaceScopesForTests, setManualWorkspaceScope } from '../src/main/chat-workspace-scope.js';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import { startMcpServer, type McpEndpoint } from '../src/main/mcp/server.js';
import { validateNewRoot } from '../src/main/sandbox.js';
import { initSessionStore, resetSessionStoreForTests, unsetSessionRootForTests } from '../src/main/session/store.js';
import { unifiedExecManager } from '../src/main/codex/manager.js';
import { removeTempDir } from './helpers.js';

let dir = '';
let endpoint: McpEndpoint | null = null;

afterEach(async () => {
  await unifiedExecManager.terminateAllProcesses();
  if (endpoint) await endpoint.stop().catch(() => undefined);
  endpoint = null;
  resetSessionStoreForTests();
  unsetSessionRootForTests();
  resetDurableForTests();
  resetChatWorkspaceScopesForTests();
  if (dir) await removeTempDir(dir);
  dir = '';
});

function sseJson(body: string): any {
  const data = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');
  return JSON.parse(data === '' ? body : data);
}

async function call(url: string, name: string, args: Record<string, unknown>): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  });
  expect(response.status).toBe(200);
  return sseJson(await response.text());
}

it('fails closed instead of exposing an ownerless long-running terminal from the CLI profile', async () => {
  dir = await validateNewRoot(await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-cli-terminal-identity-')), []);
  initConfigPath(dir);
  initSessionStore(dir);
  initDurableStore(dir);
  const cfg = defaultConfig();
  const roots = [{ name: 'workspace', path: dir }];
  await saveConfig({ ...cfg, roots, readOnly: false });
  setManualWorkspaceScope(roots, { primaryRoot: 'workspace', sharedRoots: [] });

  endpoint = await startMcpServer(
    () => ({ roots, caps: { ...cfg.capabilities, command: true }, readOnly: false, sessionTools: false, agentTools: false }),
    null,
    'cli'
  );

  const result = await call(endpoint.urls.core, 'exec_command', {
    cmd: `node -e "setTimeout(() => {}, 60000)"`,
    workdir: '/workspace',
    yield_time_ms: 25
  });
  const text = result.result?.content?.find((part: any) => part.type === 'text')?.text ?? '';

  expect(result.result?.isError).toBe(true);
  expect(text).toMatch(/identity|principal|session/i);
  expect(text).not.toContain('Process running with session ID');
  expect(unifiedExecManager.listProcesses()).toEqual([]);
});
