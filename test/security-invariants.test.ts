import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Runtime .mjs scanner is exercised directly by Vitest; it intentionally ships without a declaration file.
import { scanText } from '../scripts/verify-security-invariants.mjs';

const root = process.cwd();
const RUNTIME_ROOTS = ['src/main', 'src/renderer', 'extension'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.html', '.json']);

const PROGRAMMATIC_OR_RECOVERY_HOSTS = new Set(['api.github.com', 'github.com', 'openrouter.ai']);
const USER_FACING_HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'platform.openai.com',
  'developers.openai.com'
]);
const NON_NETWORK_NAMESPACE_HOSTS = new Set(['www.w3.org']);

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(relative)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(relative);
  }
  return out;
}

function urlsInText(source: string): string[] {
  return source.match(/https?:\/\/[^\s'"\`<>)}\]]+/g) ?? [];
}

function absoluteUrls(file: string, source: string): string[] {
  const ext = path.extname(file);
  if (ext !== '.ts' && ext !== '.js') {
    return urlsInText(source.replace(/<!--[\s\S]*?-->/g, ''));
  }
  const tree = parse(source, {
    sourceType: 'unambiguous',
    plugins: ext === '.ts' ? ['typescript'] : []
  });
  const urls: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const value = node as Record<string, unknown>;
    if (value.type === 'StringLiteral' && typeof value.value === 'string') {
      urls.push(...urlsInText(value.value));
    } else if (value.type === 'TemplateLiteral' && Array.isArray(value.quasis)) {
      for (const quasi of value.quasis as Array<{ value?: { raw?: string } }>) {
        if (quasi.value?.raw) urls.push(...urlsInText(quasi.value.raw));
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'loc' || key === 'extra') continue;
      if (Array.isArray(child)) for (const entry of child) visit(entry);
      else visit(child);
    }
  };
  visit(tree);
  return urls;
}

describe('security invariants', () => {
  it('keeps runtime URL literals inside the declared egress and user-navigation set', async () => {
    const files = (await Promise.all(RUNTIME_ROOTS.map(sourceFiles))).flat();
    for (const file of files) {
      const source = await fs.readFile(path.join(root, file), 'utf8');
      for (const value of absoluteUrls(file, source)) {
        const normalized = value.replace(/\\\$\{.*$/, '').replace(/[.,;:]$/, '');
        let parsed: URL;
        try {
          parsed = new URL(normalized);
        } catch {
          continue; // template literals are checked by their literal host prefix below
        }
        const host = parsed.hostname.toLowerCase();
        if (host === '127.0.0.1' || host === 'localhost') continue;
        if (NON_NETWORK_NAMESPACE_HOSTS.has(host)) continue;
        const approved = PROGRAMMATIC_OR_RECOVERY_HOSTS.has(host) || USER_FACING_HOSTS.has(host);
        expect(approved, `${file}: unexpected runtime URL host ${host} from ${value}`).toBe(true);
      }
    }
  });

  it('detects high-confidence secrets and floating Actions without flagging the ComGu repository URL', () => {
    expect(scanText('const x = "' + 'AKIA' + '0'.repeat(16) + '"')).toContain('AWS access key');
    expect(scanText('uses: vendor/action@' + 'main')).toContain('floating GitHub Action ref');
    expect(scanText('https://github.com/Tanaboonnnnn/Com-gu')).toEqual([]);
  });

  it('wires deterministic security and production-audit gates into CI and release preflight', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.['verify:security']).toBe('node scripts/verify-security-invariants.mjs');
    expect(pkg.scripts?.['audit:prod']).toBe('npm audit --omit=dev --audit-level=high');
    expect(pkg.scripts?.['verify:ci']).toMatch(/^npm run verify:security && /);

    const security = await fs.readFile(path.join(root, '.github/workflows/security.yml'), 'utf8').catch(() => '');
    expect(security).toContain('permissions:');
    expect(security).toContain('contents: read');
    expect(security).toContain('actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09');
    expect(security).toContain('actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444');
    expect(security).toContain('npm run verify:security');
    expect(security).toContain('npm run audit:prod');

    const publish = await fs.readFile(path.join(root, '.github/workflows/publish.yml'), 'utf8');
    expect(publish).toContain('Verify security invariants');
    expect(publish).toContain('node scripts/verify-security-invariants.mjs');
  });

  it('keeps the old upstream owner out of runtime source and release configuration', async () => {
    const files = [
      ...(await Promise.all(RUNTIME_ROOTS.map(sourceFiles))).flat(),
      'electron-builder.yml',
      'package.json',
      '.github/workflows/ci.yml',
      '.github/workflows/publish.yml'
    ];
    for (const file of files) {
      const source = await fs.readFile(path.join(root, file), 'utf8');
      expect(source, file).not.toContain('totec448-spec/chat-on-steroids');
      expect(source, file).not.toContain('227782719+totec448-spec@users.noreply.github.com');
    }
  });
});
