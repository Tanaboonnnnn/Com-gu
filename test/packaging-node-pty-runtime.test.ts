import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

describe('production node-pty payload', () => {
  it('keeps Windows runtime files but drops PDB debug symbols', () => {
    execFileSync(process.execPath, ['scripts/prepare-packaging-native.mjs', '--platform', 'win32', '--arch', 'x64'], {
      cwd: root,
      stdio: 'pipe'
    });
    const staged = path.join(root, 'resources', 'packaging', 'native', 'win32', 'x64', 'node_modules', 'node-pty', 'prebuilds', 'win32-x64');
    expect(existsSync(path.join(staged, 'conpty.node'))).toBe(true);
    expect(existsSync(path.join(staged, 'conpty_console_list.node'))).toBe(true);
    expect(existsSync(path.join(staged, 'conpty', 'OpenConsole.exe'))).toBe(true);
    expect(existsSync(path.join(staged, 'conpty', 'conpty.dll'))).toBe(true);
    expect(walk(staged).filter((file) => file.toLowerCase().endsWith('.pdb'))).toEqual([]);
  });
});
