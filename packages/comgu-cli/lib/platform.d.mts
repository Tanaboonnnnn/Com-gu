export type CliTarget = 'win32-x64' | 'win32-arm64' | 'linux-x64' | 'linux-arm64';
export function resolveCliTarget(platform?: string, arch?: string): CliTarget;
