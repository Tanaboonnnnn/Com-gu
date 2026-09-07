import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { resetChatWorkspaceScopesForTests, setManualWorkspaceScope } from '../src/main/chat-workspace-scope.js';
import { validateNewRoot } from '../src/main/sandbox.js';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import { startMcpServer, type McpEndpoint } from '../src/main/mcp/server.js';
import { initSessionStore, resetSessionStoreForTests, unsetSessionRootForTests } from '../src/main/session/store.js';

const patchGate = vi.hoisted(() => ({
  enabled: false,
  entered: Promise.resolve(),
  enteredResolve: null as (() => void) | null,
  release: Promise.resolve(),
  releaseResolve: null as (() => void) | null
}));

vi.mock('../src/main/codex/apply-patch/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/codex/apply-patch/index.js')>();
  return {
    ...actual,
    executeApplyPatch: async (...args: Parameters<typeof actual.executeApplyPatch>) => {
      if (patchGate.enabled) {
        patchGate.enteredResolve?.();
        await patchGate.release;
      }
      return actual.executeApplyPatch(...args);
    }
  };
});

let dir = '';
let endpoint: McpEndpoint | null = null;

afterEach(async () => {
  releasePatchGate();
  if (endpoint) await endpoint.stop().catch(() => undefined);
  endpoint = null;
  resetSessionStoreForTests();
  unsetSessionRootForTests();
  resetDurableForTests();
  resetChatWorkspaceScopesForTests();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = '';
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function armPatchGate(): void {
  patchGate.enabled = true;
  patchGate.entered = new Promise<void>((resolve) => {
    patchGate.enteredResolve = resolve;
  });
  patchGate.release = new Promise<void>((resolve) => {
    patchGate.releaseResolve = resolve;
  });
}

function releasePatchGate(): void {
  patchGate.enabled = false;
  patchGate.releaseResolve?.();
  patchGate.enteredResolve = null;
  patchGate.releaseResolve = null;
}

it('drains an accepted MCP mutation before closing its response socket', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clf-mcp-drain-'));
  initConfigPath(dir);
  initSessionStore(dir);
  initDurableStore(dir);
  const cfg = defaultConfig();
  const rootPath = await validateNewRoot(dir, []);
  const roots = [{ name: 'probe', path: rootPath }];
  await saveConfig({
    ...cfg,
    roots,
    readOnly: false,
    capabilities: { ...cfg.capabilities, create: true }
  });
  setManualWorkspaceScope(roots, { primaryRoot: 'probe', sharedRoots: [] });
  endpoint = await startMcpServer(() => ({
    roots,
    caps: { ...cfg.capabilities, create: true },
    readOnly: false,
    sessionTools: false,
    agentTools: false
  }));
  armPatchGate();
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'apply_patch',
      arguments: {
        patch: ['*** Begin Patch', '*** Add File: /probe/after-stop.txt', '+after', '*** End Patch'].join('\n')
      }
    }
  };
  const request = fetch(endpoint.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body)
  }).then(async (response) => ({ ok: true, status: response.status, text: await response.text() }));

  // Synchronise inside the mutation handler itself. The old version used a real shell
  // command and therefore measured cold MXC/PowerShell startup on hosted Windows runners
  // instead of the server-drain contract. Holding executeApplyPatch gives us the exact
  // boundary this test names: the MCP mutation is accepted but has not committed yet.
  await patchGate.entered;

  const stopping = endpoint.stop();
  endpoint = null;
  const stoppedEarly = await Promise.race([
    stopping.then(() => true),
    sleep(50).then(() => false)
  ]);
  expect(stoppedEarly).toBe(false);

  releasePatchGate();
  const result = await request;
  await stopping;

  expect(result.ok).toBe(true);
  expect(result.status).toBe(200);
  await expect(fs.readFile(path.join(dir, 'after-stop.txt'), 'utf8')).resolves.toContain('after');
});

it('does not put a force-close deadline on an ordinary endpoint stop', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clf-mcp-graceful-stop-'));
  initConfigPath(dir);
  initSessionStore(dir);
  initDurableStore(dir);
  const cfg = defaultConfig();
  const rootPath = await validateNewRoot(dir, []);
  const roots = [{ name: 'probe', path: rootPath }];
  await saveConfig({ ...cfg, roots });
  endpoint = await startMcpServer(() => ({
    roots,
    caps: cfg.capabilities,
    readOnly: true,
    sessionTools: false,
    agentTools: false
  }));
  const timeout = vi.spyOn(globalThis, 'setTimeout');
  try {
    const stopping = endpoint.stop();
    endpoint = null;
    await stopping;
    expect(timeout.mock.calls.some((call) => call[1] === 30_000)).toBe(false);
  } finally {
    timeout.mockRestore();
  }
});
