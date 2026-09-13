import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stage(arch: 'x64' | 'arm64'): string {
  execFileSync(process.execPath, ['scripts/prepare-packaging-native.mjs', '--platform', 'win32', '--arch', arch], {
    cwd: root,
    stdio: 'pipe'
  });
  return path.join(root, 'resources', 'packaging', 'native', 'win32', arch, 'node_modules', '@microsoft', 'mxc-sdk');
}

describe('target-only MXC packaging payload', () => {
  it.each(['x64', 'arm64'] as const)('keeps only the %s runtime architecture', (arch) => {
    const staged = stage(arch);
    expect(existsSync(path.join(staged, 'package.json'))).toBe(true);
    expect(existsSync(path.join(staged, 'LICENSE.md'))).toBe(true);
    expect(existsSync(path.join(staged, 'bin', arch, 'wxc-exec.exe'))).toBe(true);
    expect(existsSync(path.join(staged, 'bin', arch, 'wxc-host-prep.exe'))).toBe(true);

    const binRoot = path.join(staged, 'bin');
    expect(readdirSync(binRoot).sort()).toEqual([arch]);
    expect(existsSync(path.join(staged, 'bin', arch === 'x64' ? 'arm64' : 'x64'))).toBe(false);

    const metadata = JSON.parse(readFileSync(path.join(staged, 'package.json'), 'utf8'));
    expect(metadata.name).toBe('@microsoft/mxc-sdk');
    expect(metadata.version).toBe('0.8.0');
  }, 90_000);
});
