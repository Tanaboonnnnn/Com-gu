import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLI_FORBIDDEN_SOURCE_FRAGMENTS, CLI_TARGETS, cliArtifactName } from '../scripts/cli-package.mjs';
import rootPackage from '../package.json';
import bootstrapPackage from '../packages/comgu-cli/package.json';

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
    expect(release).toContain('node scripts/smoke-cli-installer-channel.mjs --artifact ${{ matrix.file }}');
  });

  it('keeps the public npm bootstrapper thin and version-aligned', () => {
    expect(bootstrapPackage.name).toBe('comgu-cli');
    expect(bootstrapPackage.version).toBe(rootPackage.version);
    expect(bootstrapPackage.bin).toEqual({ comgu: 'bin/comgu-bootstrap.mjs' });
    expect(bootstrapPackage.engines).toEqual({ node: '>=22' });
    expect(bootstrapPackage).not.toHaveProperty('dependencies');
    expect(bootstrapPackage).not.toHaveProperty('scripts');
    expect(bootstrapPackage.files).toEqual(['bin/', 'lib/', 'README.md']);
  });

  it('publishes npm through GitHub OIDC without a long-lived registry token', () => {
    const publish = readFileSync('.github/workflows/publish.yml', 'utf8');
    const npmJobStart = publish.indexOf('  npm-publish:');
    expect(npmJobStart).toBeGreaterThan(-1);
    const npmJob = publish.slice(npmJobStart);
    expect(npmJob).toContain('id-token: write');
    expect(npmJob).toContain('node-version: 24');
    expect(npmJob).toContain("npm install --global 'npm@^11.15.0'");
    expect(npmJob).toContain('npm publish ./packages/comgu-cli --access public --provenance');
    expect(npmJob).not.toContain('NPM_TOKEN');
    expect(npmJob).not.toContain('NODE_AUTH_TOKEN');
    expect(npmJob).not.toContain('secrets.NPM_TOKEN');
  });

  it('supports an npm-only recovery publish without recreating an existing GitHub Release', () => {
    const publish = readFileSync('.github/workflows/publish.yml', 'utf8');
    expect(publish).toContain('npm_only:');
    expect(publish).toContain('version:');
    expect(publish).toContain("github.event_name == 'workflow_dispatch' && inputs.npm_only");
    expect(publish).toContain('gh release view \"v$VERSION\"');
    expect(publish).toContain('package_version=');
  });
});
