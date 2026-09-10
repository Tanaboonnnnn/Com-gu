export type RuntimeProfileName = 'desktop-app' | 'cli';

export interface RuntimeProfile {
  name: RuntimeProfileName;
  browser: boolean;
  sessions: boolean;
  goal: boolean;
  agents: boolean;
  desktop: boolean;
  electronFrontend: boolean;
}

const DESKTOP_APP_PROFILE: RuntimeProfile = {
  name: 'desktop-app',
  browser: true,
  sessions: true,
  goal: true,
  agents: true,
  desktop: true,
  electronFrontend: true
};

const CLI_PROFILE: RuntimeProfile = {
  name: 'cli',
  browser: false,
  sessions: false,
  goal: false,
  agents: false,
  desktop: true,
  electronFrontend: false
};

/**
 * Runtime policy is an explicit product choice, not a projection of persisted settings.
 * In particular, an old Desktop config cannot accidentally make the lightweight CLI load
 * browser/session/Goal/agent machinery just because those features were enabled there.
 */
export function runtimeProfile(name: RuntimeProfileName): RuntimeProfile {
  return name === 'desktop-app' ? { ...DESKTOP_APP_PROFILE } : { ...CLI_PROFILE };
}
