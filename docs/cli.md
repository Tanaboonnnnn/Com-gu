# ComGu CLI runtime

## Installation

Node.js 22+ is required. The recommended public npm channel is:

```sh
npm install -g comgu-cli
```

Linux can install directly from the latest GitHub Release:

```sh
curl -fsSL https://github.com/Tanaboonnnnn/Com-gu/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/Tanaboonnnnn/Com-gu/releases/latest/download/install.ps1 | iex
```

The npm package is a thin bootstrapper. It does not carry a second runtime: every install channel downloads the matching `ComGu-CLI-*` release artifact and validates it against the same release's `SHA256SUMS.txt` before activation. One-line installs are user-scoped by default and do not require root/UAC.

`comgu update` preserves the installation channel. npm installs update through npm; shell/PowerShell installs resolve the latest stable GitHub Release and atomically switch to the verified version. `comgu uninstall` removes only installer-owned program files for one-line installs and preserves profiles, credentials, approved roots, logs, and machine identity. npm installations are removed with `npm uninstall -g comgu-cli`.

The standalone CLI owns the same Core connection lifecycle as the Desktop app without importing
Electron or browser-only Goal/session/agent machinery into its baseline status/admin path.

## Runtime profile

`RuntimeProfile('cli')` is the policy authority. Core connection/config/machine identity are
available; browser, session, Goal and agent Runtime Features are not. Platform Desktop capability
adapters are loaded only when the configured permission and host require them.

The local control socket/pipe remains the administrative interface for `status`, `connect`,
`disconnect`, `reload` and `shutdown`. `comgu status --json` talks to the already-running owner; it
does not start a second runtime.

## Durable Run status

The CLI owner lazily loads the Node-only Durable Run module the first time status needs it. Status
returns bounded control metadata only: run id, objective, state, checkpoint/reason, timestamps,
operation receipt metadata and the current recovery action. It does not return transcript or tool
payloads.

The CLI can report `waiting`, `suspended` or `needs-reconciliation`, but it does not drive browser
continuations. `needs-reconciliation` means an earlier mutation may already have happened; do not
repeat it merely because the previous transport acknowledgement was lost.

## Verification

`npm run cli:build` builds the standalone package. `node scripts/smoke-cli.mjs --dir <package-dir>`
checks owner startup/status/shutdown and rejects emitted CLI bundles that contain Electron/browser
startup machinery. Runtime import audits additionally keep Goal/agents out of the eager Desktop
graph when those features are disabled.
