import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-ignore js-yaml is a transitive electron-builder dependency used by packaging tests.
import { load as loadYaml } from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('native ASAR unpack contract', () => {
  it('keeps only files that must execute or load through the real filesystem unpacked', () => {
    const config = loadYaml(readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')) as any;
    expect(config.asarUnpack).toEqual([
      '**/node_modules/node-pty/prebuilds/**',
      '**/node_modules/@microsoft/mxc-sdk/bin/**',
      '**/node_modules/@img/**/*.node',
      '**/node_modules/@img/**/*.dll',
      '**/node_modules/@img/**/*.so*',
      '**/node_modules/@img/**/*.dylib',
      '**/node_modules/tree-sitter/prebuilds/**/*.node',
      '**/node_modules/tree-sitter-bash/prebuilds/**/*.node'
    ]);
    expect(config.asarUnpack).not.toContain('**/node_modules/node-pty/**');
    expect(config.asarUnpack).not.toContain('**/node_modules/@microsoft/mxc-sdk/**');
    expect(config.asarUnpack).not.toContain('**/node_modules/sharp/**');
    expect(config.asarUnpack).not.toContain('**/node_modules/@img/**');
    expect(config.asarUnpack).not.toContain('**/node_modules/tree-sitter/**');
    expect(config.asarUnpack).not.toContain('**/node_modules/tree-sitter-bash/**');
  });
});
