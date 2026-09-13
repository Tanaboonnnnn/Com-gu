import { createCredentialVault, type CredentialVault } from '../main/credentials/vault.js';
import { createLinuxCredentialProvider } from '../main/credentials/linux-provider.js';
import { createWindowsCredentialProvider } from '../main/credentials/windows-provider.js';
import type { MachineIdentity } from '../main/machine/profile.js';

export function createCliCredentialVault(profileDir: string, machine: MachineIdentity): CredentialVault {
  if (process.platform === 'win32') {
    return createCredentialVault({ directory: profileDir, provider: createWindowsCredentialProvider() });
  }
  if (process.platform === 'linux') {
    return createCredentialVault({
      directory: profileDir,
      provider: createLinuxCredentialProvider({ scope: machine.id })
    });
  }
  throw new Error('ComGu CLI V1 supports Windows and Linux only');
}
