# Contributing

ComGu is a Windows/macOS/Linux beta maintained by one person. Bug reports, focused fixes and concrete improvements are welcome.

## Before a pull request

For anything non-trivial, open an issue first so the intended behavior is clear. Security problems must be reported privately through [`SECURITY.md`](SECURITY.md), not as an issue or PR.

Keep changes narrow. Preserve existing permission, identity and recovery behavior unless the issue specifically requires changing it. Avoid unrelated formatting, generated output, local debugging material and private data. In screenshots, logs and examples, replace real usernames, local paths, chat text, IDs and credentials with obvious placeholders such as `C:\Users\you\project` or `/home/you/project`.

## Development setup

Development requires Node 22+ and is supported on Windows, macOS and Linux. Desktop/computer-use is available on Windows and supported Linux graphical sessions; macOS is Core-only. Core, extension, sessions, agents and tunnel behavior must stay portable.

```sh
npm ci
npm run verify     # the same gate CI runs
npm run dev        # Electron development build
```

A behavior change should include a deterministic regression test where practical. Run the nearest focused tests while working and `npm run verify` before submitting.

## Packaging

Release packages are platform/architecture-specific:

```sh
npm run dist:x64
npm run dist:arm64
npm run dist:mac:arm64
npm run dist:linux:x64
npm run dist:linux:arm64
```

Release CI builds and smoke-tests Windows and Linux x64/arm64 and macOS arm64 on native runners. A tag alone does not publish a release; follow the tagged publish workflow. Packaging downloads/stages pinned external assets and verifies their checksums, so the first packaging run needs network access. Do not claim a cross-OS package is validated merely because electron-builder can sometimes emit it from another host.

## Pull requests

Explain the root cause, the smallest behavior change that fixes it, and exactly how you validated it. Packaging/runtime changes should include a packaged-runtime smoke check where relevant.

Contributions are accepted under the MIT licence in [`LICENSE`](LICENSE).
