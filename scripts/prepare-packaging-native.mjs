/**
 * Stage native dependencies that npm intentionally omits when the host platform/CPU differs
 * from the packaging target. node-pty and both tree-sitter packages carry all supported
 * prebuilds in one npm package; Sharp publishes target-specific optional @img packages.
 *
 * electron-builder can therefore package x64 + arm64 from one checkout only after both Sharp
 * platform packages exist on disk. Their exact URL and integrity come from package-lock.json,
 * so this does not introduce a second dependency version source.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativePrebuildDir, parseTarget, sharpPackagesFor, tarExecutableForPlatform } from './packaging-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules', '.cache', 'packaging-native');
const stagingRoot = path.join(root, 'resources', 'packaging', 'native');

const say = (message) => process.stdout.write(`${message}\n`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireTargetLock(platform, arch) {
  await mkdir(cacheDir, { recursive: true });
  const lockPath = path.join(cacheDir, `prepare-${platform}-${arch}.lock`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`, 'utf8');
      await handle.close();
      return async () => rm(lockPath, { force: true });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 5 * 60_000) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code !== 'ENOENT') throw statError;
        continue;
      }
      await delay(100);
    }
  }
  throw new Error(`Timed out waiting for native packaging preparation lock ${platform}-${arch}`);
}

function sha512FromIntegrity(integrity) {
  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity ?? '');
  if (!match) throw new Error(`Unsupported package-lock integrity: ${integrity}`);
  return Buffer.from(match[1], 'base64').toString('hex');
}

async function download(url, target) {
  if (existsSync(target)) return;
  const response = await fetch(url, { headers: { 'user-agent': 'chat-on-steroids-build' } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function fileTree(dir, relative = '', files = new Map()) {
  if (!existsSync(dir)) return files;
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await fileTree(absolute, childRelative, files);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unexpected non-file in native package: ${childRelative}`);
    const bytes = await readFile(absolute);
    files.set(childRelative, {
      absolute,
      sha256: createHash('sha256').update(bytes).digest('hex')
    });
  }
  return files;
}

async function syncVerifiedTree(source, destination) {
  const sourceFiles = await fileTree(source);
  const destinationFiles = await fileTree(destination);
  await mkdir(destination, { recursive: true });

  for (const [relative, sourceFile] of sourceFiles) {
    const existing = destinationFiles.get(relative);
    if (existing?.sha256 === sourceFile.sha256) continue;
    const target = path.join(destination, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(sourceFile.absolute, target);
  }

  for (const [relative, destinationFile] of destinationFiles) {
    if (!sourceFiles.has(relative)) await rm(destinationFile.absolute, { force: true });
  }

  const finalFiles = await fileTree(destination);
  if (finalFiles.size !== sourceFiles.size) return false;
  for (const [relative, sourceFile] of sourceFiles) {
    if (finalFiles.get(relative)?.sha256 !== sourceFile.sha256) return false;
  }
  return true;
}

async function stageSharpPackage(lock, packageName, platform, arch) {
  const lockEntry = lock.packages?.[`node_modules/${packageName}`];
  if (!lockEntry?.version || !lockEntry.resolved || !lockEntry.integrity) {
    throw new Error(`package-lock.json has no complete ${packageName} entry`);
  }

  const destination = path.join(root, 'node_modules', ...packageName.split('/'));

  await mkdir(cacheDir, { recursive: true });
  const tarball = path.join(cacheDir, `${packageName.replace('@img/', '')}-${lockEntry.version}.tgz`);
  await download(lockEntry.resolved, tarball);

  const expected = sha512FromIntegrity(lockEntry.integrity);
  const actual = createHash('sha512').update(await readFile(tarball)).digest('hex');
  if (actual !== expected) {
    await rm(tarball, { force: true });
    throw new Error(`Integrity mismatch for ${packageName}@${lockEntry.version}`);
  }

  const extractDir = path.join(
    cacheDir,
    `extract-${packageName.replace('@img/', '')}-${lockEntry.version}-${process.pid}`
  );
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  execFileSync(tarExecutableForPlatform(), ['-xzf', tarball, '-C', extractDir], { stdio: 'inherit' });

  const extracted = path.join(extractDir, 'package');
  const metadata = JSON.parse(await readFile(path.join(extracted, 'package.json'), 'utf8'));
  if (metadata.version !== lockEntry.version || !metadata.cpu?.includes(arch) || !metadata.os?.includes(platform)) {
    throw new Error(`Unexpected metadata in ${packageName}@${lockEntry.version}`);
  }

  // Materialize exactly the lockfile tarball, but leave byte-identical files untouched.
  // Windows can legitimately have libvips loaded while a developer packages the running app;
  // rewriting an already-verified DLL would fail with EPERM for no reproducibility benefit.
  if (!(await syncVerifiedTree(extracted, destination))) {
    throw new Error(`${packageName}@${lockEntry.version} could not be synchronized exactly`);
  }
  const files = await fileTree(destination);
  if (files.size === 0) throw new Error(`${packageName} extracted empty`);
  say(`${packageName} ${lockEntry.version} verified from package-lock.json`);
}

function requirePrebuild(relative) {
  const target = path.join(root, 'node_modules', ...relative.split('/'));
  if (!existsSync(target)) throw new Error(`Required native prebuild is missing: ${relative}`);
}

async function stageTargetPayload(platform, arch, sharpPackages) {
  const payloadRoot = path.join(stagingRoot, platform, arch, 'node_modules');
  await rm(path.join(stagingRoot, platform, arch), { recursive: true, force: true });
  await mkdir(payloadRoot, { recursive: true });

  for (const packageName of sharpPackages) {
    const relative = packageName.split('/');
    await cp(path.join(root, 'node_modules', ...relative), path.join(payloadRoot, ...relative), { recursive: true });
  }

  // MXC ships binaries for more than one CPU in a single npm package. ComGu's Windows
  // command confinement resolves helpers from @microsoft/mxc-sdk/bin/<process.arch>, while
  // the SDK itself resolves the same target directory for its native executors. Stage the
  // package identity/license plus exactly one architecture directory; never copy the foreign
  // CPU payload into a target package. Keeping the complete selected directory is deliberate:
  // MXC owns helper-to-helper native dependencies inside that directory and may add one without
  // changing ComGu's TypeScript import graph.
  const mxcSource = path.join(root, 'node_modules', '@microsoft', 'mxc-sdk');
  const mxcDestination = path.join(payloadRoot, '@microsoft', 'mxc-sdk');
  await mkdir(mxcDestination, { recursive: true });
  for (const file of ['package.json', 'LICENSE.md', 'README.md']) {
    await copyFile(path.join(mxcSource, file), path.join(mxcDestination, file));
  }
  await mkdir(path.join(mxcDestination, 'bin'), { recursive: true });
  await cp(path.join(mxcSource, 'bin', arch), path.join(mxcDestination, 'bin', arch), { recursive: true });
  if (platform !== 'win32') {
    for (const executable of ['lxc-exec', 'mxc-exec-mac', 'unix-test-proxy']) {
      const candidate = path.join(mxcDestination, 'bin', arch, executable);
      if (existsSync(candidate)) await chmod(candidate, 0o755);
    }
  }

  // Runtime audit for tree-sitter 0.25.1 / tree-sitter-bash 0.25.1:
  // - tree-sitter's package main is index.js, which loads the target .node through node-gyp-build.
  // - tree-sitter-bash's package main is bindings/node/index.js, which does the same for its
  //   grammar addon. src/node-types.json is optional metadata; parser.c, binding.cc, queries,
  //   grammar.js and the WASM build are not reached by ComGu's native Node path.
  // Keep package identity/license plus those two JS loaders; target prebuilds are staged below.
  const treeRuntimeFiles = new Map([
    ['tree-sitter', ['package.json', 'LICENSE', 'index.js']],
    ['tree-sitter-bash', ['package.json', 'LICENSE', path.join('bindings', 'node', 'index.js')]]
  ]);
  for (const [dependency, files] of treeRuntimeFiles) {
    const sourceRoot = path.join(root, 'node_modules', dependency);
    const destinationRoot = path.join(payloadRoot, dependency);
    for (const relative of files) {
      const destination = path.join(destinationRoot, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(sourceRoot, relative), destination);
    }
  }

  const prebuildDir = nativePrebuildDir(platform, arch);
  for (const dependency of ['node-pty', 'tree-sitter', 'tree-sitter-bash']) {
    const source = path.join(root, 'node_modules', dependency, 'prebuilds', prebuildDir);
    const destination = path.join(payloadRoot, dependency, 'prebuilds', prebuildDir);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true,
      // PDBs are compiler/debug symbols, never runtime inputs. Filter only the staged copy so
      // development/debugging installs retain their symbols and every OS/CPU gets the same rule.
      filter: (candidate) => dependency !== 'node-pty' || !candidate.toLowerCase().endsWith('.pdb')
    });
  }
  // node-pty launches this helper as a process on macOS. Preserve the npm tarball's executable
  // contract explicitly instead of depending on host/filesystem copy-mode behaviour.
  if (platform === 'darwin') {
    await chmod(path.join(payloadRoot, 'node-pty', 'prebuilds', prebuildDir, 'spawn-helper'), 0o755);
  }
  say(`${platform}-${arch} native packaging payload staged.`);
}

async function main() {
  const { platform, arch } = parseTarget();
  const releaseLock = await acquireTargetLock(platform, arch);
  try {
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    const sharpPackages = sharpPackagesFor(platform, arch);
    for (const packageName of sharpPackages) {
      await stageSharpPackage(lock, packageName, platform, arch);
    }

    const prebuildDir = nativePrebuildDir(platform, arch);
    if (platform === 'win32') {
      requirePrebuild(`node-pty/prebuilds/win32-${arch}/conpty.node`);
      requirePrebuild(`node-pty/prebuilds/win32-${arch}/conpty_console_list.node`);
      requirePrebuild(`node-pty/prebuilds/win32-${arch}/conpty/OpenConsole.exe`);
    } else {
      requirePrebuild(`node-pty/prebuilds/${prebuildDir}/pty.node`);
      if (platform === 'darwin') requirePrebuild(`node-pty/prebuilds/${prebuildDir}/spawn-helper`);
    }
    requirePrebuild(`tree-sitter/prebuilds/${prebuildDir}/tree-sitter.node`);
    requirePrebuild(`tree-sitter-bash/prebuilds/${prebuildDir}/tree-sitter-bash.node`);
    await stageTargetPayload(platform, arch, sharpPackages);
    say(`${platform}-${arch} native dependency prebuilds are ready.`);
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  process.stderr.write(`\nCould not prepare native packaging dependencies: ${error.message}\n`);
  process.exit(1);
});
