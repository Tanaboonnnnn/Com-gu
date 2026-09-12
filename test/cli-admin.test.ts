import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdminCommand } from '../src/cli/commands/admin.js';
import { initConfigPath, loadConfig } from '../src/main/config.js';
import { loadMachineProfile } from '../src/main/machine/profile.js';
import { makeTempDir, removeTempDir } from './helpers.js';

const unavailableVault = () => ({
  status: async () => ({
    available: false as const,
    readable: false as const,
    reason: 'provider_unavailable' as const,
    detail: 'test'
  })
});

let profileDir: string;

beforeEach(async () => {
  profileDir = await makeTempDir('comgu-cli-admin-');
});

afterEach(async () => {
  await removeTempDir(profileDir);
});

describe('CLI profile administration', () => {
  it('adds only an existing directory as an approved root and derives a valid unique name', async () => {
    const project = path.join(profileDir, 'My Project');
    await fs.mkdir(project);
    const result = await runAdminCommand('roots', ['add', project], { profileDir });
    expect(result.json).toMatchObject({ name: 'my-project', path: path.resolve(project) });
    await expect(runAdminCommand('roots', ['add', path.join(profileDir, 'missing')], { profileDir })).rejects.toThrow(/existing directory/i);
  });

  it('changes permissions through the shared config validator and preserves unrelated choices', async () => {
    await runAdminCommand('permissions', ['command', 'off'], { profileDir });
    initConfigPath(profileDir);
    const config = await loadConfig();
    expect(config.capabilities.command).toBe(false);
    expect(config.capabilities.read).toBe(true);
    await runAdminCommand('permissions', ['read-only', 'on'], { profileDir });
    expect((await loadConfig()).readOnly).toBe(true);
  });

  it('renames a machine without rotating its UUID and tells the user to reconnect metadata', async () => {
    const before = await loadMachineProfile(profileDir, { suggestedName: 'old-name' });
    const result = await runAdminCommand('machine', ['rename', 'home-server'], { profileDir });
    const after = await loadMachineProfile(profileDir);
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('home-server');
    expect(after.confirmed).toBe(true);
    expect(result.text).toMatch(/reconnect/i);
  });

  it('refuses clone preparation while another runtime owns the profile', async () => {
    await loadMachineProfile(profileDir);
    await expect(
      runAdminCommand('machine', ['prepare-clone', '--yes'], {
        profileDir,
        ownerStatus: async () => ({ runtime: 'running' })
      })
    ).rejects.toThrow(/Stop the ComGu runtime/i);
    expect(await fs.stat(path.join(profileDir, 'machine.json'))).toBeTruthy();
  });

  it('prepares a clone transactionally while preserving roots and permission choices', async () => {
    const project = path.join(profileDir, 'project');
    await fs.mkdir(project);
    await runAdminCommand('roots', ['add', project], { profileDir });
    await runAdminCommand('permissions', ['command', 'off'], { profileDir });
    await loadMachineProfile(profileDir);
    for (const file of ['credentials.key', 'credentials.vault', 'secrets.bin', 'control.auth']) {
      await fs.writeFile(path.join(profileDir, file), 'opaque');
    }

    await runAdminCommand('machine', ['prepare-clone', '--yes'], {
      profileDir,
      ownerStatus: async () => { throw new Error('No owner'); }
    });

    await expect(fs.access(path.join(profileDir, 'machine.json'))).rejects.toBeDefined();
    await expect(fs.access(path.join(profileDir, 'credentials.vault'))).rejects.toBeDefined();
    initConfigPath(profileDir);
    const config = await loadConfig();
    expect(config.roots).toHaveLength(1);
    expect(config.capabilities.command).toBe(false);
    expect(config.ui.autoConnect).toBe(false);
    expect(config.tunnel.tunnelId).toBe('');
    expect(config.tunnel.desktopTunnelId).toBe('');
  });

  it('keeps legacy connector names until the machine alias is explicitly confirmed', async () => {
    const first = await runAdminCommand('setup', [], { profileDir, credentialVaultFactory: unavailableVault });
    expect((first.json as { connectors: Array<{ connectorName: string }> }).connectors[0]?.connectorName).toBe('ComGu Core');
    const confirmed = await runAdminCommand('setup', ['--name', 'ubuntu-laptop'], { profileDir, credentialVaultFactory: unavailableVault });
    expect((confirmed.json as { connectors: Array<{ connectorName: string }> }).connectors[0]?.connectorName).toBe('ComGu · ubuntu-laptop Core');
  });

  it('enables only Desktop permissions proven by the explicit setup probe', async () => {
    await runAdminCommand('setup', ['--name', 'linux-box', '--desktop'], {
      profileDir,
      credentialVaultFactory: unavailableVault,
      desktopProbe: async () => ({
        available: true, capture: true, pointer: true, keyboard: true,
        clipboardRead: false, clipboardWrite: false, windows: false, uiElements: false, focus: false
      })
    });
    initConfigPath(profileDir);
    const config = await loadConfig();
    expect(config.capabilities).toMatchObject({ screen: true, control: true, clipboardRead: false, clipboardWrite: false });
  });
});
