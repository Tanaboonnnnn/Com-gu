// Packaged ComGu copies its bundled unpacked extension to a stable userData directory on launch.
// The running service worker reloads only after the on-disk manifest matches the app version,
// preventing an update failure from becoming an infinite extension reload loop.
export function safeToReloadExtension(appVersion: string, diskVersion: string): boolean {
  return appVersion === diskVersion;
}

// After extension reload, existing ChatGPT tabs are repaired by reinjecting isolated content code
// and the MAIN-world Fiber helper without reloading the user's page.
