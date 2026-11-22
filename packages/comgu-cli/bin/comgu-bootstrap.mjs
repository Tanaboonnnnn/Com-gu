#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { defaultNpmInstallRoot, installRelease } from '../lib/install.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) return reject(new Error(`${command} terminated by ${signal}`));
      resolve(code ?? 1);
    });
  });
}

async function ensurePayload() {
  return installRelease({ version: pkg.version, installRoot: defaultNpmInstallRoot(), channel: 'npm' });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--version') {
    console.log(pkg.version);
    return;
  }
  if (args[0] === 'update') {
    console.log('Updating npm-managed ComGu CLI through npm...');
    const npmArgs = ['install', '-g', 'comgu-cli@latest'];
    process.exitCode = process.platform === 'win32'
      ? await run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...npmArgs])
      : await run('npm', npmArgs);
    return;
  }

  if (args[0] === 'uninstall') {
    console.log('This installation is managed by npm. Run: npm uninstall -g comgu-cli');
    return;
  }

  const installed = await ensurePayload();
  if (process.platform === 'win32') {
    process.exitCode = await run('cmd.exe', ['/d', '/s', '/c', installed.launcher, ...args]);
  } else {
    process.exitCode = await run(installed.launcher, args);
  }
}

main().catch((error) => {
  console.error(`comgu: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
