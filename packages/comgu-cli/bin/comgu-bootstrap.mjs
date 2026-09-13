#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { defaultNpmInstallRoot, installRelease } from '../lib/install.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const installRoot = defaultNpmInstallRoot(packageRoot);

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
  return installRelease({ version: pkg.version, installRoot, channel: 'npm' });
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--bootstrap-install') {
    if (process.env.COMGU_SKIP_BOOTSTRAP === '1') return;
    const installed = await ensurePayload();
    console.log(`ComGu CLI ${installed.version} ready (${installed.target}).`);
    return;
  }

  if (args[0] === 'update') {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    console.log('Updating npm-managed ComGu CLI through npm...');
    process.exitCode = await run(npm, ['install', '-g', 'comgu-cli@latest']);
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
