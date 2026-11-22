import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type {
  UpdateAsset,
  UpdateTarget,
  UpdateCheckResult,
  UpdateDownloadResult
} from '../shared/types.js';

const RELEASE_API = 'https://api.github.com/repos/Tanaboonnnnn/Com-gu/releases/latest';
const CHECKSUM_ASSET = 'SHA256SUMS.txt';
const METADATA_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_RELEASE_BYTES = 2 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 64 * 1024;
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;

class UpdateDownloadError extends Error {}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function* responseChunks(response: Response, maxBytes: number, label: string): AsyncGenerator<Uint8Array> {
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    throw new UpdateDownloadError(`${label} download failed (HTTP ${response.status}).`);
  }
  const reader = response.body.getReader();
  let complete = false;
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > maxBytes) {
      throw new UpdateDownloadError(`${label} exceeds the download size limit.`);
    }
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        return;
      }
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new UpdateDownloadError(`${label} exceeds the download size limit.`);
      yield chunk.value;
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function responseText(response: Response, maxBytes: number, label: string): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of responseChunks(response, maxBytes, label)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

interface GitHubAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  name?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

export function installerAssetName(target: UpdateTarget): string {
  if (target.platform === 'win32') return `ComGu-Setup-${target.arch}.exe`;
  if (target.platform === 'darwin') return `ComGu-macOS-${target.arch}.dmg`;
  return target.linuxFormat === 'appimage'
    ? `ComGu-Linux-${target.arch}.AppImage`
    : `ComGu-Linux-${target.arch}.deb`;
}

export function resolveUpdateTarget(
  platform: string,
  arch: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): UpdateTarget | null {
  if (arch !== 'x64' && arch !== 'arm64') return null;
  if (platform === 'win32') return { platform: 'win32', arch };
  if (platform === 'darwin') return arch === 'arm64' ? { platform: 'darwin', arch: 'arm64' } : null;
  if (platform === 'linux') {
    return { platform: 'linux', arch, linuxFormat: env.APPIMAGE ? 'appimage' : 'deb' };
  }
  return null;
}

function parseSemver(value: string): [number, number, number] | null {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function newerThan(candidate: string, current: string): boolean | null {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    const candidatePart = a[i];
    const currentPart = b[i];
    if (candidatePart === undefined || currentPart === undefined) return null;
    if (candidatePart !== currentPart) return candidatePart > currentPart;
  }
  return false;
}

function exactAsset(assets: UpdateAsset[], name: string): UpdateAsset | null {
  const matches = assets.filter((asset) => asset.name === name);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function releaseAssets(value: unknown): UpdateAsset[] | null {
  if (!Array.isArray(value)) return null;
  const assets: UpdateAsset[] = [];
  for (const raw of value as GitHubAsset[]) {
    if (typeof raw?.name !== 'string' || typeof raw.browser_download_url !== 'string') return null;
    assets.push({ name: raw.name, url: raw.browser_download_url });
  }
  return assets;
}

export async function checkForUpdate(options: {
  currentVersion: string;
  target: UpdateTarget;
  fetcher?: Fetcher;
}): Promise<UpdateCheckResult> {
  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ComGu-Updater' },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS)
    });
    const release = JSON.parse(await responseText(response, MAX_RELEASE_BYTES, 'Release metadata')) as GitHubRelease;
    if (release.draft === true || release.prerelease === true) throw new Error('unstable release');
    if (typeof release.tag_name !== 'string') throw new Error('missing release tag');
    const latestVersion = release.tag_name.startsWith('v') ? release.tag_name.slice(1) : release.tag_name;
    const isNewer = newerThan(latestVersion, options.currentVersion);
    if (isNewer === null) throw new Error('invalid semver');
    if (!isNewer) {
      return { status: 'current', currentVersion: options.currentVersion, latestVersion };
    }

    const assets = releaseAssets(release.assets);
    if (!assets || !exactAsset(assets, installerAssetName(options.target)) || !exactAsset(assets, CHECKSUM_ASSET)) {
      throw new Error('release assets are ambiguous or incomplete');
    }
    if (typeof release.html_url !== 'string') throw new Error('missing release URL');
    return {
      status: 'available',
      currentVersion: options.currentVersion,
      latestVersion,
      releaseName: typeof release.name === 'string' ? release.name : release.tag_name,
      releaseNotes: typeof release.body === 'string' ? release.body : '',
      releaseUrl: release.html_url,
      assets: [exactAsset(assets, installerAssetName(options.target))!, exactAsset(assets, CHECKSUM_ASSET)!]
    };
  } catch {
    return { status: 'error', currentVersion: options.currentVersion, message: 'Update check failed.' };
  }
}

export async function downloadUpdate(options: {
  target: UpdateTarget;
  version: string;
  assets: UpdateAsset[];
  stagingDir: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}): Promise<UpdateDownloadResult> {
  const installerName = installerAssetName(options.target);
  const installerAsset = exactAsset(options.assets, installerName);
  const checksumAsset = exactAsset(options.assets, CHECKSUM_ASSET);
  if (!installerAsset || !checksumAsset) return { status: 'error', message: 'Release assets are incomplete.' };

  const fetcher = options.fetcher ?? fetch;
  const installerPath = join(options.stagingDir, installerName);
  const signal = AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  const checksumSignal = AbortSignal.any([signal, AbortSignal.timeout(METADATA_TIMEOUT_MS)]);
  let temporaryDir: string | undefined;
  let readingChecksum = true;
  let failureMessage = 'Could not read the update checksum manifest.';
  try {
    const checksumResponse = await fetcher(checksumAsset.url, { signal: checksumSignal });
    const checksumText = await responseText(checksumResponse, MAX_CHECKSUM_BYTES, 'Checksum manifest');
    readingChecksum = false;
    const expected = checksumFor(checksumText, installerName);
    if (!expected) throw new UpdateDownloadError('Checksum manifest has no unique entry for this installer.');

    failureMessage = 'Could not create the installer staging directory.';
    await mkdir(options.stagingDir, { recursive: true });
    temporaryDir = await mkdtemp(join(options.stagingDir, '.update-'));
    const temporaryPath = join(temporaryDir, installerName);
    failureMessage = 'Could not download the installer or write it to disk.';
    const installerResponse = await fetcher(installerAsset.url, { signal });
    const hash = createHash('sha256');
    async function* verifiedChunks(): AsyncGenerator<Uint8Array> {
      for await (const chunk of responseChunks(installerResponse, MAX_INSTALLER_BYTES, 'Installer')) {
        hash.update(chunk);
        yield chunk;
      }
    }
    await pipeline(Readable.from(verifiedChunks(), { objectMode: false }), createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }), { signal });
    const actual = hash.digest('hex');
    if (actual !== expected) throw new UpdateDownloadError('Downloaded installer failed SHA-256 verification.');

    failureMessage = 'Could not finalize the verified installer on disk.';
    if (options.target.platform === 'linux' && options.target.linuxFormat === 'appimage') {
      await chmod(temporaryPath, 0o755);
    }
    signal.throwIfAborted();
    await rename(temporaryPath, installerPath);
    return { status: 'downloaded', version: options.version, installerPath, sha256: actual };
  } catch (error) {
    const timedOut = signal.aborted || (readingChecksum && checksumSignal.aborted);
    return { status: 'error', message: timedOut ? 'Update download timed out.' : error instanceof UpdateDownloadError ? error.message : failureMessage };
  } finally {
    if (temporaryDir) await rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function checksumFor(manifest: string, assetName: string): string | null {
  const matches = manifest
    .split(/\r?\n/)
    .map((line) => /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .filter((match) => match[2] === assetName);
  const digest = matches.length === 1 ? matches[0]?.[1] : undefined;
  return digest ? digest.toLowerCase() : null;
}

export async function installDownloadedUpdate(options: {
  installerPath: string;
  sha256: string;
  launch: (installerPath: string) => Promise<void>;
}): Promise<void> {
  // Installation is deliberately a separate explicit action. Checks never download and downloads never launch.
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(options.installerPath)) hash.update(chunk);
  const actual = hash.digest('hex');
  if (actual !== options.sha256.toLowerCase()) throw new Error('Staged installer failed SHA-256 verification.');
  await options.launch(options.installerPath);
}
