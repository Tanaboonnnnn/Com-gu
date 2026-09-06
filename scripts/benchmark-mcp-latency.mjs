import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const queryManifest = path.join(repository, 'test', 'fixtures', 'perf-search', 'queries.json');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BENCHMARK_REQUEST_ID = 'wfr_perf_benchmark';
const BENCHMARK_CONVERSATION_ID = 'comgu-perf-benchmark-chat';

function nearestRank(samples, percentile) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

export function metricStats(samples) {
  if (samples.length === 0) return { count: 0, p50Ms: null, p95Ms: null, minMs: null, maxMs: null };
  return {
    count: samples.length,
    p50Ms: nearestRank(samples, 50),
    p95Ms: nearestRank(samples, 95),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples)
  };
}

export async function createSearchFixture(root) {
  const queries = JSON.parse(await fs.readFile(queryManifest, 'utf8'));
  const files = new Map([
    ['src/workspace.ts', `export const marker = 'COMGU_PERF_ALPHA_WORKSPACE';\nexport const scope = 'approved workspace authority';\n`],
    ['docs/session.txt', `COMGU_PERF_BETA_SESSION\ndurable session recording and resume checkpoint\n`],
    ['lib/terminal.ts', `export const terminalMarker = 'COMGU_PERF_GAMMA_TERMINAL';\nexport const owner = 'terminal process ownership';\n`],
    ['node_modules/ignored.txt', `COMGU_PERF_ALPHA_WORKSPACE\nignored dependency noise\n`],
    ['dist/ignored.txt', `COMGU_PERF_BETA_SESSION\nignored build output\n`]
  ]);

  const fillerLine = 'deterministic performance corpus filler without benchmark query markers 0123456789abcdef\n';
  const filler = fillerLine.repeat(Math.ceil((6 * 1024 * 1024) / Buffer.byteLength(fillerLine)));
  files.set('src/generated/filler.txt', filler);

  let totalBytes = 0;
  for (const [relative, content] of files) {
    const target = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    totalBytes += Buffer.byteLength(content);
  }
  return { root, totalBytes, queries };
}

function argValue(args, name, fallback) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

async function waitForJson(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      await fs.rm(file, { force: true });
      return parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for benchmark marker ${file}`);
}

function terminateTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already exited.
  }
}

function benchmarkConfig(root) {
  const capabilities = {
    browse: true,
    search: true,
    read: true,
    metadata: true,
    create: false,
    edit: false,
    move: false,
    deleteFile: false,
    command: false,
    screen: false,
    control: false,
    clipboardRead: false,
    clipboardWrite: false
  };
  return {
    roots: [{ name: 'fixture', path: root }],
    capabilities,
    readOnly: true,
    browser: { preference: 'prime' },
    tunnel: { kind: 'manual', tunnelId: '', desktopTunnelId: '', binaryPath: '' },
    ui: { minimizeToTray: true, autoConnect: true, privacyScreenshots: false, theme: 'dark', locale: 'en' },
    sessions: { record: false, retainDays: 30, advisoryTokens: 400000, limitTokens: 533333 },
    compaction: { auto: true, autoTokens: 400000 },
    multiAgent: { enabled: false, maxWorkers: 2 },
    goal: {
      enabled: false,
      model: '~deepseek/deepseek-v4-flash-latest',
      reasoning: 'default',
      prompt: 'Benchmark placeholder that is never used.',
      objectivePrompt: 'Benchmark placeholder that is never used.'
    }
  };
}

function textOf(result) {
  return (result?.content ?? [])
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

async function withClient(url, fn) {
  const client = new Client({ name: 'comgu-performance-benchmark', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { 'x-request-id': `${BENCHMARK_REQUEST_ID}/benchmark` } }
  });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function measureDiscovery(url) {
  const started = performance.now();
  const tools = await withClient(url, (client) => client.listTools(undefined, { cacheMode: 'refresh' }));
  const elapsed = performance.now() - started;
  const names = tools.tools.map((tool) => tool.name);
  if (!names.includes('find') || !names.includes('read')) {
    throw new Error(`Benchmark Core surface did not expose expected exact-search tools: ${names.join(', ')}`);
  }
  return elapsed;
}

async function measureFind(client, query) {
  const started = performance.now();
  const result = await client.callTool({
    name: 'find',
    arguments: { query: query.query, mode: 'content', max_results: 20 }
  });
  const elapsed = performance.now() - started;
  if (result?.isError) throw new Error(`find failed for ${query.query}: ${textOf(result)}`);
  const text = textOf(result);
  if (!text.includes(query.expected)) {
    throw new Error(`find did not return ${query.expected} for ${query.query}: ${text}`);
  }
  return elapsed;
}

async function main() {
  const args = process.argv.slice(2);
  const exe = path.resolve(argValue(args, 'exe', path.join(repository, 'release', 'win-unpacked', 'ComGu.exe')));
  const warmups = Number(argValue(args, 'warmups', '5'));
  const samples = Number(argValue(args, 'samples', '30'));
  const timeoutMs = Number(argValue(args, 'timeout-ms', '20000'));
  const out = argValue(args, 'out', undefined);
  if (!Number.isInteger(warmups) || warmups < 0 || !Number.isInteger(samples) || samples < 1) {
    throw new Error('warmups must be >= 0 and samples must be >= 1');
  }

  const runRoot = await fs.mkdtemp(path.join(tmpdir(), 'comgu-mcp-benchmark-'));
  const workspace = path.join(runRoot, 'workspace');
  const userData = path.join(runRoot, 'user-data');
  const endpointMarker = path.join(runRoot, 'endpoint.json');
  await fs.mkdir(userData, { recursive: true });
  const fixture = await createSearchFixture(workspace);
  await fs.writeFile(path.join(userData, 'config.json'), `${JSON.stringify(benchmarkConfig(workspace), null, 2)}\n`, 'utf8');
  const stateDir = path.join(userData, 'state');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, 'chat-workspace-scopes.json'),
    `${JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      entries: [
        {
          conversationId: BENCHMARK_CONVERSATION_ID,
          scope: {
            primaryRoot: 'fixture',
            sharedRoots: [],
            rootIdentities: [{ name: 'fixture', path: workspace }]
          }
        }
      ]
    })}\n`,
    'utf8'
  );
  await fs.writeFile(
    path.join(stateDir, 'request-correlations.json'),
    `${JSON.stringify({
      version: 4,
      entries: [
        {
          requestId: BENCHMARK_REQUEST_ID,
          value: {
            requestId: BENCHMARK_REQUEST_ID,
            conversationId: BENCHMARK_CONVERSATION_ID,
            sessionId: 'perfbench01',
            messageId: 'perf-benchmark-message',
            tool: 'find',
            observedAt: Date.now()
          },
          conflicted: false
        }
      ]
    })}\n`,
    'utf8'
  );

  const child = spawn(exe, [`--user-data-dir=${userData}`], {
    env: { ...process.env, COMGU_PERF_MCP_ENDPOINT_FILE: endpointMarker },
    stdio: 'ignore',
    windowsHide: true
  });

  try {
    const endpoint = await waitForJson(endpointMarker, timeoutMs);
    if (!endpoint?.url || typeof endpoint.url !== 'string') throw new Error('Packaged app wrote an invalid MCP endpoint marker');

    for (let index = 0; index < warmups; index += 1) await measureDiscovery(endpoint.url);
    const discoverySamples = [];
    for (let index = 0; index < samples; index += 1) discoverySamples.push(await measureDiscovery(endpoint.url));

    const searchSamples = [];
    await withClient(endpoint.url, async (client) => {
      await client.listTools(undefined, { cacheMode: 'refresh' });
      for (let index = 0; index < warmups; index += 1) {
        await measureFind(client, fixture.queries[index % fixture.queries.length]);
      }
      for (let index = 0; index < samples; index += 1) {
        searchSamples.push(await measureFind(client, fixture.queries[index % fixture.queries.length]));
      }
    });

    const result = {
      executable: exe,
      fixtureBytes: fixture.totalBytes,
      warmups,
      samples,
      discoveryMs: { ...metricStats(discoverySamples), samplesMs: discoverySamples },
      exactSearchMs: { ...metricStats(searchSamples), samplesMs: searchSamples }
    };
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (out) await fs.writeFile(out, json, 'utf8');
    console.log(json.trim());
  } finally {
    terminateTree(child.pid);
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
    await fs.rm(runRoot, { recursive: true, force: true });
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
