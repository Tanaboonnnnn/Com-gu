import { describe, expect, it } from 'vitest';
import { runtimeProfile } from '../src/main/runtime/profile.js';

describe('runtime profiles', () => {
  it('keeps the desktop app feature-capable and explicitly Electron-backed', () => {
    expect(runtimeProfile('desktop-app')).toEqual({
      name: 'desktop-app',
      browser: true,
      sessions: true,
      goal: true,
      agents: true,
      desktop: true,
      electronFrontend: true
    });
  });

  it('hard-disables browser/session/Goal/agents for CLI regardless of persisted settings', () => {
    expect(runtimeProfile('cli')).toEqual({
      name: 'cli',
      browser: false,
      sessions: false,
      goal: false,
      agents: false,
      desktop: true,
      electronFrontend: false
    });
  });
});
