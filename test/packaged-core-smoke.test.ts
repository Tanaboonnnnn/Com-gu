import { describe, expect, it } from 'vitest';
// @ts-ignore packaged smoke scripts are intentionally plain ESM JavaScript.
import { coreSmokeConfig, expectedCoreTools } from '../scripts/smoke-packaged-core.mjs';

describe('packaged Core smoke configuration', () => {
  it('uses find when commands are off and the command pair when commands are on', () => {
    expect(expectedCoreTools(false)).toEqual(['read', 'view_image', 'find']);
    expect(expectedCoreTools(true)).toEqual([
      'read',
      'view_image',
      'apply_patch',
      'exec_command',
      'write_stdin',
      'session'
    ]);
  });

  it('never enables Desktop or agent authority in the packaged Core smoke', () => {
    const config = coreSmokeConfig('C:/fixture', true);
    expect(config.roots).toEqual([{ name: 'fixture', path: 'C:/fixture' }]);
    expect(config.capabilities.command).toBe(true);
    expect(config.capabilities.screen).toBe(false);
    expect(config.capabilities.control).toBe(false);
    expect(config.multiAgent.enabled).toBe(false);
    expect(config.sessions.record).toBe(true);
    expect(config.tunnel.kind).toBe('manual');
  });
});
