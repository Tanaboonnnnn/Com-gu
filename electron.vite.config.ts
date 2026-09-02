import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // Keep node_modules external so the MCP SDK ships as real files in the asar
    // rather than being inlined by the bundler.
    // MXC 0.8 is ESM-only (`exports.import` with no CommonJS export). The main build is CJS, so
    // externalizing MXC would emit `require('@microsoft/mxc-sdk')` and make the packaged app fail
    // before startup. Bundle this one dependency; keep the rest external as before.
    plugins: [externalizeDepsPlugin({ exclude: ['@microsoft/mxc-sdk'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'command-sandbox-probe': resolve(__dirname, 'src/main/command-sandbox-probe.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
});
