import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

import {
  assetNameForTarget,
  installRelease,
  normalizeVersion,
  parseSha256Sums,
  verifySha256
} from '../packages/comgu-cli/lib/install.mjs';
import { resolveCliTarget } from '../packages/comgu-cli/lib/platform.mjs';

describe('ComGu CLI installer core', () => {
  it('maps supported platform and architecture pairs', () => {
    expect(resolveCliTarget('win32', 'x64')).toBe('win32-x64');
    expect(resolveCliTarget('win32', 'arm64')).toBe('win32-arm64');
    expect(resolveCliTarget('linux', 'x64')).toBe('linux-x64');
    expect(resolveCliTarget('linux', 'arm64')).toBe('linux-arm64');
    expect(() => resolveCliTarget('darwin', 'arm64')).toThrow(/unsupported/i);
  });

  it('maps targets to release artifact names', () => {
    expect(assetNameForTarget('win32-x64')).toBe('ComGu-CLI-windows-x64.zip');
    expect(assetNameForTarget('win32-arm64')).toBe('ComGu-CLI-windows-arm64.zip');
    expect(assetNameForTarget('linux-x64')).toBe('ComGu-CLI-linux-x64.tar.gz');
    expect(assetNameForTarget('linux-arm64')).toBe('ComGu-CLI-linux-arm64.tar.gz');
  });

  it('normalizes exact versions to tags', () => {
    expect(normalizeVersion('3.2.0')).toEqual({ version: '3.2.0', tag: 'v3.2.0' });
    expect(normalizeVersion('v3.2.0')).toEqual({ version: '3.2.0', tag: 'v3.2.0' });
    expect(() => normalizeVersion('latest')).toThrow(/exact semantic version/i);
  });

  it('parses strict SHA256SUMS entries', () => {
    const hash = 'a'.repeat(64);
    const parsed = parseSha256Sums(`${hash}  ComGu-CLI-linux-x64.tar.gz\n`);
    expect(parsed.get('ComGu-CLI-linux-x64.tar.gz')).toBe(hash);
    expect(() => parseSha256Sums(`not-a-hash  bad.zip\n`)).toThrow(/malformed/i);
  });

  it('refuses a checksum mismatch', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-installer-test-'));
    const file = path.join(dir, 'payload.bin');
    await fs.writeFile(file, 'trusted-bytes', 'utf8');
    const actual = createHash('sha256').update('trusted-bytes').digest('hex');
    await expect(verifySha256(file, actual)).resolves.toBe(actual);
    await expect(verifySha256(file, '0'.repeat(64))).rejects.toThrow(/checksum mismatch/i);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const hostIt = process.platform === 'win32' || process.platform === 'linux' ? it : it.skip;
  hostIt('installs a verified local fixture atomically without touching profile data', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comgu-installer-integration-'));
    const releaseRoot = path.join(dir, 'release', 'v3.2.0');
    const fixture = path.join(dir, 'fixture', 'ComGu-CLI');
    const installRoot = path.join(dir, 'install');
    const profileSentinel = path.join(dir, 'profile-data-must-survive');
    await fs.mkdir(releaseRoot, { recursive: true });
    await fs.mkdir(fixture, { recursive: true });
    await fs.writeFile(profileSentinel, 'keep', 'utf8');

    const target = resolveCliTarget(process.platform, process.arch);
    const asset = assetNameForTarget(target);
    if (process.platform === 'win32') {
      await fs.writeFile(path.join(fixture, 'comgu.cmd'), '@echo off\r\necho fixture\r\n', 'utf8');
      execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${path.join(dir, 'fixture').replace(/'/g, "''")}\\*' -DestinationPath '${path.join(releaseRoot, asset).replace(/'/g, "''")}' -Force`]);
    } else {
      const launcher = path.join(fixture, 'comgu');
      await fs.writeFile(launcher, '#!/bin/sh\necho fixture\n', { encoding: 'utf8', mode: 0o755 });
      execFileSync('tar', ['-czf', path.join(releaseRoot, asset), '-C', path.join(dir, 'fixture'), 'ComGu-CLI']);
    }
    const archive = await fs.readFile(path.join(releaseRoot, asset));
    const hash = createHash('sha256').update(archive).digest('hex');
    await fs.writeFile(path.join(releaseRoot, 'SHA256SUMS.txt'), `${hash}  ${asset}\n`, 'utf8');

    const originalFetch = globalThis.fetch;
    const fileFetch = async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      const relative = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
      try {
        const body = await fs.readFile(path.join(dir, relative));
        return new Response(body, { status: 200 });
      } catch {
        return new Response('not found', { status: 404 });
      }
    };
    const result = await installRelease({
      version: '3.2.0', installRoot, channel: 'test',
      releaseBaseUrl: 'https://fixture.invalid/release', fetchImpl: fileFetch as typeof originalFetch
    });
    expect(result.version).toBe('3.2.0');
    expect(await fs.readFile(profileSentinel, 'utf8')).toBe('keep');
    expect(JSON.parse(await fs.readFile(path.join(installRoot, 'install.json'), 'utf8'))).toMatchObject({ sha256: hash, channel: 'test' });
    await fs.access(result.launcher);

    const badRelease = path.join(dir, 'release', 'v3.2.1');
    await fs.mkdir(badRelease, { recursive: true });
    await fs.copyFile(path.join(releaseRoot, asset), path.join(badRelease, asset));
    await fs.writeFile(path.join(badRelease, 'SHA256SUMS.txt'), `${'0'.repeat(64)}  ${asset}\n`, 'utf8');
    await expect(installRelease({
      version: '3.2.1', installRoot, channel: 'test',
      releaseBaseUrl: 'https://fixture.invalid/release', fetchImpl: fileFetch as typeof originalFetch
    })).rejects.toThrow(/checksum mismatch/i);
    expect(JSON.parse(await fs.readFile(path.join(installRoot, 'install.json'), 'utf8'))).toMatchObject({ version: '3.2.0', sha256: hash });
    await fs.access(result.launcher);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
