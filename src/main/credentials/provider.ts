export type CredentialProviderStatus =
  | { available: true; reason: 'available'; detail?: string }
  | { available: false; reason: 'provider_unavailable'; detail?: string };

/**
 * Internal seam between the logical credential vault and host credential protection.
 * Providers know only opaque master-key bytes; they never see secret names or values.
 */
export interface CredentialProvider {
  status(): Promise<CredentialProviderStatus>;
  protect(data: Buffer): Promise<Buffer>;
  unprotect(data: Buffer): Promise<{ data: Buffer; shouldReprotect: boolean }>;
}
