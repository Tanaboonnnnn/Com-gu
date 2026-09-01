import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  UpdateArch,
  UpdateAsset,
  UpdateCheckResult,
  UpdateDownloadResult
} from '../shared/types.js';

const RELEASE_API = 'https://api.github.com/repos/Tanaboonnnnn/Com-gu/releases/latest';
const CHECKSUM_ASSET = 'SHA256SUMS.txt';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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

export function installerAssetName(arch: UpdateArch): string {
  return `ComGu-Setup-${arch}.exe`;
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
  arch: UpdateArch;
  fetcher?: Fetcher;
}): Promise<UpdateCheckResult> {
  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ComGu-Updater' }
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const release = (await response.json()) as GitHubRelease;
    if (release.draft === true || release.prerelease === true) throw new Error('unstable release');
    if (typeof release.tag_name !== 'string') throw new Error('missing release tag');
    const latestVersion = release.tag_name.startsWith('v') ? release.tag_name.slice(1) : release.tag_name;
    const isNewer = newerThan(latestVersion, options.currentVersion);
    if (isNewer === null) throw new Error('invalid semver');
    if (!isNewer) {
      return { status: 'current', currentVersion: options.currentVersion, latestVersion };
    }

    const assets = releaseAssets(release.assets);
    if (!assets || !exactAsset(assets, installerAssetName(options.arch)) || !exactAsset(assets, CHECKSUM_ASSET)) {
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
      assets: [exactAsset(assets, installerAssetName(options.arch))!, exactAsset(assets, CHECKSUM_ASSET)!]
    };
  } catch {
    return { status: 'error', currentVersion: options.currentVersion, message: 'Update check failed.' };
  }
}

export async function downloadUpdate(options: {
  arch: UpdateArch;
  version: string;
  assets: UpdateAsset[];
  stagingDir: string;
  fetcher?: Fetcher;
}): Promise<UpdateDownloadResult> {
  const installerName = installerAssetName(options.arch);
  const installerAsset = exactAsset(options.assets, installerName);
  const checksumAsset = exactAsset(options.assets, CHECKSUM_ASSET);
  if (!installerAsset || !checksumAsset) return { status: 'error', message: 'Release assets are incomplete.' };

  const fetcher = options.fetcher ?? fetch;
  const installerPath = join(options.stagingDir, installerName);
  try {
    const [installerResponse, checksumResponse] = await Promise.all([
      fetcher(installerAsset.url),
      fetcher(checksumAsset.url)
    ]);
    if (!installerResponse.ok || !checksumResponse.ok) throw new Error('download failed');
    const installer = Buffer.from(await installerResponse.arrayBuffer());
    const checksumText = await checksumResponse.text();
    const expected = checksumFor(checksumText, installerName);
    if (!expected) throw new Error('checksum missing');
    const actual = createHash('sha256').update(installer).digest('hex');
    if (actual !== expected) {
      await rm(installerPath, { force: true });
      return { status: 'error', message: 'Downloaded installer failed SHA-256 verification.' };
    }
    await mkdir(options.stagingDir, { recursive: true });
    await writeFile(installerPath, installer, { flag: 'w' });
    return { status: 'downloaded', version: options.version, installerPath, sha256: actual };
  } catch {
    await rm(installerPath, { force: true }).catch(() => undefined);
    return { status: 'error', message: 'Update download failed.' };
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
  const installer = await readFile(options.installerPath);
  const actual = createHash('sha256').update(installer).digest('hex');
  if (actual !== options.sha256.toLowerCase()) throw new Error('Staged installer failed SHA-256 verification.');
  await options.launch(options.installerPath);
}
