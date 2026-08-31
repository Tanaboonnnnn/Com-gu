import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (file: string) => readFile(path.join(root, file), 'utf8');

describe('ComGu branding', () => {
  it('uses ComGu on the desktop, extension and connector surfaces', async () => {
    const [builder, renderer, manifestText, surfaces, main] = await Promise.all([
      text('electron-builder.yml'),
      text('src/renderer/index.html'),
      text('extension/manifest.json'),
      text('src/main/mcp/surfaces.ts'),
      text('src/main/index.ts')
    ]);
    const manifest = JSON.parse(manifestText) as { name: string; description: string; action: { default_title: string } };

    expect(builder).toContain('productName: ComGu');
    expect(renderer).toContain('<title>ComGu</title>');
    expect(renderer).toMatch(/<span class="title">\r?\n\s+ComGu\r?\n/);
    expect(manifest.name).toBe('ComGu companion');
    expect(manifest.description).toContain('ComGu app');
    expect(manifest.action.default_title).toBe('ComGu');
    expect(surfaces).toContain("export const CONNECTOR_BRAND = 'ComGu'");
    expect(main).toContain("title: 'ComGu'");
    expect(main).toContain('`ComGu — ${label.toLowerCase()}`');
  });

  it('keeps compatibility identifiers stable while recognizing new and legacy connector names', async () => {
    const [builder, surfaces, bridge, background, fiber, content] = await Promise.all([
      text('electron-builder.yml'),
      text('src/main/mcp/surfaces.ts'),
      text('src/main/bridge.ts'),
      text('extension/background.js'),
      text('extension/fiber.js'),
      text('extension/content.js')
    ]);

    expect(builder).toContain('appId: com.chatonsteroids.app');
    expect(surfaces).toContain("serverName: 'chat-on-steroids-core'");
    expect(surfaces).toContain("serverName: 'chat-on-steroids-desktop'");
    expect(bridge).toContain("app: 'chat-on-steroids'");
    expect(background).toContain("body.app === 'chat-on-steroids'");
    for (const source of [fiber, content]) {
      expect(source).toContain("'ComGu Core'");
      expect(source).toContain("'ComGu Desktop'");
      expect(source).toContain("'Chat On Steroids Core'");
      expect(source).toContain("'Chat On Steroids Desktop'");
    }
  });

  it('packages ComGu-named artifacts without renaming the internal npm package', async () => {
    const [pkgText, builder] = await Promise.all([text('package.json'), text('electron-builder.yml')]);
    const pkg = JSON.parse(pkgText) as { name: string; author: string };
    expect(pkg.name).toBe('chat-on-steroids');
    expect(pkg.author).toBe('ComGu');
    expect(builder).toContain('shortcutName: ComGu');
    expect(builder).toContain('artifactName: ComGu-Setup-${arch}.${ext}');
    expect(builder).toContain('artifactName: ComGu-macOS-${arch}.${ext}');
    expect(builder).toContain('artifactName: ComGu-Linux-${env.COS_PACKAGE_ARCH}.${ext}');
  });

  it('points public project and extension-recovery metadata at the ComGu repository', async () => {
    const [pkgText, version, goal] = await Promise.all([
      text('package.json'),
      text('src/main/version.ts'),
      text('src/main/goal.ts')
    ]);
    const pkg = JSON.parse(pkgText) as { homepage: string };
    expect(pkg.homepage).toBe('https://github.com/Tanaboonnnnn/Com-gu');
    expect(version).toContain('https://github.com/Tanaboonnnnn/Com-gu/releases/download/');
    expect(goal).toContain("'HTTP-Referer': 'https://github.com/Tanaboonnnnn/Com-gu'");
  });

  it('generates shipped icons from the full-colour ComGu logo source', async () => {
    const iconScript = await text('scripts/make-icon.mjs');
    expect(iconScript).toContain("import sharp from 'sharp'");
    expect(iconScript).toContain("artwork', 'comgu-logo.jpg'");
    expect(iconScript).not.toContain('const INK =');
    expect(iconScript).not.toContain('const PAPER =');
  });
});
