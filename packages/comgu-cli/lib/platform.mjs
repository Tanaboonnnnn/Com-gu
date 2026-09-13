export function resolveCliTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'].includes(target)) {
    throw new Error(`Unsupported ComGu CLI target: ${platform}-${arch}`);
  }
  return target;
}
