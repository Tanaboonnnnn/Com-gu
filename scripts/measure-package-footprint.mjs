import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function measureTree(root) {
  const absoluteRoot = path.resolve(root);
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await fs.stat(absolute);
      files.push({
        path: path.relative(absoluteRoot, absolute).replaceAll('\\', '/'),
        bytes: info.size
      });
    }
  }

  await walk(absoluteRoot);
  return {
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0)
  };
}

function largestEntries(files, limit = 30) {
  const directories = new Map();
  for (const file of files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const directory = parts.slice(0, index).join('/');
      directories.set(directory, (directories.get(directory) ?? 0) + file.bytes);
    }
  }

  const entries = [
    ...files.map((file) => ({ type: 'file', path: file.path, bytes: file.bytes })),
    ...[...directories.entries()].map(([entryPath, bytes]) => ({ type: 'directory', path: `${entryPath}/`, bytes }))
  ];
  entries.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path) || a.type.localeCompare(b.type));
  return entries.slice(0, limit);
}

export async function measurePackage({ installer, unpacked }) {
  const tree = await measureTree(unpacked);
  const installerBytes = (await fs.stat(installer)).size;
  const sumPrefix = (prefix) =>
    tree.files
      .filter((file) => file.path.startsWith(prefix))
      .reduce((sum, file) => sum + file.bytes, 0);
  const appAsar = tree.files.find((file) => file.path === 'resources/app.asar')?.bytes ?? 0;
  const appAsarUnpacked = sumPrefix('resources/app.asar.unpacked/');

  return {
    installerBytes,
    totalBytes: tree.totalBytes,
    categories: {
      appAsar,
      appAsarUnpacked,
      extraResources: tree.totalBytes - appAsar - appAsarUnpacked
    },
    largest: largestEntries(tree.files),
    files: tree.files
  };
}

function argValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function mib(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

async function main() {
  const args = process.argv.slice(2);
  const installer = argValue(args, 'installer');
  const unpacked = argValue(args, 'unpacked');
  const jsonPath = argValue(args, 'json');
  if (!installer || !unpacked) {
    throw new Error('Usage: node scripts/measure-package-footprint.mjs --installer <file> --unpacked <dir> [--json <file>]');
  }

  const result = await measurePackage({ installer, unpacked });
  if (jsonPath) {
    await fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  console.log(`installer_bytes=${result.installerBytes} installer_mib=${mib(result.installerBytes)}`);
  console.log(`unpacked_bytes=${result.totalBytes} unpacked_mib=${mib(result.totalBytes)}`);
  console.log(`app_asar_bytes=${result.categories.appAsar}`);
  console.log(`app_asar_unpacked_bytes=${result.categories.appAsarUnpacked}`);
  console.log(`extra_resources_bytes=${result.categories.extraResources}`);
  for (const entry of result.largest) {
    console.log(`${entry.type}\t${entry.bytes}\t${entry.path}`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
