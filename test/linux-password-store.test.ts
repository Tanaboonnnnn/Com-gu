import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { passwordStoreForDesktop } from '../src/main/linux-password-store.js';

describe('Linux password-store selection', () => {
  it('selects libsecret only for GNOME-like desktops and leaves KDE/unknown to Electron', () => {
    expect(passwordStoreForDesktop('ubuntu:GNOME')).toBe('gnome-libsecret');
    expect(passwordStoreForDesktop('GNOME')).toBe('gnome-libsecret');
    expect(passwordStoreForDesktop('Unity:ubuntu:GNOME')).toBe('gnome-libsecret');
    expect(passwordStoreForDesktop('KDE')).toBeNull();
    expect(passwordStoreForDesktop(undefined)).toBeNull();
  });

  it('preserves an explicit user password-store switch before applying the GNOME default', () => {
    const source = readFileSync(path.join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8');
    const guard = source.indexOf("!app.commandLine.hasSwitch('password-store')");
    const append = source.indexOf("app.commandLine.appendSwitch('password-store', store)");
    expect(guard).toBeGreaterThan(-1);
    expect(append).toBeGreaterThan(guard);
  });
});
