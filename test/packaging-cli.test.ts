import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLI_FORBIDDEN_SOURCE_FRAGMENTS, CLI_TARGETS, cliArtifactName } from '../scripts/cli-package.mjs';

describe('CLI packaging contract', () => {
  it('publishes exactly the four V1 artifact names', () => {
    expect(CLI_TARGETS).toEqual({
      'win32-x64': 'ComGu-CLI-windows-x64.zip',
      'win32-arm64': 'ComGu-CLI-windows-arm64.zip',
      'linux-x64': 'ComGu-CLI-linux-x64.tar.gz',
      'linux-arm64': 'ComGu-CLI-linux-arm64.tar.gz'
    });
    expect(() => cliArtifactName('darwin', 'arm64')).toThrow(/unsupported/i);
  });

  it('defines a packaging boundary that excludes Electron frontend/browser/session implementations', () => {
    expect(CLI_FORBIDDEN_SOURCE_FRAGMENTS).toEqual(expect.arrayContaining([
      '/src/main/index.ts', '/src/main/bridge.ts', '/src/main/agents.ts',
      '/src/main/session/recorder.ts', '/src/main/session/store.ts', '/src/main/goal.ts',
      '/src/renderer/', '/src/preload/'
    ]));
  });

  it('wires every CLI artifact through candidate checksums and release publishing', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    const publish = readFileSync('.github/workflows/publish.yml', 'utf8');
    for (const artifact of Object.values(CLI_TARGETS)) {
      expect(release).toContain(artifact);
      expect(publish).toContain(artifact);
    }
    expect(release).toContain('needs: [package, cli-package]');
    expect(release).toContain('node scripts/smoke-cli.mjs --dir .cli-build/${{ matrix.platform }}-${{ matrix.arch }}/ComGu-CLI');
  });
});
