export const CLI_TARGETS = Object.freeze({
  'win32-x64': 'ComGu-CLI-windows-x64.zip',
  'win32-arm64': 'ComGu-CLI-windows-arm64.zip',
  'linux-x64': 'ComGu-CLI-linux-x64.tar.gz',
  'linux-arm64': 'ComGu-CLI-linux-arm64.tar.gz'
});

export const CLI_FORBIDDEN_SOURCE_FRAGMENTS = Object.freeze([
  '/src/main/index.ts',
  '/src/main/bridge.ts',
  '/src/main/agents.ts',
  '/src/main/session/recorder.ts',
  '/src/main/session/store.ts',
  '/src/main/goal.ts',
  '/src/renderer/',
  '/src/preload/'
]);

export function cliArtifactName(platform, arch) {
  const name = CLI_TARGETS[`${platform}-${arch}`];
  if (!name) throw new Error(`Unsupported ComGu CLI target: ${platform}-${arch}`);
  return name;
}
