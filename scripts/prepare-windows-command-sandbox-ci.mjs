import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { getPlatformSupport } from '@microsoft/mxc-sdk';

if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Refusing MXC host preparation outside an explicit GitHub Actions runner.');
}
if (process.platform !== 'win32') {
  process.stdout.write('MXC Windows host preparation skipped on non-Windows runner.\n');
  process.exit(0);
}
if (process.arch !== 'x64' && process.arch !== 'arm64') {
  throw new Error(`Unsupported Windows architecture for MXC host preparation: ${process.arch}`);
}

const helper = path.resolve(
  'node_modules',
  '@microsoft',
  'mxc-sdk',
  'bin',
  process.arch,
  'wxc-host-prep.exe'
);

function requiredSteps(support) {
  const warnings = Array.isArray(support?.isolationWarnings) ? support.isolationWarnings : [];
  const steps = [];
  if (warnings.some((warning) => String(warning).includes('prepare-system-drive'))) steps.push('prepare-system-drive');
  if (warnings.some((warning) => String(warning).includes('prepare-null-device'))) steps.push('prepare-null-device');
  return steps;
}

const before = getPlatformSupport();
if (!before.isSupported || !before.availableMethods?.includes('processcontainer')) {
  throw new Error(`Windows CI runner has no proven MXC ProcessContainer backend: ${JSON.stringify(before)}`);
}

for (const step of requiredSteps(before)) {
  process.stdout.write(`Preparing ephemeral Windows runner for MXC: ${step}\n`);
  const result = spawnSync(helper, [step], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wxc-host-prep ${step} exited ${result.status ?? 'unknown'}`);
}

const after = getPlatformSupport();
const remaining = requiredSteps(after);
if (!after.isSupported || !after.availableMethods?.includes('processcontainer') || remaining.length > 0) {
  throw new Error(`MXC Windows CI host preparation did not become ready: ${JSON.stringify(after)}`);
}
process.stdout.write('MXC Windows CI command confinement is ready.\n');
