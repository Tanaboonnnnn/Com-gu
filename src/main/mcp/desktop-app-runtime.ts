import * as continuation from '../session/continuation.js';
import * as recorder from '../session/recorder.js';
import * as sessionStore from '../session/store.js';
import { registerSessionTool } from './session-tool.js';
import { installOptionalMcpBaseRuntime } from './optional-runtime.js';

/** Installs browser/session/agent integrations only for the Electron/Desktop runtime profile. */
export function installDesktopAppMcpRuntime(): void {
  installOptionalMcpBaseRuntime({
    recorder,
    sessionStore,
    continuation,
    registerSessionTool
  });
}
