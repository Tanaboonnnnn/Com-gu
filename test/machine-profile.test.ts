import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadMachineProfile,
  prepareMachineClone,
  renameMachine,
  type MachineIdentity
} from '../src/main/machine/profile.js';
import { connectorMetadata } from '../src/main/machine/metadata.js';
import { makeTempDir, removeTempDir } from './helpers.js';

const dirs: string[] = [];

async function temp(): Promise<string> {
  const dir = await makeTempDir('clf-machine-');
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => removeTempDir(dir)));
});

const FIXED_UUID = '0a51e3f2-8429-4cba-9b5b-01f0f8f6e4f1';

describe('MachineProfile', () => {
  it('creates one stable unconfirmed identity from a safe hostname suggestion', async () => {
    const dir = await temp();
    const first = await loadMachineProfile(dir, {
      suggestedName: 'Tian Server 01',
      uuid: () => FIXED_UUID,
      now: () => new Date('2026-09-10T10:00:00.000Z')
    });
    const second = await loadMachineProfile(dir, {
      suggestedName: 'different-host',
      uuid: () => 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    });

    expect(first).toEqual({
      id: FIXED_UUID,
      name: 'tian-server-01',
      createdAt: '2026-09-10T10:00:00.000Z',
      confirmed: false
    });
    expect(second).toEqual(first);
  });

  it('rejects invalid explicit names and renames without rotating the UUID', async () => {
    const dir = await temp();
    const original = await loadMachineProfile(dir, { suggestedName: 'host', uuid: () => FIXED_UUID });

    await expect(renameMachine(dir, 'Bad Name')).rejects.toThrow(/lowercase/i);
    const renamed = await renameMachine(dir, 'home-server');

    expect(renamed.id).toBe(original.id);
    expect(renamed.createdAt).toBe(original.createdAt);
    expect(renamed.name).toBe('home-server');
    expect(renamed.confirmed).toBe(true);
  });

  it('refuses malformed persisted identity instead of silently generating a replacement', async () => {
    const dir = await temp();
    await fs.writeFile(path.join(dir, 'machine.json'), '{"id":"not-a-uuid"}', 'utf8');

    await expect(loadMachineProfile(dir, { uuid: () => FIXED_UUID })).rejects.toThrow(/machine identity/i);
    expect(await fs.readFile(path.join(dir, 'machine.json'), 'utf8')).toContain('not-a-uuid');
  });

  it('keeps legacy connector identities until the machine alias is explicitly confirmed', async () => {
    const machine: MachineIdentity = {
      id: FIXED_UUID,
      name: 'gaming-pc',
      createdAt: '2026-09-10T10:00:00.000Z',
      confirmed: false
    };

    expect(connectorMetadata(machine, 'core')).toMatchObject({
      serverName: 'chat-on-steroids-core',
      connectorName: 'ComGu Core'
    });
    expect(connectorMetadata(machine, 'desktop')).toMatchObject({
      serverName: 'chat-on-steroids-desktop',
      connectorName: 'ComGu Desktop'
    });
  });

  it('uses the machine alias for display metadata while keeping server identity stable across rename', async () => {
    const dir = await temp();
    await loadMachineProfile(dir, { suggestedName: 'host', uuid: () => FIXED_UUID });
    const first = await renameMachine(dir, 'gaming-pc');
    const before = connectorMetadata(first, 'core');
    const second = await renameMachine(dir, 'main-pc');
    const after = connectorMetadata(second, 'core');

    expect(before.connectorName).toBe('ComGu · gaming-pc Core');
    expect(after.connectorName).toBe('ComGu · main-pc Core');
    expect(before.serverName).toBe(after.serverName);
    expect(before.serverName).toMatch(/^comgu-core-[0-9a-f]{12}$/);
    expect(after.description).toContain('"main-pc"');
    expect(after.description).toContain('Do not use it for another machine');
  });

  it('prepares a clone only after clone-unsafe state is scrubbed and leaves unrelated files alone', async () => {
    const dir = await temp();
    await loadMachineProfile(dir, { suggestedName: 'template', uuid: () => FIXED_UUID });
    await fs.writeFile(path.join(dir, 'config.json'), '{"roots":["keep-me"]}', 'utf8');
    const calls: string[] = [];

    await prepareMachineClone(dir, async () => {
      calls.push('scrubbed');
    });

    expect(calls).toEqual(['scrubbed']);
    await expect(fs.stat(path.join(dir, 'machine.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(dir, 'config.json'), 'utf8')).toContain('keep-me');
  });

  it('keeps machine identity when clone-state scrubbing fails', async () => {
    const dir = await temp();
    await loadMachineProfile(dir, { suggestedName: 'template', uuid: () => FIXED_UUID });

    await expect(
      prepareMachineClone(dir, async () => {
        throw new Error('credential scrub failed');
      })
    ).rejects.toThrow('credential scrub failed');

    expect(JSON.parse(await fs.readFile(path.join(dir, 'machine.json'), 'utf8')).id).toBe(FIXED_UUID);
  });
});
