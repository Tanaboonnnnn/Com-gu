import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-ignore js-yaml is a transitive electron-builder dependency used by packaging tests.
import { load as loadYaml } from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('native ASAR unpack contract', () => {
  it('keeps startup-sensitive native packages unpacked while target staging removes dead payload', () => {
    const config = loadYaml(readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')) as any;
    expect(config.asarUnpack).toEqual([
      '**/node_modules/node-pty/**',
      '**/node_modules/@microsoft/mxc-sdk/**',
      '**/node_modules/sharp/**',
      '**/node_modules/@img/**',
      '**/node_modules/tree-sitter/**',
      '**/node_modules/tree-sitter-bash/**'
    ]);
  });
});
