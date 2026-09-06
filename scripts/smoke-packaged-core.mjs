import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RawMcpClient } from './mcp-http-client.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST_ID = 'wfr_packaged_core_smoke';
const CONVERSATION_ID = 'comgu-packaged-core-smoke-chat';
const SESSION_ID = '2026-09-06-coresmoke';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function expectedCoreTools(command) {
  return command
    ? ['read', 'view_image', 'apply_patch', 'exec_command', 'write_stdin', 'session']
    : ['read', 'view_image', 'find'];
}

export function coreSmokeConfig(root, command) {
  return {
    roots: [{ name: 'fixture', path: root }],
    capabilities: {
      browse: true,
      search: true,
      read: true,
      metadata: true,
      create: command,
      edit: command,
      move: command,
      deleteFile: command,
      command,
      screen: false,
      control: false,
      clipboardRead: false,
      clipboardWrite: false
    },
    readOnly: !command,
    browser: { preference: 'prime' },
    tunnel: { kind: 'manual', tunnelId: '', desktopTunnelId: '', binaryPath: '' },
    ui: { minimizeToTray: true, autoConnect: true, privacyScreenshots: false, theme: 'dark', locale: 'en' },
    sessions: { record: command, retainDays: 30, advisoryTokens: 400000, limitTokens: 533333 },
    compaction: { auto: true, autoTokens: 400000 },
    multiAgent: { enabled: false, maxWorkers: 2 },
    goal: {
      enabled: false,
      model: '~deepseek/deepseek-v4-flash-latest',
      reasoning: 'default',
      prompt: 'Packaged smoke placeholder that is never used.',
      objectivePrompt: 'Packaged smoke placeholder that is never used.'
    }
  };
}

function argValue(args, name, fallback) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function textOf(result) {
  return (result?.content ?? [])
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

function assertToolOk(result, label) {
  if (result?.isError) throw new Error(`${label} failed: ${textOf(result)}`);
  return result;
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
  throw new Error(`Timed out waiting for packaged Core endpoint marker ${file}`);
}

function terminateTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    // Electron owns renderer/GPU children that can outlive the browser process briefly and
    // keep the isolated userData locked. The smoke already closes its MCP client first; force
    // the launched test tree only after that protocol shutdown so repeated runs never leak a
    // packaged ComGu process into the next run.
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already exited.
  }
}

async function waitForExit(child, timeoutMs = 8_000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(timeoutMs).then(() => false)
  ]);
}

async function removeRunRoot(root) {
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      await fs.rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code) || Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
}

async function writeIdentityState(userData, workspace) {
  const state = path.join(userData, 'state');
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(
    path.join(state, 'chat-workspace-scopes.json'),
    `${JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      entries: [{
        conversationId: CONVERSATION_ID,
        scope: {
          primaryRoot: 'fixture',
          sharedRoots: [],
          rootIdentities: [{ name: 'fixture', path: workspace }]
        }
      }]
    })}\n`,
    'utf8'
  );
  await fs.writeFile(
    path.join(state, 'request-correlations.json'),
    `${JSON.stringify({
      version: 4,
      entries: [{
        requestId: REQUEST_ID,
        value: {
          requestId: REQUEST_ID,
          conversationId: CONVERSATION_ID,
          sessionId: SESSION_ID,
          messageId: 'packaged-core-smoke-message',
          tool: 'read',
          observedAt: Date.now()
        },
        conflicted: false
      }]
    })}\n`,
    'utf8'
  );
}

async function seedRecordedSession(userData) {
  const now = Date.now();
  const sessionDir = path.join(userData, 'sessions', SESSION_ID);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, 'events.jsonl'), '', 'utf8');
  await fs.writeFile(
    path.join(sessionDir, 'meta.json'),
    `${JSON.stringify({
      id: SESSION_ID,
      title: 'Packaged Core smoke',
      conversationId: CONVERSATION_ID,
      chatIds: [CONVERSATION_ID],
      startedAt: now,
      updatedAt: now,
      endedAt: null,
      events: 0,
      userMessages: 0,
      toolCalls: 0,
      errors: 0,
      estimatedTokens: 0,
      contextTokens: 0,
      autoCompactTriggeredAt: null,
      lastHandoffId: null,
      lastHandoffAt: null,
      lastCommittedResumeHandoffId: null,
      lastTurnOutcome: null,
      activeTurnId: null,
      agents: [],
      origin: null,
      __historySeq: 0
    }, null, 2)}\n`,
    'utf8'
  );
}

async function createFixture(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'fixture.txt'), 'COMGU_PACKAGED_CORE_NEEDLE\noriginal line\n', 'utf8');
  // 1x1 transparent PNG. Keeping the fixture literal avoids pulling image tooling into the smoke driver.
  await fs.writeFile(
    path.join(workspace, 'pixel.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  );
}

async function withClient(url, fn) {
  const client = new RawMcpClient(url, { 'x-request-id': `${REQUEST_ID}/smoke` });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function launchApp(exe, userData, endpointMarker, timeoutMs) {
  const child = spawn(exe, [`--user-data-dir=${userData}`], {
    env: { ...process.env, COMGU_PERF_MCP_ENDPOINT_FILE: endpointMarker },
    stdio: 'ignore',
    windowsHide: true
  });
  const endpoint = await waitForJson(endpointMarker, timeoutMs);
  if (!endpoint?.url || typeof endpoint.url !== 'string') throw new Error('Packaged app wrote an invalid Core endpoint');
  return { child, url: endpoint.url };
}

async function smokeExactSearch(exe, root, timeoutMs) {
  const userData = path.join(root, 'user-data-find');
  const workspace = path.join(root, 'workspace-find');
  const marker = path.join(root, 'endpoint-find.json');
  await fs.mkdir(userData, { recursive: true });
  await createFixture(workspace);
  await fs.writeFile(path.join(userData, 'config.json'), `${JSON.stringify(coreSmokeConfig(workspace, false), null, 2)}\n`, 'utf8');
  await writeIdentityState(userData, workspace);
  const { child, url } = await launchApp(exe, userData, marker, timeoutMs);
  try {
    await withClient(url, async (client) => {
      const listed = await client.listTools(undefined, { cacheMode: 'refresh' });
      const names = listed.tools.map((tool) => tool.name);
      if (JSON.stringify(names) !== JSON.stringify(expectedCoreTools(false))) {
        throw new Error(`Command-off Core tools were ${names.join(', ')}`);
      }
      const read = assertToolOk(await client.callTool({ name: 'read', arguments: { paths: ['/fixture/fixture.txt'] } }), 'read');
      if (!textOf(read).includes('COMGU_PACKAGED_CORE_NEEDLE')) throw new Error('read did not return fixture content');
      const found = assertToolOk(await client.callTool({ name: 'find', arguments: { query: 'COMGU_PACKAGED_CORE_NEEDLE', mode: 'content' } }), 'find');
      if (!textOf(found).includes('/fixture/fixture.txt')) throw new Error('find did not return the expected virtual path');
    });
  } finally {
    terminateTree(child.pid);
    if (!(await waitForExit(child))) throw new Error('Command-off packaged app did not exit after smoke shutdown');
  }
}

async function smokeCommandSurface(exe, root, timeoutMs) {
  const userData = path.join(root, 'user-data-command');
  const workspace = path.join(root, 'workspace-command');
  const marker = path.join(root, 'endpoint-command.json');
  await fs.mkdir(userData, { recursive: true });
  await createFixture(workspace);
  await fs.writeFile(path.join(userData, 'config.json'), `${JSON.stringify(coreSmokeConfig(workspace, true), null, 2)}\n`, 'utf8');
  await seedRecordedSession(userData);
  await writeIdentityState(userData, workspace);
  const { child, url } = await launchApp(exe, userData, marker, timeoutMs);
  try {
    await withClient(url, async (client) => {
      const listed = await client.listTools(undefined, { cacheMode: 'refresh' });
      const names = listed.tools.map((tool) => tool.name);
      if (JSON.stringify(names) !== JSON.stringify(expectedCoreTools(true))) {
        throw new Error(`Command-on Core tools were ${names.join(', ')}`);
      }

      const image = assertToolOk(await client.callTool({ name: 'view_image', arguments: { path: '/fixture/pixel.png' } }), 'view_image');
      if (!(image.content ?? []).some((item) => item?.type === 'image' && item?.mimeType === 'image/png')) {
        throw new Error('view_image did not return PNG image content');
      }

      const patch = [
        '*** Begin Patch',
        '*** Add File: /fixture/patched.txt',
        '+patched by packaged Core smoke',
        '*** End Patch'
      ].join('\n');
      assertToolOk(await client.callTool({ name: 'apply_patch', arguments: { patch } }), 'apply_patch');
      if ((await fs.readFile(path.join(workspace, 'patched.txt'), 'utf8')).trim() !== 'patched by packaged Core smoke') {
        throw new Error('apply_patch did not change the approved workspace');
      }

      const rg = assertToolOk(
        await client.callTool({
          name: 'exec_command',
          // Packaging smoke validates the result, not Codex's short-yield session behavior.
          // Under host load rg can legitimately outlive a 1s yield and return a live session.
          arguments: { cmd: 'rg COMGU_PACKAGED_CORE_NEEDLE fixture.txt', workdir: '/fixture', yield_time_ms: 30000 }
        }),
        'exec_command bundled rg'
      );
      if (!textOf(rg).includes('COMGU_PACKAGED_CORE_NEEDLE')) {
        throw new Error(`exec_command did not execute bundled rg: ${textOf(rg)}`);
      }

      const interactiveCommand = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const live = assertToolOk(
        await client.callTool({
          name: 'exec_command',
          arguments: {
            cmd: interactiveCommand,
            workdir: '/fixture',
            tty: true,
            yield_time_ms: 100
          }
        }),
        'exec_command interactive'
      );
      const sessionId = live?.structuredContent?.session_id;
      if (!Number.isInteger(sessionId)) throw new Error(`Interactive exec returned no session id: ${textOf(live)}`);
      const stdin = assertToolOk(
        await client.callTool({
          name: 'write_stdin',
          arguments: {
            session_id: sessionId,
            chars: process.platform === 'win32' ? 'echo stdin:hello\r\nexit\r\n' : 'echo stdin:hello\nexit\n',
            yield_time_ms: 1500
          }
        }),
        'write_stdin'
      );
      if (!textOf(stdin).includes('stdin:hello')) throw new Error(`write_stdin did not reach the live process: ${textOf(stdin)}`);

      assertToolOk(await client.callTool({ name: 'session', arguments: { action: 'search' } }), 'session search');
    });

    const outside = path.join(root, 'outside-canary.txt');
    await fs.writeFile(outside, 'outside-canary', 'utf8');
    await withClient(url, async (client) => {
      const escaped = await client.callTool({ name: 'read', arguments: { paths: [outside] } });
      if (!escaped?.isError && textOf(escaped).includes('outside-canary')) {
        throw new Error('Packaged Core read escaped the approved root');
      }
    });
  } finally {
    terminateTree(child.pid);
    if (!(await waitForExit(child))) throw new Error('Command-on packaged app did not exit after smoke shutdown');
  }

  const sessionsRoot = path.join(userData, 'sessions');
  const recorded = existsSync(sessionsRoot) ? await fs.readdir(sessionsRoot) : [];
  if (recorded.length === 0) throw new Error('Packaged Core smoke produced no durable session recording');
}

async function main() {
  const args = process.argv.slice(2);
  const exe = path.resolve(argValue(args, 'exe', path.join(repository, 'release', 'win-unpacked', 'ComGu.exe')));
  const timeoutMs = Number(argValue(args, 'timeout-ms', '20000'));
  const runs = Number(argValue(args, 'runs', '1'));
  if (!existsSync(exe)) throw new Error(`Packaged executable not found: ${exe}`);
  if (!Number.isInteger(runs) || runs < 1) throw new Error('runs must be a positive integer');
  const runRoot = await fs.mkdtemp(path.join(tmpdir(), 'comgu-packaged-core-smoke-'));
  try {
    for (let run = 0; run < runs; run += 1) {
      const root = path.join(runRoot, `run-${run + 1}`);
      await fs.mkdir(root, { recursive: true });
      await smokeExactSearch(exe, root, timeoutMs);
      await smokeCommandSurface(exe, root, timeoutMs);
      process.stdout.write(`packaged-core-smoke run=${run + 1}/${runs} PASS\n`);
    }
  } finally {
    await removeRunRoot(runRoot);
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
