import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { cliArtifactName } from './cli-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const direct = args.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const platform = value('platform', process.platform);
const arch = value('arch', process.arch);
const key = `${platform}-${arch}`;
const artifactName = cliArtifactName(platform, arch);
if (process.platform !== platform || process.arch !== arch) {
  throw new Error(`CLI packages must be assembled on their native target; expected ${platform}-${arch}, got ${process.platform}-${process.arch}`);
}

const workRoot = path.join(root, '.cli-build');
const stage = path.join(workRoot, key, 'ComGu-CLI');
const bundleDir = path.join(stage, 'bin');
const releaseDir = path.join(root, 'release');
await fs.rm(path.join(workRoot, key), { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });
await fs.mkdir(releaseDir, { recursive: true });

const virtualModules = new Map([
  [path.normalize(path.join(root, 'src/main/secrets.ts')), `export async function getSecret(){throw new Error('Electron credential adapter is unavailable in CLI profile')}`],
  [path.normalize(path.join(root, 'src/main/mcp/desktop-app-runtime.ts')), `export function installDesktopAppMcpRuntime(){throw new Error('Desktop-app MCP runtime is unavailable in CLI profile')}`]
]);

const runtimeBoundaryPlugin = {
  name: 'comgu-cli-runtime-boundary',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!importer || !source.startsWith('.')) return null;
    const resolved = path.normalize(path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts')));
    if (virtualModules.has(resolved)) return `\0comgu-cli:${resolved}`;
    if (platform === 'linux' && resolved === path.normalize(path.join(root, 'src/main/desktop/windows.ts'))) {
      return '\0comgu-cli:windows-desktop-unavailable';
    }
    if (platform === 'win32' && resolved.startsWith(path.normalize(path.join(root, 'src/main/desktop/linux')))) {
      return '\0comgu-cli:linux-desktop-unavailable';
    }
    return null;
  },
  load(id) {
    if (!id.startsWith('\0comgu-cli:')) return null;
    const sourcePath = id.slice('\0comgu-cli:'.length);
    const replacement = virtualModules.get(sourcePath);
    if (replacement) return replacement;
    if (id.endsWith('windows-desktop-unavailable')) {
      return `export function windowsDesktopDriver(){throw new Error('Windows Desktop is unavailable in this CLI target')}`;
    }
    return `export async function probeLinuxDesktop(){return {kind:'unavailable',driver:null,reason:'Linux Desktop is unavailable in this CLI target'}}`;
  }
};

await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [runtimeBoundaryPlugin],
  build: {
    ssr: path.join(root, 'src/cli/bin.ts'),
    target: 'node22',
    outDir: bundleDir,
    emptyOutDir: true,
    rollupOptions: {
      external: (id) => !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('\0'),
      output: {
        entryFileNames: 'comgu.mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
        format: 'es'
      },
    }
  }
});

const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const runtimePackage = {
  name: 'comgu-cli-runtime',
  version: pkg.version,
  private: true,
  type: 'module',
  engines: { node: '>=22' },
  dependencies: pkg.dependencies
};
await fs.writeFile(path.join(stage, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8');
await fs.copyFile(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
await fs.writeFile(
  path.join(stage, 'README.txt'),
  `ComGu CLI ${pkg.version}\n\nRequires Node.js 22 or newer.\nRun ./comgu (Linux) or comgu.cmd (Windows).\n`,
  'utf8'
);

const installArgs = ['install', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false'];
const install = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...installArgs], {
      cwd: stage,
      stdio: 'inherit',
      env: process.env
    })
  : spawnSync('npm', installArgs, {
  cwd: stage,
  stdio: 'inherit',
  env: process.env
    });
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status ?? 1);

if (platform === 'win32') {
  await fs.writeFile(path.join(stage, 'comgu.cmd'), '@echo off\r\nnode "%~dp0bin\\comgu.mjs" %*\r\n', 'utf8');
} else {
  const launcher = path.join(stage, 'comgu');
  await fs.writeFile(launcher, '#!/bin/sh\nexec node "$(dirname "$0")/bin/comgu.mjs" "$@"\n', { encoding: 'utf8', mode: 0o755 });
}

const artifact = path.join(releaseDir, artifactName);
await fs.rm(artifact, { force: true });
if (platform === 'win32') {
  const command = `Compress-Archive -LiteralPath '${stage.replace(/'/g, "''")}' -DestinationPath '${artifact.replace(/'/g, "''")}' -CompressionLevel Optimal`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
} else {
  const result = spawnSync('tar', ['-czf', artifact, '-C', path.dirname(stage), path.basename(stage)], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(artifact);
