import { safeStorage } from 'electron';
import { logInfo } from './logger.js';

const PROBE_TEXT = 'chat-on-steroids-safe-storage-probe';

export type SecureStorageProbeFormat = 'none' | 'v10' | 'v11' | 'other';

export interface SecureStorageProbe {
  platform: NodeJS.Platform;
  asyncAvailable: boolean;
  selectedBackend: string | null;
  probeFormat: SecureStorageProbeFormat;
  protected: boolean;
  error: 'availability' | 'encrypt' | null;
}

let probeInFlight: Promise<SecureStorageProbe> | null = null;
let lastLoggedSummary = '';

function selectedLinuxBackend(): string | null {
  try {
    return typeof safeStorage.getSelectedStorageBackend === 'function'
      ? safeStorage.getSelectedStorageBackend()
      : null;
  } catch {
    return null;
  }
}

function recordProbe(probe: SecureStorageProbe): SecureStorageProbe {
  const summary = [
    `platform=${probe.platform}`,
    `async=${probe.asyncAvailable}`,
    `backend=${probe.selectedBackend ?? 'none'}`,
    `format=${probe.probeFormat}`,
    `protected=${probe.protected}`,
    `error=${probe.error ?? 'none'}`
  ].join(' ');
  if (summary !== lastLoggedSummary) {
    lastLoggedSummary = summary;
    logInfo(`secure-storage probe ${summary}`);
  }
  return probe;
}

async function runProbe(platform: NodeJS.Platform): Promise<SecureStorageProbe> {
  let asyncAvailable = false;
  try {
    asyncAvailable = await safeStorage.isAsyncEncryptionAvailable();
  } catch {
    return recordProbe({
      platform,
      asyncAvailable: false,
      selectedBackend: platform === 'linux' ? selectedLinuxBackend() : null,
      probeFormat: 'none',
      protected: false,
      error: 'availability'
    });
  }

  const selectedBackend = platform === 'linux' ? selectedLinuxBackend() : null;
  if (!asyncAvailable) {
    return recordProbe({
      platform,
      asyncAvailable: false,
      selectedBackend,
      probeFormat: 'none',
      protected: false,
      error: null
    });
  }

  if (platform !== 'linux') {
    return recordProbe({
      platform,
      asyncAvailable: true,
      selectedBackend: null,
      probeFormat: 'none',
      protected: true,
      error: null
    });
  }

  try {
    const encrypted = await safeStorage.encryptStringAsync(PROBE_TEXT);
    const prefix = encrypted.subarray(0, 3).toString('ascii');
    const probeFormat: SecureStorageProbeFormat = prefix === 'v10' ? 'v10' : prefix === 'v11' ? 'v11' : 'other';
    return recordProbe({
      platform,
      asyncAvailable: true,
      selectedBackend,
      probeFormat,
      protected: probeFormat !== 'v10',
      error: null
    });
  } catch {
    return recordProbe({
      platform,
      asyncAvailable: true,
      selectedBackend,
      probeFormat: 'none',
      protected: false,
      error: 'encrypt'
    });
  }
}

export function probeSecureStorage(platform: NodeJS.Platform = process.platform): Promise<SecureStorageProbe> {
  if (probeInFlight) return probeInFlight;
  const flight = runProbe(platform);
  probeInFlight = flight;
  return flight.finally(() => {
    if (probeInFlight === flight) probeInFlight = null;
  });
}

export function resetSecureStorageProbeForTests(): void {
  probeInFlight = null;
  lastLoggedSummary = '';
}
