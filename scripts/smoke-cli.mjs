import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const dir = dirIndex >= 0 ? path.resolve(args[dirIndex + 1]) : null;
if (!dir) throw new Error('Usage: node scripts/smoke-cli.mjs --dir <unpacked ComGu-CLI directory>');
const entry = path.join(dir, 'bin', 'comgu.mjs');
const bundleFiles = [];
const walk = async (directory) => {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, item.name);
    if (item.isDirectory()) await walk(target);
    else if (item.isFile() && target.endsWith('.mjs')) bundleFiles.push(target);
  }
};
await walk(path.join(dir, 'bin'));
for (const file of bundleFiles) {
  const source = await fs.readFile(file, 'utf8');
  for (const forbidden of [
    'from "electron"',
    'import("electron")',
    'setAgentBinder(',
    'restoreSwarm(',
    'startBridge(',
    'BrowserWindow'
  ]) {
    if (source.includes(forbidden)) throw new Error(`CLI bundle ${path.basename(file)} unexpectedly contains ${forbidden}`);
  }
}
const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
if (manifest.dependencies?.electron || manifest.devDependencies?.electron) throw new Error('CLI package must not depend on Electron');

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-cli-smoke-'));
const run = (argv) => spawnSync(process.execPath, [entry, ...argv], { cwd: dir, encoding: 'utf8', timeout: 15_000 });
try {
  const setup = run(['setup', '--profile', profile, '--name', 'smoke-machine', '--json']);
  if (setup.status !== 0) throw new Error(`CLI setup smoke failed: ${setup.stderr}`);
  const owner = spawn(process.execPath, [entry, 'start', '--profile', profile], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    let status = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      status = run(['status', '--profile', profile, '--json']);
      if (status.status === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!status || status.status !== 0) throw new Error(`CLI owner/status smoke failed: ${status?.stderr ?? 'no response'}`);
    const parsed = JSON.parse(status.stdout);
    if (parsed.machine?.name !== 'smoke-machine' || parsed.mode !== 'cli') throw new Error('CLI status returned the wrong owner identity');
    const stop = run(['stop', '--profile', profile]);
    if (stop.status !== 0) throw new Error(`CLI stop smoke failed: ${stop.stderr}`);
    await new Promise((resolve) => owner.once('exit', resolve));
  } finally {
    if (owner.exitCode === null) owner.kill();
  }
} finally {
  await fs.rm(profile, { recursive: true, force: true });
}
console.log('comgu-cli-smoke-ok');
