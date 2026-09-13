import type { CliTarget } from './platform.mjs';

export function assetNameForTarget(target: CliTarget): string;
export function normalizeVersion(input: string): { version: string; tag: string };
export function parseSha256Sums(text: string): Map<string, string>;
export function verifySha256(file: string, expected: string): Promise<string>;
export function releaseAssetUrl(tag: string, filename: string, repository?: string): string;
export function downloadFile(url: string, destination: string, fetchImpl?: typeof fetch): Promise<string>;
export function extractCliArchive(archive: string, target: CliTarget, destination: string): Promise<string>;
export function packagedLauncher(payloadDir: string, target: CliTarget): string;
export function installRelease(options: {
  version: string;
  platform?: string;
  arch?: string;
  installRoot: string;
  channel?: string;
  repository?: string;
  releaseBaseUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{
  version: string;
  tag: string;
  target: CliTarget;
  asset: string;
  payloadDir: string;
  launcher: string;
  reused: boolean;
  sha256?: string;
  channel?: string;
  platform?: string;
  arch?: string;
}>;
export function removeInstallerPayload(installRoot: string): Promise<void>;
export function defaultNpmInstallRoot(packageRoot: string): string;
export function defaultUserInstallRoot(platform?: string): string;

