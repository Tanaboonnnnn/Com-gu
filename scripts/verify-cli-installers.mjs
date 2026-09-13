import { readFileSync } from 'node:fs';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const bootstrap = JSON.parse(readFileSync('packages/comgu-cli/package.json', 'utf8'));
const shell = readFileSync('install.sh', 'utf8');
const powershell = readFileSync('install.ps1', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(bootstrap.name === 'comgu-cli', 'npm bootstrap package must be named comgu-cli');
assert(bootstrap.version === root.version, `npm bootstrap ${bootstrap.version} != root ${root.version}`);
assert(bootstrap.bin?.comgu === 'bin/comgu-bootstrap.mjs', 'npm bootstrap must expose bin.comgu');
assert(bootstrap.engines?.node === '>=22', 'npm bootstrap must require Node.js >=22');
assert(!bootstrap.dependencies || Object.keys(bootstrap.dependencies).length === 0, 'npm bootstrap must not add runtime dependencies');
assert(!bootstrap.scripts, 'npm bootstrap must not require lifecycle scripts');
assert(Array.isArray(bootstrap.files) && bootstrap.files.every((entry) => ['bin/', 'lib/', 'README.md'].includes(entry)), 'npm files allowlist is broader than expected');
assert(shell.includes('SHA256SUMS.txt') && shell.includes('sha256sum'), 'install.sh must verify SHA256SUMS.txt');
assert(powershell.includes('SHA256SUMS.txt') && powershell.includes('Get-FileHash'), 'install.ps1 must verify SHA256SUMS.txt');
assert(shell.includes('releases/latest/download/install.sh'), 'shell update must use a release-pinned installer asset');
assert(powershell.includes('releases/latest/download/install.ps1'), 'PowerShell update must use a release-pinned installer asset');
console.log(`ComGu CLI installer contract verified for ${root.version}.`);
