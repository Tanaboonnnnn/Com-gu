import type { ExtensionPairingView } from '../shared/types.js';
import { getSecret, setSecret } from './secrets.js';

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
let pendingOrigin: string | null = null;

export function validExtensionOrigin(origin: string | null): origin is string {
  return typeof origin === 'string' && EXTENSION_ORIGIN.test(origin);
}

export async function extensionPairingView(): Promise<ExtensionPairingView> {
  const approved = await getSecret('approvedExtensionOrigin');
  return { approvedOrigin: approved || null, pendingOrigin };
}

export async function extensionOriginApproved(origin: string | null): Promise<boolean> {
  if (!validExtensionOrigin(origin)) return false;
  const approved = await getSecret('approvedExtensionOrigin');
  return Boolean(approved) && approved === origin;
}

export async function requestExtensionPairing(origin: string): Promise<'approved' | 'pending'> {
  if (!validExtensionOrigin(origin)) throw new Error('Invalid extension origin');
  if (await extensionOriginApproved(origin)) {
    pendingOrigin = null;
    return 'approved';
  }
  pendingOrigin = origin;
  return 'pending';
}

export async function approvePendingExtensionOrigin(expectedOrigin: string): Promise<void> {
  const approvedOrigin = pendingOrigin;
  if (!approvedOrigin) throw new Error('No extension is waiting for approval');
  if (approvedOrigin !== expectedOrigin) {
    throw new Error('The extension waiting for approval changed; review the current extension before approving it');
  }
  await setSecret('approvedExtensionOrigin', approvedOrigin);
  // A different extension may have requested pairing while persistence yielded. Do not erase
  // a pending identity that arrived after the user approved this exact reviewed origin.
  if (pendingOrigin === approvedOrigin) pendingOrigin = null;
}

export async function revokeExtensionOrigin(): Promise<void> {
  await setSecret('approvedExtensionOrigin', '');
  await setSecret('bridgeToken', '');
  pendingOrigin = null;
}

export function resetExtensionPairingForTests(): void {
  pendingOrigin = null;
}
