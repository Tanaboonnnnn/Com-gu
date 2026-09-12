import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MACHINE_FILE = 'machine.json';
const MACHINE_NAME = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MachineIdentity {
  id: string;
  name: string;
  createdAt: string;
  confirmed: boolean;
}

export interface MachineProfileDependencies {
  suggestedName?: string;
  uuid?: () => string;
  now?: () => Date;
}

let activeProfile: MachineIdentity | null = null;
let activeDataDir: string | null = null;

function machinePath(dataDir: string): string {
  return path.join(dataDir, MACHINE_FILE);
}

function validateExplicitName(name: string): string {
  if (!MACHINE_NAME.test(name)) {
    throw new Error('Machine name must use lowercase letters, digits, dot, dash or underscore and be at most 32 characters.');
  }
  return name;
}

export function suggestedMachineName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/g, '')
    .slice(0, 32);
  return MACHINE_NAME.test(normalized) ? normalized : 'comgu-machine';
}

function parseMachineIdentity(raw: string): MachineIdentity {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Stored machine identity is malformed JSON and must be repaired explicitly.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored machine identity is malformed and must be repaired explicitly.');
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    !UUID.test(item.id) ||
    typeof item.name !== 'string' ||
    !MACHINE_NAME.test(item.name) ||
    typeof item.createdAt !== 'string' ||
    Number.isNaN(Date.parse(item.createdAt)) ||
    typeof item.confirmed !== 'boolean'
  ) {
    throw new Error('Stored machine identity is malformed and must be repaired explicitly.');
  }
  return {
    id: item.id,
    name: item.name,
    createdAt: item.createdAt,
    confirmed: item.confirmed
  };
}

async function writeMachineIdentity(dataDir: string, identity: MachineIdentity): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const target = machinePath(dataDir);
  const temp = `${target}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(identity, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

export async function loadMachineProfile(
  dataDir: string,
  dependencies: MachineProfileDependencies = {}
): Promise<MachineIdentity> {
  try {
    return parseMachineIdentity(await fs.readFile(machinePath(dataDir), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const identity: MachineIdentity = {
    id: (dependencies.uuid ?? randomUUID)(),
    name: suggestedMachineName(dependencies.suggestedName ?? os.hostname()),
    createdAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    confirmed: false
  };
  if (!UUID.test(identity.id)) throw new Error('Generated machine identity is not a valid UUID.');
  await writeMachineIdentity(dataDir, identity);
  return identity;
}

/** Initializes the process-local machine identity before model-facing metadata is built. */
export async function initMachineProfile(
  dataDir: string,
  dependencies: MachineProfileDependencies = {}
): Promise<MachineIdentity> {
  const loaded = await loadMachineProfile(dataDir, dependencies);
  activeProfile = loaded;
  activeDataDir = path.resolve(dataDir);
  return loaded;
}

export function currentMachineProfile(): MachineIdentity | null {
  return activeProfile ? { ...activeProfile } : null;
}

export async function renameMachine(dataDir: string, name: string): Promise<MachineIdentity> {
  const current = await loadMachineProfile(dataDir);
  const next: MachineIdentity = { ...current, name: validateExplicitName(name), confirmed: true };
  await writeMachineIdentity(dataDir, next);
  if (activeDataDir === path.resolve(dataDir)) activeProfile = next;
  return next;
}

/**
 * Scrub remote/credential bindings first; only then remove the installation identity. If the
 * injected scrub fails, keeping machine.json makes the partial operation visible and prevents a
 * clone from silently minting a fresh identity while it still owns the old machine's secrets.
 */
export async function prepareMachineClone(dataDir: string, scrubCloneUnsafeState: () => Promise<void>): Promise<void> {
  await loadMachineProfile(dataDir);
  await scrubCloneUnsafeState();
  await fs.rm(machinePath(dataDir), { force: true });
  if (activeDataDir === path.resolve(dataDir)) {
    activeProfile = null;
    activeDataDir = null;
  }
}
