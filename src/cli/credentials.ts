import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createCredentialVault, type CredentialVault } from '../main/credentials/vault.js';
import {
  bootstrapLinuxFallbackKey,
  createLinuxCredentialProvider,
  LINUX_FALLBACK_KEY_FILE
} from '../main/credentials/linux-provider.js';
import { createWindowsCredentialProvider } from '../main/credentials/windows-provider.js';
import type { MachineIdentity } from '../main/machine/profile.js';

export function createCliCredentialVault(profileDir: string, machine: MachineIdentity): CredentialVault {
  if (process.platform === 'win32') {
    return createCredentialVault({ directory: profileDir, provider: createWindowsCredentialProvider() });
  }
  if (process.platform === 'linux') {
    return createCredentialVault({
      directory: profileDir,
      provider: createLinuxCredentialProvider({
        scope: machine.id,
        fallbackKeyPath: path.join(profileDir, LINUX_FALLBACK_KEY_FILE)
      })
    });
  }
  throw new Error('ComGu CLI V1 supports Windows and Linux only');
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function ensureCliCredentialVault(profileDir: string, machine: MachineIdentity): Promise<CredentialVault> {
  let vault = createCliCredentialVault(profileDir, machine);
  let status = await vault.status();
  if (status.available || process.platform !== 'linux') return vault;

  const [keyExists, vaultExists] = await Promise.all([
    exists(path.join(profileDir, 'credentials.key')),
    exists(path.join(profileDir, 'credentials.vault'))
  ]);
  if (keyExists || vaultExists) {
    throw new Error('Existing credentials cannot be unlocked because their secure Linux credential source is unavailable. Restore the previous credential source before continuing.');
  }

  await bootstrapLinuxFallbackKey(profileDir);
  vault = createCliCredentialVault(profileDir, machine);
  status = await vault.status();
  if (!status.available) throw new Error('Secure Linux credential storage could not be initialized');
  return vault;
}
