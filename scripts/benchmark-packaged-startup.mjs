import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(args, name, fallback) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function percentile(samples, p) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function stats(samples) {
  if (samples.length === 0) return { min: null, median: null, max: null, samples: [] };
  return {
    min: Math.min(...samples),
    median: percentile(samples, 50),
    max: Math.max(...samples),
    samples
  };
}

async function waitForJson(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for ready marker: ${file}`);
}

function workingSetBytes(pid) {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).WorkingSet64`],
      { encoding: 'utf8', windowsHide: true }
    );
    if (result.status !== 0) throw new Error(result.stderr?.trim() || `Get-Process failed for ${pid}`);
    const bytes = Number(result.stdout.trim());
    if (!Number.isFinite(bytes)) throw new Error(`Invalid WorkingSet64 for ${pid}: ${result.stdout}`);
    return bytes;
  }
  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `ps failed for ${pid}`);
  return Number(result.stdout.trim()) * 1024;
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

async function runOnce({ exe, runRoot, index, sampleMemory, idleMs, timeoutMs }) {
  const userData = path.join(runRoot, `user-data-${index}`);
  const marker = path.join(runRoot, `ready-${index}.json`);
  await fs.mkdir(userData, { recursive: true });
  const startedAtEpochMs = Date.now();
  const child = spawn(exe, [`--user-data-dir=${userData}`], {
    env: {
      ...process.env,
      COMGU_PERF_MARKER_FILE: marker
    },
    stdio: 'ignore',
    windowsHide: true
  });

  let startupMs;
  let rssBytes = null;
  try {
    const ready = await waitForJson(marker, timeoutMs);
    if (ready.pid !== child.pid) {
      throw new Error(`Ready marker PID ${ready.pid} did not match launched PID ${child.pid}`);
    }
    startupMs = ready.readyAtEpochMs - startedAtEpochMs;
    if (sampleMemory) {
      await delay(idleMs);
      rssBytes = workingSetBytes(child.pid);
    }
  } finally {
    terminateTree(child.pid);
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(5_000)
    ]);
  }

  return { index, pid: child.pid, startupMs, rssBytes };
}

async function main() {
  const args = process.argv.slice(2);
  const exe = path.resolve(argValue(args, 'exe', path.join('release', 'win-unpacked', 'ComGu.exe')));
  const runs = Number(argValue(args, 'runs', '10'));
  const memoryRuns = Number(argValue(args, 'memory-runs', '5'));
  const idleMs = Number(argValue(args, 'idle-ms', '30000'));
  const timeoutMs = Number(argValue(args, 'timeout-ms', '20000'));
  const out = argValue(args, 'out', undefined);
  if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(memoryRuns) || memoryRuns < 0 || memoryRuns > runs) {
    throw new Error('runs must be >= 1 and memory-runs must be between 0 and runs');
  }

  const runRoot = await fs.mkdtemp(path.join(tmpdir(), 'comgu-packaged-startup-'));
  const samples = [];
  try {
    for (let index = 0; index < runs; index += 1) {
      const sample = await runOnce({
        exe,
        runRoot,
        index,
        sampleMemory: index < memoryRuns,
        idleMs,
        timeoutMs
      });
      samples.push(sample);
      console.log(`run=${index + 1}/${runs} startup_ms=${sample.startupMs} rss_bytes=${sample.rssBytes ?? 'n/a'}`);
    }
  } finally {
    await fs.rm(runRoot, { recursive: true, force: true });
  }

  const startup = samples.map((sample) => sample.startupMs);
  const rss = samples.filter((sample) => sample.rssBytes !== null).map((sample) => sample.rssBytes);
  const result = {
    executable: exe,
    runs,
    memoryRuns,
    idleMs,
    startupMs: stats(startup),
    idleRssBytes: stats(rss),
    samples
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (out) await fs.writeFile(out, json, 'utf8');
  console.log(json.trim());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
