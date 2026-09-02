import { describe, expect, it } from 'vitest';
import {
  CommandSandboxUnavailableError,
  commandSandboxCapability,
  requireCommandSandbox,
  type WorkspaceScope
} from '../src/main/run/command-sandbox.js';

const scope: WorkspaceScope = {
  roots: ['C:\\workspace', 'C:\\shared'],
  cwd: 'C:\\workspace\\repo'
};

describe('command sandbox confinement contract', () => {
  it('does not claim filesystem confinement without an OS-enforced backend', () => {
    const capability = commandSandboxCapability(scope, 'win32');

    expect(capability).toEqual({
      available: false,
      filesystemConfinement: 'unavailable',
      backend: null,
      scope,
      reason: 'windows_backend_unavailable'
    });
  });

  it('snapshots the effective multi-root scope immutably', () => {
    const roots = ['C:\\primary', 'C:\\shared'];
    const mutableScope = { roots, cwd: 'C:\\primary\\repo' };
    const capability = commandSandboxCapability(mutableScope, 'win32');

    roots.push('C:\\outside');
    mutableScope.cwd = 'C:\\outside';

    expect(capability.scope).toEqual({
      roots: ['C:\\primary', 'C:\\shared'],
      cwd: 'C:\\primary\\repo'
    });
    expect(Object.isFrozen(capability.scope)).toBe(true);
    expect(Object.isFrozen(capability.scope.roots)).toBe(true);
  });

  it('fails closed with a stable diagnostic when trustworthy confinement is unavailable', () => {
    let thrown: unknown;
    try {
      requireCommandSandbox(scope, 'win32');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandSandboxUnavailableError);
    const error = thrown as CommandSandboxUnavailableError;
    expect(error.name).toBe('CommandSandboxUnavailableError');
    expect(error.message).toBe('Command sandbox unavailable: windows_backend_unavailable');
    expect(error.capability.reason).toBe('windows_backend_unavailable');
    expect(error.capability.available).toBe(false);
    expect(error.capability.filesystemConfinement).toBe('unavailable');
    expect(error.capability.backend).toBeNull();
    expect(error.capability.scope).toEqual(scope);
    expect(error.capability.scope).not.toBe(scope);
    expect(error.capability.scope.roots).not.toBe(scope.roots);
  });

  it('does not claim confinement on non-Windows platforms without a proven backend', () => {
    const capability = commandSandboxCapability(scope, 'linux');

    expect(capability.available).toBe(false);
    if (capability.available) throw new Error('unexpected sandbox backend');
    expect(capability.filesystemConfinement).toBe('unavailable');
    expect(capability.backend).toBeNull();
    expect(capability.reason).toBe('unsupported_platform');
  });
});
