#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_PATTERNS = [
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { label: 'Stripe live secret', pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/g }
];

const FLOATING_ACTION = /\buses:\s*[^\s#]+@(main|master|latest)\b/gim;
const OLD_UPSTREAM = ['totec448-spec', 'chat-on-steroids'].join('/');
const OLD_MAINTAINER = ['227782719+totec448-spec', 'users.noreply.github.com'].join('@');
const BINARY_EXTENSIONS = new Set([
  '.7z', '.appimage', '.bin', '.bmp', '.dmg', '.exe', '.gif', '.gz', '.ico', '.icns', '.jpeg', '.jpg',
  '.node', '.pdf', '.png', '.so', '.tar', '.tiff', '.webp', '.woff', '.woff2', '.zip'
]);

function runtimeOrReleasePath(file) {
  const normalized = file.replaceAll('\\', '/');
  return normalized.startsWith('src/') ||
    normalized.startsWith('extension/') ||
    normalized.startsWith('scripts/') ||
    normalized.startsWith('.github/workflows/') ||
    normalized === 'electron-builder.yml' ||
    normalized === 'package.json' ||
    normalized === 'package-lock.json';
}

export function scanText(text, { file = '' } = {}) {
  const issues = [];
  for (const { label, pattern } of SECRET_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags);
    if (matcher.test(text)) issues.push(label);
  }
  const normalizedFile = file.replaceAll('\\', '/');
  if ((!file || normalizedFile.startsWith('.github/workflows/')) && FLOATING_ACTION.test(text)) {
    issues.push('floating GitHub Action ref');
  }
  FLOATING_ACTION.lastIndex = 0;
  if (runtimeOrReleasePath(file)) {
    if (text.includes(OLD_UPSTREAM)) issues.push('previous upstream repository reference');
    if (text.includes(OLD_MAINTAINER)) issues.push('previous upstream maintainer identity');
  }
  return issues;
}

function trackedFiles() {
  const raw = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' });
  return raw.toString('utf8').split('\0').filter(Boolean);
}

function shouldRead(file) {
  return !BINARY_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export function verifyTrackedSecurityInvariants() {
  const failures = [];
  for (const file of trackedFiles()) {
    if (!shouldRead(file)) continue;
    let buffer;
    try {
      buffer = readFileSync(file);
    } catch (error) {
      failures.push(`${file}: unreadable tracked file (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    if (buffer.includes(0)) continue;
    const issues = scanText(buffer.toString('utf8'), { file });
    for (const issue of issues) failures.push(`${file}: ${issue}`);
  }
  if (failures.length > 0) {
    throw new Error(`Security invariant scan failed:\n${failures.map((line) => `- ${line}`).join('\n')}`);
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) {
  try {
    verifyTrackedSecurityInvariants();
    console.log('Security invariant scan passed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
