import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  checkForUpdate,
  downloadUpdate,
  installerAssetName,
  installDownloadedUpdate,
  resolveUpdateTarget
} from '../src/main/updater.js';

const RELEASE_URL = 'https://github.com/Tanaboonnnnn/Com-gu/releases/tag/v2.1.0';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function release(assets: Array<{ name: string; browser_download_url: string }>, prerelease = false) {
  return {
    tag_name: 'v2.1.0',
    html_url: RELEASE_URL,
    name: 'ComGu 2.1.0',
    body: 'Stable release notes',
    draft: false,
    prerelease,
    assets
  };
}

describe('updater core', () => {
  it('maps each supported host to the exact release asset users can install', () => {
    expect(installerAssetName({ platform: 'win32', arch: 'x64' })).toBe('ComGu-Setup-x64.exe');
    expect(installerAssetName({ platform: 'win32', arch: 'arm64' })).toBe('ComGu-Setup-arm64.exe');
    expect(installerAssetName({ platform: 'darwin', arch: 'arm64' })).toBe('ComGu-macOS-arm64.dmg');
    expect(installerAssetName({ platform: 'linux', arch: 'x64', linuxFormat: 'deb' })).toBe('ComGu-Linux-x64.deb');
    expect(installerAssetName({ platform: 'linux', arch: 'arm64', linuxFormat: 'appimage' })).toBe('ComGu-Linux-arm64.AppImage');
  });

  it('derives a safe updater target from the host and Linux package form', () => {
    expect(resolveUpdateTarget('win32', 'x64', {})).toEqual({ platform: 'win32', arch: 'x64' });
    expect(resolveUpdateTarget('darwin', 'arm64', {})).toEqual({ platform: 'darwin', arch: 'arm64' });
    expect(resolveUpdateTarget('darwin', 'x64', {})).toBeNull();
    expect(resolveUpdateTarget('linux', 'x64', { APPIMAGE: '/opt/ComGu.AppImage' })).toEqual({ platform: 'linux', arch: 'x64', linuxFormat: 'appimage' });
    expect(resolveUpdateTarget('linux', 'arm64', {})).toEqual({ platform: 'linux', arch: 'arm64', linuxFormat: 'deb' });
    expect(resolveUpdateTarget('freebsd', 'x64', {})).toBeNull();
  });

  it('reports a newer stable release without downloading anything', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        release([
          { name: 'ComGu-Setup-x64.exe', browser_download_url: 'https://download/x64' },
          { name: 'ComGu-Setup-arm64.exe', browser_download_url: 'https://download/arm64' },
          { name: 'SHA256SUMS.txt', browser_download_url: 'https://download/sums' }
        ])
      )
    );

    const result = await checkForUpdate({ currentVersion: '2.0.2', target: { platform: 'win32', arch: 'x64' }, fetcher });

    expect(result).toEqual({
      status: 'available',
      currentVersion: '2.0.2',
      latestVersion: '2.1.0',
      releaseName: 'ComGu 2.1.0',
      releaseNotes: 'Stable release notes',
      releaseUrl: RELEASE_URL,
      assets: [
        { name: 'ComGu-Setup-x64.exe', url: 'https://download/x64' },
        { name: 'SHA256SUMS.txt', url: 'https://download/sums' }
      ]
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports current when the stable release is not newer by semver', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ ...release([]), tag_name: 'v2.0.2' })
    );

    await expect(checkForUpdate({ currentVersion: '2.0.2', target: { platform: 'win32', arch: 'x64' }, fetcher })).resolves.toEqual({
      status: 'current',
      currentVersion: '2.0.2',
      latestVersion: '2.0.2'
    });
  });

  it('fails closed when the exact architecture installer is missing or duplicated', async () => {
    for (const assets of [
      [{ name: 'ComGu-Setup-arm64.exe', browser_download_url: 'https://download/arm64' }],
      [
        { name: 'ComGu-Setup-x64.exe', browser_download_url: 'https://download/one' },
        { name: 'ComGu-Setup-x64.exe', browser_download_url: 'https://download/two' }
      ]
    ]) {
      const fetcher = vi.fn(async () => jsonResponse(release(assets)));
      const result = await checkForUpdate({ currentVersion: '2.0.2', target: { platform: 'win32', arch: 'x64' }, fetcher });
      expect(result.status).toBe('error');
    }
  });

  it('turns GitHub/network failures into safe error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    });

    const result = await checkForUpdate({ currentVersion: '2.0.2', target: { platform: 'win32', arch: 'x64' }, fetcher });
    expect(result).toEqual({ status: 'error', currentVersion: '2.0.2', message: 'Update check failed.' });
  });

  it('downloads only the exact installer and checksum manifest, then verifies SHA-256', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'comgu-updater-'));
    const installer = Buffer.from('installer bytes');
    const digest = createHash('sha256').update(installer).digest('hex');
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/x64')) return new Response(installer);
      if (url.endsWith('/sums')) return new Response(`${digest}  ComGu-Setup-x64.exe\n`);
      throw new Error(`unexpected ${url}`);
    });

    const downloaded = await downloadUpdate({
      target: { platform: 'win32', arch: 'x64' },
      version: '2.1.0',
      assets: [
        { name: 'ComGu-Setup-x64.exe', url: 'https://download/x64' },
        { name: 'ComGu-Setup-arm64.exe', url: 'https://download/arm64' },
        { name: 'SHA256SUMS.txt', url: 'https://download/sums' }
      ],
      stagingDir: dir,
      fetcher
    });

    expect(downloaded.status).toBe('downloaded');
    if (downloaded.status !== 'downloaded') throw new Error('expected downloaded');
    expect(await readFile(downloaded.installerPath)).toEqual(installer);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('deletes/refuses a staged installer whose checksum does not match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'comgu-updater-'));
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/x64')
        ? new Response('tampered')
        : new Response(`${'0'.repeat(64)}  ComGu-Setup-x64.exe\n`)
    );

    const result = await downloadUpdate({
      target: { platform: 'win32', arch: 'x64' },
      version: '2.1.0',
      assets: [
        { name: 'ComGu-Setup-x64.exe', url: 'https://download/x64' },
        { name: 'SHA256SUMS.txt', url: 'https://download/sums' }
      ],
      stagingDir: dir,
      fetcher
    });

    expect(result).toEqual({ status: 'error', message: 'Downloaded installer failed SHA-256 verification.' });
  });

  it('re-verifies the staged installer before an explicit install launch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'comgu-updater-'));
    const path = join(dir, 'ComGu-Setup-x64.exe');
    await writeFile(path, 'verified');
    const sha256 = createHash('sha256').update('verified').digest('hex');
    const launch = vi.fn(async () => undefined);

    await installDownloadedUpdate({ installerPath: path, sha256, launch });

    expect(launch).toHaveBeenCalledWith(path);
  });

  it('refuses launch if a verified staged installer was changed afterward', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'comgu-updater-'));
    const path = join(dir, 'ComGu-Setup-x64.exe');
    const sha256 = createHash('sha256').update('verified').digest('hex');
    await writeFile(path, 'tampered later');
    const launch = vi.fn(async () => undefined);

    await expect(installDownloadedUpdate({ installerPath: path, sha256, launch })).rejects.toThrow(
      'Staged installer failed SHA-256 verification.'
    );
    expect(launch).not.toHaveBeenCalled();
  });
});
