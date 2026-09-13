export const CLI_TARGETS: Readonly<Record<string, string>>;
export const CLI_FORBIDDEN_SOURCE_FRAGMENTS: readonly string[];
export function cliArtifactName(platform: string, arch: string): string;
