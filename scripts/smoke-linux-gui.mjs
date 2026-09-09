import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (process.platform !== 'linux') {
  throw new Error(`smoke-linux-gui.mjs must run on Linux, got ${process.platform}`);
}

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key ?? '(end)'}`);
  args.set(key.slice(2), value);
}

const label = args.get('label') ?? 'linux';
const executable = args.get('executable');
if (!executable) throw new Error('--executable is required');
if (!existsSync(executable)) throw new Error(`Could not find ${label} executable: ${executable}`);

const suppliedSmokeRoot = args.get('smoke-root');
const smokeRoot = suppliedSmokeRoot
  ? path.resolve(suppliedSmokeRoot)
  : mkdtempSync(path.join(tmpdir(), 'comgu-linux-gui-'));
const ownsSmokeRoot = !suppliedSmokeRoot;
for (const dir of ['home', 'config', 'cache', 'data', 'state']) {
  mkdirSync(path.join(smokeRoot, dir), { recursive: true });
}

const child = spawn('xvfb-run', ['-a', executable], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    HOME: path.join(smokeRoot, 'home'),
    XDG_CONFIG_HOME: path.join(smokeRoot, 'config'),
    XDG_CACHE_HOME: path.join(smokeRoot, 'cache'),
    XDG_DATA_HOME: path.join(smokeRoot, 'data'),
    XDG_STATE_HOME: path.join(smokeRoot, 'state'),
    CLF_DEBUG: '1',
    ...(args.get('path') ? { PATH: args.get('path') } : {})
  }
});

let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

let exitResult;
const exitPromise = new Promise((resolve) => {
  child.once('exit', (code, signal) => {
    exitResult = { code, signal };
    resolve(exitResult);
  });
});

const startedAt = Date.now();
const startupDeadlineMs = 30_000;
const minimumSurvivalMs = 5_000;

let startupError = null;
try {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      child.off('error', onError);
      child.off('exit', onExit);
      error ? reject(error) : resolve();
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) =>
      finish(new Error(`${label} GUI exited before startup proof completed: code=${code} signal=${signal}`));
    const startupFailure = () => {
      if (output.includes('[error] window failed to load')) return 'the BrowserWindow reported a load failure';
      if (output.includes('[error] renderer:')) return 'the renderer reported a console error';
      return null;
    };
    const ready = () =>
      output.includes('[info] app started') &&
      output.includes('[info] window loaded') &&
      output.includes('[info] renderer state ready') &&
      Date.now() - startedAt >= minimumSurvivalMs;

    child.on('error', onError);
    child.on('exit', onExit);
    const poll = setInterval(() => {
      const failure = startupFailure();
      if (failure) finish(new Error(`${label} GUI startup failed: ${failure}`));
      else if (ready()) finish();
    }, 50);
    const deadline = setTimeout(() => {
      const failure = startupFailure();
      if (failure) finish(new Error(`${label} GUI startup failed: ${failure}`));
      else if (ready()) finish();
      else finish(new Error(`${label} GUI did not report app started, window loaded and renderer state ready within 30 seconds`));
    }, startupDeadlineMs);
  });
} catch (error) {
  startupError = error;
}

async function terminateChild() {
  if (exitResult) return true;
  child.kill('SIGTERM');
  let exited = await Promise.race([
    exitPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000))
  ]);
  if (!exited) {
    child.kill('SIGKILL');
    exited = await Promise.race([
      exitPromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 3_000))
    ]);
  }
  return exited;
}

const exited = await terminateChild();
process.stdout.write(output);
if (ownsSmokeRoot) rmSync(smokeRoot, { recursive: true, force: true });
if (startupError) {
  if (!exited) startupError.message += '; child also resisted SIGTERM/SIGKILL';
  throw startupError;
}
if (!exited) throw new Error(`${label} GUI process did not terminate after SIGTERM/SIGKILL`);
process.stdout.write(`linux-gui-startup-ok label=${label} exit=${exitResult?.code ?? 'null'} signal=${exitResult?.signal ?? 'null'}\n`);
