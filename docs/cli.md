# ComGu CLI runtime

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
