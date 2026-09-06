import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maybeParseApplyPatchForExec } from '../src/main/codex/apply-patch/invocation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stagedPackage(name: string): string {
  return path.join(root, 'resources', 'packaging', 'native', 'win32', 'x64', 'node_modules', name);
}

describe('runtime-only tree-sitter staging', () => {
  it('keeps the JS loader and target native prebuild without compile-time sources or foreign CPUs', () => {
    execFileSync(process.execPath, ['scripts/prepare-packaging-native.mjs', '--platform', 'win32', '--arch', 'x64'], {
      cwd: root,
      stdio: 'pipe'
    });

    const treeSitter = stagedPackage('tree-sitter');
    const bash = stagedPackage('tree-sitter-bash');
    expect(existsSync(path.join(treeSitter, 'package.json'))).toBe(true);
    expect(existsSync(path.join(treeSitter, 'index.js'))).toBe(true);
    expect(existsSync(path.join(treeSitter, 'prebuilds', 'win32-x64', 'tree-sitter.node'))).toBe(true);
    expect(existsSync(path.join(bash, 'package.json'))).toBe(true);
    expect(existsSync(path.join(bash, 'bindings', 'node', 'index.js'))).toBe(true);
    expect(existsSync(path.join(bash, 'prebuilds', 'win32-x64', 'tree-sitter-bash.node'))).toBe(true);
    expect(existsSync(path.join(bash, 'src', 'parser.c'))).toBe(false);
    expect(existsSync(path.join(bash, 'src'))).toBe(false);
    expect(readdirSync(path.join(treeSitter, 'prebuilds')).sort()).toEqual(['win32-x64']);
    expect(readdirSync(path.join(bash, 'prebuilds')).sort()).toEqual(['win32-x64']);
  });

  it('preserves the exact apply_patch interception behavior', () => {
    const direct = "apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: smoke.txt\n+ok\n*** End Patch\nPATCH";
    const child = "cd child && apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: smoke.txt\n+ok\n*** End Patch\nPATCH";
    expect(maybeParseApplyPatchForExec(['bash', '-lc', direct], '/tmp/work').kind).toBe('body');
    const childResult = maybeParseApplyPatchForExec(['bash', '-lc', child], '/tmp/work');
    expect(childResult.kind).toBe('body');
    if (childResult.kind === 'body') expect(childResult.args.workdir).toBe('child');
    expect(maybeParseApplyPatchForExec(['bash', '-lc', 'echo ordinary'], '/tmp/work')).toEqual({ kind: 'not_apply_patch' });
    expect(maybeParseApplyPatchForExec(['bash', '-lc', "apply_patch <<'PATCH'\nnot a patch\nPATCH"], '/tmp/work').kind).toBe('correctness_error');
  });
});
