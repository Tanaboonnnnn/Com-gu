import { describe, expect, it } from 'vitest';
import {
  CommandSandboxUnavailableError,
  commandSandboxCapability,
  requireCommandSandbox,
  type WorkspaceScope
} from '../src/main/run/command-sandbox.js';

const scope: WorkspaceScope = {
  root: 'C:\\workspace',
  cwd: 'C:\\workspace\\repo'
};

describe('command sandbox confinement contract', () => {
  it('never equates an ordinary process launch with filesystem confinement', () => {
    const capability = commandSandboxCapability(scope, 'win32');

    expect(capability).toEqual({
      available: false,
      filesystemConfinement: 'unavailable',
      backend: null,
      scope,
      reason: 'windows_backend_unavailable'
    });
  });

  it('fails closed when trustworthy filesystem confinement is unavailable', () => {
    expect(() =>
      requireCommandSandbox(scope, 'win32')
    ).toThrow(CommandSandboxUnavailableError);
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
