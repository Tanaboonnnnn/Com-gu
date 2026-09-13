import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveCliTarget } from './platform.mjs';

const REPOSITORY = 'Tanaboonnnnn/Com-gu';
const TARGET_ASSETS = Object.freeze({
  'win32-x64': 'ComGu-CLI-windows-x64.zip',
  'win32-arm64': 'ComGu-CLI-windows-arm64.zip',
  'linux-x64': 'ComGu-CLI-linux-x64.tar.gz',
  'linux-arm64': 'ComGu-CLI-linux-arm64.tar.gz'
});

export function assetNameForTarget(target) {
  const asset = TARGET_ASSETS[target];
  if (!asset) throw new Error(`Unsupported ComGu CLI target: ${target}`);
  return asset;
}

export function normalizeVersion(input) {
  const text = String(input ?? '').trim();
  const match = text.match(/^v?(\d+\.\d+\.\d+)$/);
  if (!match) throw new Error(`Expected an exact semantic version such as 3.2.0; received ${text || '<empty>'}`);
  return { version: match[1], tag: `v${match[1]}` };
}

export function parseSha256Sums(text) {
  const result = new Map();
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?([^\\/]+)$/);
    if (!match) throw new Error(`Malformed SHA256SUMS line: ${rawLine}`);
    result.set(match[2], match[1].toLowerCase());
  }
  if (result.size === 0) throw new Error('Malformed SHA256SUMS: no checksum entries');
  return result;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export async function verifySha256(file, expected) {
  if (!/^[a-fA-F0-9]{64}$/.test(expected)) throw new Error('Expected SHA-256 must be 64 hexadecimal characters');
  const actual = await sha256File(file);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${path.basename(file)}: expected ${expected}, got ${actual}`);
  }
  return actual;
}

export function releaseAssetUrl(tag, filename, repository = REPOSITORY) {
  return `https://github.com/${repository}/releases/download/${tag}/${filename}`;
}

export async function downloadFile(url, destination, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, bytes, { flag: 'wx' });
  return destination;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `exit ${code}`}`));
    });
  });
}

export async function extractCliArchive(archive, target, destination) {
  await fs.mkdir(destination, { recursive: true });
  if (target.startsWith('win32-')) {
    const escapedArchive = archive.replace(/'/g, "''");
    const escapedDestination = destination.replace(/'/g, "''");
    await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`]);
  } else {
    await run('tar', ['-xzf', archive, '-C', destination]);
  }
  return destination;
}

export function packagedLauncher(payloadDir, target) {
  return path.join(payloadDir, 'ComGu-CLI', target.startsWith('win32-') ? 'comgu.cmd' : 'comgu');
}

export async function installRelease({
  version,
  platform = process.platform,
  arch = process.arch,
  installRoot,
  channel = 'npm',
  repository = REPOSITORY,
  releaseBaseUrl = null,
  fetchImpl = fetch
}) {
  const normalized = normalizeVersion(version);
  const target = resolveCliTarget(platform, arch);
  const asset = assetNameForTarget(target);
  const root = path.resolve(installRoot);
  const versionsDir = path.join(root, 'versions');
  const finalDir = path.join(versionsDir, normalized.version);
  const statePath = path.join(root, 'install.json');
  await fs.mkdir(versionsDir, { recursive: true });

  const existingLauncher = packagedLauncher(finalDir, target);
  try {
    await fs.access(existingLauncher);
    return { version: normalized.version, tag: normalized.tag, target, asset, payloadDir: finalDir, launcher: existingLauncher, reused: true };
  } catch {}

  const tempRoot = await fs.mkdtemp(path.join(root, `.install-${normalized.version}-`));
  const archivePath = path.join(tempRoot, asset);
  const sumsPath = path.join(tempRoot, 'SHA256SUMS.txt');
  const staging = path.join(tempRoot, 'payload');
  try {
    const base = releaseBaseUrl ? `${releaseBaseUrl.replace(/\/$/, '')}/${normalized.tag}` : `https://github.com/${repository}/releases/download/${normalized.tag}`;
    await downloadFile(`${base}/SHA256SUMS.txt`, sumsPath, fetchImpl);
    const sums = parseSha256Sums(await fs.readFile(sumsPath, 'utf8'));
    const expected = sums.get(asset);
    if (!expected) throw new Error(`SHA256SUMS.txt has no entry for ${asset}`);
    await downloadFile(`${base}/${asset}`, archivePath, fetchImpl);
    const actual = await verifySha256(archivePath, expected);
    await extractCliArchive(archivePath, target, staging);
    const stagedLauncher = packagedLauncher(staging, target);
    await fs.access(stagedLauncher);

    try {
      await fs.rename(staging, finalDir);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const launcher = packagedLauncher(finalDir, target);
    await fs.access(launcher);
    const state = {
      version: normalized.version,
      tag: normalized.tag,
      artifact: asset,
      sha256: actual,
      channel,
      platform,
      arch,
      installedAt: new Date().toISOString()
    };
    const stateTemp = `${statePath}.tmp-${process.pid}`;
    await fs.writeFile(stateTemp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(stateTemp, statePath);
    return { ...state, target, payloadDir: finalDir, launcher, reused: false };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function removeInstallerPayload(installRoot) {
  await fs.rm(path.resolve(installRoot), { recursive: true, force: true });
}

export function defaultNpmInstallRoot(packageRoot) {
  return path.join(packageRoot, '.payload');
}

export function defaultUserInstallRoot(platform = process.platform) {
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'ComGu', 'CLI');
  }
  return path.join(os.homedir(), '.local', 'share', 'comgu-cli');
}
