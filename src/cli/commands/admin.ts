import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CAPABILITIES, DESKTOP_CAPABILITIES, type Capability } from '../../shared/types.js';
import { getConfig, initConfigPath, loadConfig, updateConfig } from '../../main/config.js';
import { connectorMetadata } from '../../main/machine/metadata.js';
import {
  loadMachineProfile,
  prepareMachineClone,
  renameMachine,
  suggestedMachineName,
  type MachineIdentity
} from '../../main/machine/profile.js';
import { RESERVED_ROOT_NAMES } from '../../main/sandbox.js';
import { createCliCredentialVault } from '../credentials.js';
import type { DesktopCapabilities } from '../../main/desktop/driver.js';

export interface AdminCommandContext {
  profileDir: string;
  ownerStatus?(): Promise<unknown>;
  desktopProbe?(): Promise<DesktopCapabilities | null>;
}

export interface AdminCommandResult {
  text: string;
  json: unknown;
}

function flagValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Usage: ${flag} <value>`);
  return value;
}

async function state(profileDir: string): Promise<{ machine: MachineIdentity }> {
  await fs.mkdir(profileDir, { recursive: true });
  initConfigPath(profileDir);
  await loadConfig();
  return { machine: await loadMachineProfile(profileDir) };
}

function rootNameFor(target: string, existing: Set<string>): string {
  const raw = path.basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '');
  const base = (raw || 'workspace').slice(0, 32);
  let candidate = RESERVED_ROOT_NAMES.has(base) ? `${base}-folder`.slice(0, 32) : base;
  for (let suffix = 2; existing.has(candidate) || RESERVED_ROOT_NAMES.has(candidate); suffix += 1) {
    const tail = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 32 - tail.length))}${tail}`;
  }
  return candidate;
}

async function addRoot(profileDir: string, target: string): Promise<AdminCommandResult> {
  await state(profileDir);
  const resolved = path.resolve(target);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('Approved root must be an existing directory');
  const next = await updateConfig((config) => {
    if (config.roots.some((root) => path.resolve(root.path) === resolved)) return config;
    const name = rootNameFor(resolved, new Set(config.roots.map((root) => root.name)));
    return { ...config, roots: [...config.roots, { name, path: resolved }] };
  });
  const root = next.roots.find((item) => path.resolve(item.path) === resolved)!;
  return { text: `Added root ${root.name}: ${root.path}`, json: root };
}

async function removeRoot(profileDir: string, name: string): Promise<AdminCommandResult> {
  await state(profileDir);
  let removed = false;
  const next = await updateConfig((config) => {
    removed = config.roots.some((root) => root.name === name);
    return { ...config, roots: config.roots.filter((root) => root.name !== name) };
  });
  if (!removed) throw new Error(`No approved root named ${name}`);
  return { text: `Removed root ${name}.`, json: next.roots };
}

async function setPermission(profileDir: string, name: string, value: string): Promise<AdminCommandResult> {
  await state(profileDir);
  if (value !== 'on' && value !== 'off') throw new Error('Permission value must be on or off');
  const enabled = value === 'on';
  if (name === 'read-only') {
    const next = await updateConfig((config) => ({ ...config, readOnly: enabled }));
    return { text: `read-only: ${next.readOnly ? 'on' : 'off'}`, json: { readOnly: next.readOnly } };
  }
  if (!(CAPABILITIES as readonly string[]).includes(name)) throw new Error(`Unknown permission: ${name}`);
  const capability = name as Capability;
  const next = await updateConfig((config) => ({
    ...config,
    capabilities: { ...config.capabilities, [capability]: enabled }
  }));
  return { text: `${capability}: ${next.capabilities[capability] ? 'on' : 'off'}`, json: { [capability]: next.capabilities[capability] } };
}

async function ownerExists(context: AdminCommandContext): Promise<boolean> {
  if (!context.ownerStatus) return false;
  try {
    await context.ownerStatus();
    return true;
  } catch {
    return false;
  }
}

async function scrubCloneUnsafeState(profileDir: string): Promise<void> {
  initConfigPath(profileDir);
  await loadConfig();
  await updateConfig((config) => ({
    ...config,
    tunnel: { ...config.tunnel, tunnelId: '', desktopTunnelId: '' },
    ui: { ...config.ui, autoConnect: false }
  }));
  await Promise.all(
    ['credentials.key', 'credentials.vault', 'credentials.migrated', 'secrets.bin', 'control.auth'].map((name) =>
      fs.rm(path.join(profileDir, name), { force: true })
    )
  );
}

async function doctor(profileDir: string): Promise<AdminCommandResult> {
  const { machine } = await state(profileDir);
  const vault = createCliCredentialVault(profileDir, machine);
  const credential = await vault.status();
  let desktop: unknown = { kind: 'unsupported', reason: 'Desktop automation is unavailable on this platform.' };
  if (process.platform === 'win32') desktop = { kind: 'windows', available: true };
  if (process.platform === 'linux') {
    const session = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase();
    desktop = process.env.WAYLAND_DISPLAY || session === 'wayland'
      ? { kind: 'wayland', available: null, reason: 'Run `comgu setup --desktop` to request and verify portal capabilities.' }
      : process.env.DISPLAY || session === 'x11'
        ? { kind: 'x11', available: null, reason: 'Run `comgu setup --desktop` to verify X11 helper capabilities.' }
        : { kind: 'headless', available: false, reason: 'No graphical Linux session is active.' };
  }
  const result = {
    machine: { id: machine.id, name: machine.name, confirmed: machine.confirmed },
    roots: getConfig().roots.length,
    credential,
    desktop
  };
  return {
    text: [
      `Machine: ${machine.name}${machine.confirmed ? '' : ' (name not confirmed)'}`,
      `Approved roots: ${result.roots}`,
      `Secure credentials: ${credential.available ? 'available' : 'unavailable'}`,
      `Desktop: ${(desktop as { kind?: string }).kind ?? 'unknown'}`
    ].join('\n'),
    json: result
  };
}

async function setup(profileDir: string, args: string[], context: AdminCommandContext): Promise<AdminCommandResult> {
  let { machine } = await state(profileDir);
  const requestedName = flagValue(args, '--name');
  if (requestedName) machine = await renameMachine(profileDir, requestedName);
  const root = flagValue(args, '--root');
  if (root) await addRoot(profileDir, root);
  if (args.includes('--desktop')) {
    let capabilities: DesktopCapabilities | null = null;
    if (context.desktopProbe) capabilities = await context.desktopProbe();
    else if (process.platform === 'win32') {
      capabilities = {
        available: true, capture: true, pointer: true, keyboard: true,
        clipboardRead: true, clipboardWrite: true, windows: true, uiElements: true, focus: true
      };
    } else if (process.platform === 'linux') {
      const { probeLinuxDesktop } = await import('../../main/desktop/linux/index.js');
      const probed = await probeLinuxDesktop();
      if (probed.driver) {
        capabilities = await probed.driver.capabilities();
        await probed.driver.dispose().catch(() => undefined);
      }
    }
    if (!capabilities?.available) throw new Error('Desktop setup was requested, but no usable graphical Desktop capability was proven. Core settings were left usable.');
    await updateConfig((config) => ({
      ...config,
      capabilities: {
        ...config.capabilities,
        screen: capabilities.capture,
        control: capabilities.pointer && capabilities.keyboard,
        clipboardRead: capabilities.clipboardRead,
        clipboardWrite: capabilities.clipboardWrite
      }
    }));
  }
  const vault = createCliCredentialVault(profileDir, machine);
  const credential = await vault.status();
  const core = connectorMetadata(machine, 'core');
  const desktopEnabled = DESKTOP_CAPABILITIES.some((capability) => getConfig().capabilities[capability]);
  const desktop = desktopEnabled ? connectorMetadata(machine, 'desktop') : null;
  const result = {
    machine,
    suggestedName: machine.confirmed ? null : suggestedMachineName(machine.name),
    roots: getConfig().roots,
    credential,
    connectors: [core, ...(desktop ? [desktop] : [])]
  };
  return {
    text: [
      `Machine: ${machine.name}${machine.confirmed ? '' : ' (suggested; confirm with --name)'}`,
      ...result.connectors.map((item) => `Connector: ${item.connectorName}`),
      `Secure credential source: ${credential.available ? 'available' : 'unavailable'}`
    ].join('\n'),
    json: result
  };
}

export async function runAdminCommand(
  command: string,
  args: string[],
  context: AdminCommandContext
): Promise<AdminCommandResult> {
  if (command === 'setup') return setup(context.profileDir, args, context);
  if (command === 'doctor') return doctor(context.profileDir);

  if (command === 'roots') {
    const action = args[0] ?? 'list';
    if (action === 'list') {
      await state(context.profileDir);
      const roots = getConfig().roots;
      return { text: roots.length ? roots.map((root) => `${root.name}\t${root.path}`).join('\n') : 'No approved roots.', json: roots };
    }
    if (action === 'add' && args[1]) return addRoot(context.profileDir, args[1]);
    if (action === 'remove' && args[1]) return removeRoot(context.profileDir, args[1]);
    throw new Error('Usage: comgu roots <list|add <path>|remove <name>>');
  }

  if (command === 'permissions') {
    await state(context.profileDir);
    if (args.length === 0) {
      const config = getConfig();
      const json = { ...config.capabilities, readOnly: config.readOnly };
      return { text: Object.entries(json).map(([name, enabled]) => `${name}: ${enabled ? 'on' : 'off'}`).join('\n'), json };
    }
    if (args.length === 2) return setPermission(context.profileDir, args[0]!, args[1]!);
    throw new Error('Usage: comgu permissions [<permission|read-only> <on|off>]');
  }

  if (command === 'machine') {
    const action = args[0] ?? 'show';
    if (action === 'show') {
      const machine = await loadMachineProfile(context.profileDir);
      return { text: `${machine.name}\n${machine.id}\nconfirmed: ${machine.confirmed ? 'yes' : 'no'}`, json: machine };
    }
    if (action === 'rename' && args[1]) {
      const machine = await renameMachine(context.profileDir, args[1]);
      const text = `Renamed machine to ${machine.name}. Reconnect the ChatGPT connector to refresh its displayed name.`;
      return { text, json: { machine, reconnectRequired: true } };
    }
    if (action === 'prepare-clone') {
      if (!args.includes('--yes')) throw new Error('Clone preparation deletes machine identity and credentials. Re-run with --yes to confirm.');
      if (await ownerExists(context)) throw new Error('Stop the ComGu runtime that owns this profile before preparing a clone.');
      await prepareMachineClone(context.profileDir, () => scrubCloneUnsafeState(context.profileDir));
      return {
        text: 'Clone preparation complete. Machine identity, remote tunnel bindings, credentials, pairing state, and local control auth were scrubbed; roots and permission choices were preserved.',
        json: { prepared: true }
      };
    }
    throw new Error('Usage: comgu machine <show|rename <name>|prepare-clone --yes>');
  }

  throw new Error(`Unsupported administrative command: ${command}`);
}
