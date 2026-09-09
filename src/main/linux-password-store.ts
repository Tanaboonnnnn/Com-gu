/**
 * Electron's Linux async OSCrypt stack can fall through to the public-key `v10` provider even
 * when GNOME Secret Service is available. GNOME has one unambiguous secure backend name, so on
 * GNOME-like desktops we may request it explicitly before Electron initialises OSCrypt. KDE is
 * deliberately left to Electron because forcing the wrong KWallet generation is less safe than
 * its native desktop detection.
 */
export function passwordStoreForDesktop(desktop: string | undefined): 'gnome-libsecret' | null {
  const parts = String(desktop ?? '')
    .split(':')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return parts.some((part) => part === 'gnome' || part === 'ubuntu' || part === 'unity')
    ? 'gnome-libsecret'
    : null;
}
