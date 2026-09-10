import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { startMcpServer, type McpEndpoint } from '../src/main/mcp/server.js';
import { surfaceDefinition } from '../src/main/mcp/surfaces.js';
import type { ToolContext } from '../src/main/mcp/tools.js';
import { withMachineAttribution } from '../src/main/mcp/kernel.js';
import type { MachineIdentity } from '../src/main/machine/profile.js';
import { makeTempDir, removeTempDir } from './helpers.js';

const machine: MachineIdentity = {
  id: '0a51e3f2-8429-4cba-9b5b-01f0f8f6e4f1',
  name: 'home-server',
  createdAt: '2026-09-10T10:00:00.000Z',
  confirmed: true
};

let dir: string;
let endpoint: McpEndpoint;

function post(urlString: string, body: object): Promise<any> {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    const encoded = JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': Buffer.byteLength(encoded)
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8').trim();
          const data = [...raw.matchAll(/^data:\s*(.*)$/gm)].at(-1)?.[1] ?? raw;
          resolve(JSON.parse(data));
        });
      }
    );
    req.on('error', reject);
    req.end(encoded);
  });
}

beforeAll(async () => {
  dir = await makeTempDir('clf-machine-mcp-');
  initConfigPath(dir);
  await saveConfig(defaultConfig());
  const ctx: ToolContext = {
    roots: [],
    caps: { ...defaultConfig().capabilities },
    readOnly: true,
    sessionTools: false,
    agentTools: false
  };
  endpoint = await startMcpServer(() => ctx, machine);
});

afterAll(async () => {
  await endpoint?.stop();
  await removeTempDir(dir);
});

describe('machine-aware MCP metadata', () => {
  it('adds machine attribution without replacing existing structured tool evidence', () => {
    const result = withMachineAttribution(
      {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { exit_code: 0, nested: { keep: true } }
      },
      machine
    );

    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(result.structuredContent).toEqual({
      exit_code: 0,
      nested: { keep: true },
      machine: { id: machine.id, name: 'home-server' }
    });
  });

  it('generates stable machine-scoped surface metadata without changing declared tools', () => {
    const core = surfaceDefinition('core', machine);
    const desktop = surfaceDefinition('desktop', machine);

    expect(core.serverName).toMatch(/^comgu-core-[0-9a-f]{12}$/);
    expect(desktop.serverName).toMatch(/^comgu-desktop-[0-9a-f]{12}$/);
    expect(core.connectorName).toBe('ComGu · home-server Core');
    expect(desktop.connectorName).toBe('ComGu · home-server Desktop');
    expect(core.tools).toContain('read');
    expect(core.tools).not.toContain('computer');
    expect(desktop.tools).toEqual(['observe', 'computer']);
  });

  it('publishes the machine-specific server identity and cross-surface routing hints', async () => {
    const initialize = (url: string, id: number) =>
      post(url, {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'machine-test', version: '1.0.0' }
        }
      });

    const core = await initialize(endpoint.urls.core, 1);
    const desktop = await initialize(endpoint.urls.desktop, 2);

    expect(core.result.serverInfo.name).toBe(surfaceDefinition('core', machine).serverName);
    expect(desktop.result.serverInfo.name).toBe(surfaceDefinition('desktop', machine).serverName);
    expect(desktop.result.instructions).toContain('ComGu · home-server Core');
  });
});
