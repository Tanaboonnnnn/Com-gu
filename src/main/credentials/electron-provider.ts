import { safeStorage } from 'electron';
import { probeSecureStorage } from '../secure-storage-probe.js';
import type { CredentialProvider } from './provider.js';

function unavailableError(): Error {
  return new Error('Secure credential storage is unavailable');
}

/**
 * Electron adapter for the credential-provider seam. It protects only opaque vault master-key
 * bytes. Logical credential names/values remain entirely inside CredentialVault.
 */
export function createElectronCredentialProvider(
  platform: NodeJS.Platform = process.platform
): CredentialProvider {
  return {
    async status() {
      try {
        const probe = await probeSecureStorage(platform);
        if (!probe.asyncAvailable || probe.error !== null || !probe.protected) {
          return {
            available: false as const,
            reason: 'provider_unavailable' as const,
            detail:
              platform === 'linux' && probe.probeFormat === 'v10'
                ? 'Linux secure storage selected Chromium v10 hard-coded-key fallback.'
                : 'Secure operating-system credential storage is unavailable.'
          };
        }
        return { available: true as const, reason: 'available' as const };
      } catch {
        return {
          available: false as const,
          reason: 'provider_unavailable' as const,
          detail: 'Secure operating-system credential storage is unavailable.'
        };
      }
    },

    async protect(data) {
      if (!(await this.status()).available) throw unavailableError();
      let encrypted: Buffer;
      try {
        encrypted = await safeStorage.encryptStringAsync(data.toString('base64'));
      } catch {
        throw unavailableError();
      }
      if (platform === 'linux' && encrypted.subarray(0, 3).toString('ascii') === 'v10') {
        throw unavailableError();
      }
      return encrypted;
    },

    async unprotect(data) {
      if (!(await this.status()).available) throw unavailableError();
      try {
        const decrypted = await safeStorage.decryptStringAsync(data);
        return {
          data: Buffer.from(decrypted.result, 'base64'),
          shouldReprotect: decrypted.shouldReEncrypt
        };
      } catch {
        throw unavailableError();
      }
    }
  };
}
