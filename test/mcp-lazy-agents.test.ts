import { afterEach, beforeEach, expect, it } from 'vitest';
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { startMcpServer, type McpEndpoint } from '../src/main/mcp/server.js';
import {
  optionalAgentsRuntimeInstalled,
  resetOptionalMcpRuntime
} from '../src/main/mcp/optional-runtime.js';
import {
  desktopFeatureFactories,
  loadedDesktopAgentsModule,
  resetDesktopFeaturesForTests
} from '../src/main/runtime/desktop-features.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let dir = '';
let endpoint: McpEndpoint | null = null;

beforeEach(async () => {
  dir = await makeTempDir('comgu-lazy-agents-');
  initConfigPath(dir);
  const config = defaultConfig();
  await saveConfig({ ...config, multiAgent: { ...config.multiAgent, enabled: false } });
  resetOptionalMcpRuntime();
  resetDesktopFeaturesForTests();
});

afterEach(async () => {
  await endpoint?.stop().catch(() => undefined);
  endpoint = null;
  resetDesktopFeaturesForTests();
  resetOptionalMcpRuntime();
  await removeTempDir(dir);
});

it('keeps agents MCP runtime unloaded until the Agents RuntimeFeature starts', async () => {
  const config = defaultConfig();
  endpoint = await startMcpServer(
    () => ({
      roots: [],
      caps: { ...config.capabilities },
      readOnly: true,
      sessionTools: false,
      agentTools: false
    }),
    null,
    'desktop-app'
  );

  expect(optionalAgentsRuntimeInstalled()).toBe(false);
  expect(loadedDesktopAgentsModule()).toBeNull();

  const factory = desktopFeatureFactories().agents;
  expect(factory).toBeDefined();
  const first = await factory!();
  await first.start();
  expect(optionalAgentsRuntimeInstalled()).toBe(true);
  const loaded = loadedDesktopAgentsModule();
  expect(loaded).not.toBeNull();

  await first.stop();
  expect(optionalAgentsRuntimeInstalled()).toBe(false);
  expect(loadedDesktopAgentsModule()).toBeNull();

  const second = await factory!();
  await second.start();
  expect(optionalAgentsRuntimeInstalled()).toBe(true);
  expect(loadedDesktopAgentsModule()).toBe(loaded);
  await second.stop();
});
