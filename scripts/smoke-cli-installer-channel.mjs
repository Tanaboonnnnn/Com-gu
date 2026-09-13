import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const artifactArg = process.argv.indexOf('--artifact');
if (artifactArg < 0 || !process.argv[artifactArg + 1]) throw new Error('Usage: node scripts/smoke-cli-installer-channel.mjs --artifact <path>');
const artifact = path.resolve(process.argv[artifactArg + 1]);
const asset = path.basename(artifact);
const bytes = await fs.readFile(artifact);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const tag = `v${pkg.version}`;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-install-channel-'));
const installRoot = path.join(temp, 'install');
const binDir = path.join(temp, 'bin');
const profileSentinel = path.join(temp, 'profile-must-survive');
await fs.writeFile(profileSentinel, 'keep', 'utf8');

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === `/${tag}/SHA256SUMS.txt`) {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(`${sha256}  ${asset}\n`);
    return;
  }
  if (pathname === `/${tag}/${asset}`) {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(bytes);
    return;
  }
  response.writeHead(404);
  response.end('not found');
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Failed to bind installer fixture server');
const baseUrl = `http://127.0.0.1:${address.port}`;

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'pipe', windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${command} failed (${signal ?? code})\n${stdout}\n${stderr}`));
    });
  });
}

async function waitForMissing(target, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(target);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for installer-owned path removal: ${target}`);
}

try {
  const env = {
    ...process.env,
    COMGU_VERSION: pkg.version,
    COMGU_INSTALL_ROOT: installRoot,
    COMGU_BIN_DIR: binDir,
    COMGU_INSTALLER_TEST_BASE_URL: baseUrl
  };
  if (process.platform === 'win32') {
    await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'install.ps1')], env);
    const command = path.join(binDir, 'comgu.cmd');
    const version = await run('cmd.exe', ['/d', '/s', '/c', command, '--version'], env);
    if (version.stdout.trim() !== pkg.version) throw new Error(`Installed CLI reported ${version.stdout.trim()}, expected ${pkg.version}`);
    await run('cmd.exe', ['/d', '/s', '/c', command, 'uninstall'], env);
    await waitForMissing(installRoot);
    await waitForMissing(command);
  } else if (process.platform === 'linux') {
    await run('sh', [path.join(root, 'install.sh')], env);
    const command = path.join(binDir, 'comgu');
    const version = await run(command, ['--version'], env);
    if (version.stdout.trim() !== pkg.version) throw new Error(`Installed CLI reported ${version.stdout.trim()}, expected ${pkg.version}`);
    await run(command, ['uninstall'], env);
    await waitForMissing(command);
  } else {
    throw new Error(`Installer channel smoke does not support ${process.platform}`);
  }
  if ((await fs.readFile(profileSentinel, 'utf8')) !== 'keep') throw new Error('Installer touched profile sentinel');
  await waitForMissing(installRoot);
  console.log(`comgu-installer-channel-smoke-ok ${process.platform}-${process.arch}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
}
