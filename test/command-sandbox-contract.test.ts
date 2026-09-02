import { describe, expect, it } from 'vitest';
import {
  CommandSandboxUnavailableError,
  commandSandboxCapability,
  commandSandboxHostPreparation,
  requireCommandSandbox,
  type WorkspaceScope
} from '../src/main/run/command-sandbox.js';

const scope: WorkspaceScope = {
  roots: ['C:\\workspace', 'C:\\shared'],
  cwd: 'C:\\workspace\\repo'
};

describe('command sandbox confinement contract', () => {
  it.skipIf(process.platform !== 'win32')('reports the proven MXC ProcessContainer backend only when host preparation is complete', () => {
    const preparation = commandSandboxHostPreparation();
    const capability = commandSandboxCapability(scope, 'win32');

    if (preparation.required) {
      expect(capability).toMatchObject({
        available: false,
        filesystemConfinement: 'unavailable',
        backend: null,
        reason: 'windows_host_preparation_required'
      });
    } else {
      expect(capability).toMatchObject({
        available: true,
        filesystemConfinement: 'os-enforced',
        backend: 'mxc-processcontainer'
      });
    }
    expect(capability.scope).toEqual(scope);
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

  it('detects required MXC host preparation from the read-only platform probe', () => {
    const preparation = commandSandboxHostPreparation({
      isSupported: true,
      availableMethods: ['processcontainer'],
      isolationTier: 'appcontainer-dacl',
      isolationWarnings: [
        'Run wxc-host-prep prepare-system-drive (elevated) to grant the minimal metadata ACEs.',
        'Run wxc-host-prep prepare-null-device (elevated) to allow the null device.'
      ]
    });

    expect(preparation.required).toBe(true);
    expect(preparation.steps).toEqual(['prepare-system-drive', 'prepare-null-device']);
    expect(Object.isFrozen(preparation.steps)).toBe(true);
  });

  it.skipIf(process.platform !== 'win32')('requires host preparation before returning a usable capability', () => {
    const preparation = commandSandboxHostPreparation();
    if (preparation.required) {
      expect(() => requireCommandSandbox(scope, 'win32')).toThrow('windows_host_preparation_required');
    } else {
      expect(requireCommandSandbox(scope, 'win32')).toMatchObject({
        available: true,
        filesystemConfinement: 'os-enforced',
        backend: 'mxc-processcontainer'
      });
    }
  });

  it('fails closed with a stable diagnostic when trustworthy confinement is unavailable', () => {
    let thrown: unknown;
    try {
      requireCommandSandbox(scope, 'linux');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandSandboxUnavailableError);
    const error = thrown as CommandSandboxUnavailableError;
    expect(error.name).toBe('CommandSandboxUnavailableError');
    expect(error.message).toBe('Command sandbox unavailable: unsupported_platform');
    expect(error.capability.reason).toBe('unsupported_platform');
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
