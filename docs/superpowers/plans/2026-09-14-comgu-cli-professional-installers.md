# ComGu CLI Professional Installers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship professional, secure, one-command ComGu CLI installation through npm, POSIX shell, and PowerShell while ensuring every channel installs the same CI-smoked GitHub Release CLI artifact.

**Architecture:** Add a thin `comgu-cli` npm bootstrapper and platform-native install scripts that resolve a release version, map OS/architecture to the existing four CLI artifacts, verify the downloaded archive against the release `SHA256SUMS.txt`, and atomically switch a user-level install directory. Keep the existing CLI runtime/package unchanged and make GitHub Release remain the binary source of truth; npm is published only after the matching GitHub Release exists.

**Tech Stack:** Node.js 22+, npm package lifecycle, POSIX `sh`, PowerShell 5+/7+, GitHub Releases, GitHub Actions, Vitest, existing ComGu CLI packaging/release scripts.

---

## File structure

- `packages/comgu-cli/package.json` — public npm metadata, `comgu` bin mapping, version synchronized with ComGu release.
- `packages/comgu-cli/bin/comgu-bootstrap.mjs` — thin Node launcher that installs/updates the verified release artifact then delegates to the installed CLI.
- `packages/comgu-cli/lib/install.mjs` — reusable installer core: target mapping, release URL construction, checksum parsing, download, extraction, atomic activation, rollback, and launcher resolution.
- `packages/comgu-cli/lib/platform.mjs` — normalize `process.platform`/`process.arch` to the four supported release targets.
- `install.sh` — POSIX one-line installer for Linux x64/arm64, defaulting to a user-owned prefix.
- `install.ps1` — PowerShell one-line installer for Windows x64/arm64, defaulting to a user-owned prefix and user PATH.
- `scripts/verify-cli-installers.mjs` — deterministic contract checks for npm metadata, scripts, release URLs, checksum behavior, and docs wiring.
- `test/cli-installer.test.ts` — Node installer unit/integration tests with local fixtures and HTTP server; no public network.
- `test/cli-install-scripts.test.ts` — shell/PowerShell static and host-available smoke tests.
- `.github/workflows/release.yml` — smoke installer artifacts against the assembled candidate where practical.
- `.github/workflows/publish.yml` — publish npm package only after GitHub Release succeeds and version/tag matches.
- `README.md`, `docs/cli.md`, `docs/release-notes/v3.2.0.md` — professional install/update/uninstall documentation.

### Task 1: Define target/version/checksum installer core

**Files:**
- Create: `packages/comgu-cli/lib/platform.mjs`
- Create: `packages/comgu-cli/lib/install.mjs`
- Test: `test/cli-installer.test.ts`

- [ ] **Step 1: Write RED tests** for target mapping (`win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`), unsupported platforms, release asset names, strict SHA256 parsing, and mismatch refusal.
- [ ] **Step 2: Run** `npx vitest run test/cli-installer.test.ts` and confirm failures are due to missing installer modules.
- [ ] **Step 3: Implement minimal pure functions** `resolveCliTarget()`, `assetNameForTarget()`, `parseSha256Sums()`, and `verifySha256()`.
- [ ] **Step 4: Add deterministic local HTTP fixture tests** proving downloads never trust content before checksum verification.
- [ ] **Step 5: Run** `npx vitest run test/cli-installer.test.ts` and confirm green.
- [ ] **Step 6: Commit** `feat(cli): add verified installer core`.

### Task 2: Atomic user-level installation and rollback

**Files:**
- Modify: `packages/comgu-cli/lib/install.mjs`
- Test: `test/cli-installer.test.ts`

- [ ] **Step 1: Write RED tests** for install to `versions/<version>`, activation via `current`, preserving prior current version until the new artifact is fully extracted/verified, failed update rollback, and profile/data directories remaining untouched.
- [ ] **Step 2: Run the focused tests** and record the expected failures.
- [ ] **Step 3: Implement atomic install** using temporary sibling directories, validated extraction, versioned directories, and final activation only after success.
- [ ] **Step 4: Implement uninstall of program files only**, never profile/credentials/data.
- [ ] **Step 5: Re-run focused tests** and confirm green.
- [ ] **Step 6: Commit** `feat(cli): make installs atomic and rollback safe`.

### Task 3: npm thin bootstrapper package

**Files:**
- Create: `packages/comgu-cli/package.json`
- Create: `packages/comgu-cli/bin/comgu-bootstrap.mjs`
- Modify: `package.json`
- Test: `test/cli-installer.test.ts`
- Test: `test/packaging-cli.test.ts`

- [ ] **Step 1: Write RED tests** asserting package name `comgu-cli`, version alignment with root package, `bin.comgu`, Node `>=22`, no Electron/runtime dependencies, and bootstrap delegation behavior.
- [ ] **Step 2: Implement npm package metadata** and bootstrapper commands: first-run install, `--version`, normal delegation, `update`, and `uninstall` forwarding/management.
- [ ] **Step 3: Ensure package tarball is tiny** and contains only bootstrapper/install logic, not Electron or full CLI runtime.
- [ ] **Step 4: Run** `npm pack --dry-run --workspace packages/comgu-cli` (or equivalent package-dir command) and installer tests.
- [ ] **Step 5: Commit** `feat(cli): add npm bootstrapper package`.

### Task 4: Linux one-line installer

**Files:**
- Create: `install.sh`
- Test: `test/cli-install-scripts.test.ts`

- [ ] **Step 1: Write RED/static contract tests** for `set -eu`, supported architecture detection, HTTPS GitHub URLs, checksum verification, temp directory cleanup trap, user-level default prefix, no default sudo, version override support, and PATH guidance.
- [ ] **Step 2: Implement `install.sh`** using release artifacts and `SHA256SUMS.txt`; require Node 22+ before activation.
- [ ] **Step 3: Add local-fixture smoke mode** so CI can test download/checksum/extract without public network.
- [ ] **Step 4: Run shell tests** on host-available environment and CI-compatible static checks.
- [ ] **Step 5: Commit** `feat(cli): add verified shell installer`.

### Task 5: Windows PowerShell one-line installer

**Files:**
- Create: `install.ps1`
- Test: `test/cli-install-scripts.test.ts`

- [ ] **Step 1: Write RED/static contract tests** for x64/arm64 mapping, TLS/HTTPS URLs, SHA256 verification, temporary extraction, user-level install prefix, user PATH update, version override, and failure cleanup.
- [ ] **Step 2: Implement `install.ps1`** without requiring elevation by default.
- [ ] **Step 3: Add deterministic local-fixture smoke** on Windows to verify install, launch, update/rollback path, and uninstall preserving profile data.
- [ ] **Step 4: Run focused tests** and confirm green.
- [ ] **Step 5: Commit** `feat(cli): add verified PowerShell installer`.

### Task 6: Release and npm publication wiring

**Files:**
- Create/Modify: `scripts/verify-cli-installers.mjs`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/publish.yml`
- Test: `test/packaging.test.ts`
- Test: `test/packaging-cli.test.ts`

- [ ] **Step 1: Write RED packaging tests** requiring installer scripts, npm package version alignment, npm package verification, and publish ordering after GitHub Release creation.
- [ ] **Step 2: Add `verify-cli-installers.mjs`** and wire it into release verification.
- [ ] **Step 3: Extend release candidate jobs** to smoke install channels against candidate artifacts without public-network dependence.
- [ ] **Step 4: Extend publish workflow** so it creates/verifies GitHub Release first, then runs `npm publish` for `packages/comgu-cli` with provenance when registry credentials/permissions permit; never publish npm first.
- [ ] **Step 5: Add explicit failure semantics** so an npm publish failure leaves the GitHub Release intact and visible while reporting npm channel failure, avoiding partial binary replacement.
- [ ] **Step 6: Run packaging tests** and workflow contract tests.
- [ ] **Step 7: Commit** `ci(release): publish verified CLI install channels`.

### Task 7: Documentation and UX polish

**Files:**
- Modify: `README.md`
- Modify: `docs/cli.md`
- Modify: `docs/release-notes/v3.2.0.md`

- [ ] **Step 1: Update README** to lead with three install paths: `npm install -g comgu-cli`, Linux `curl -fsSL .../install.sh | sh`, and Windows `irm .../install.ps1 | iex`.
- [ ] **Step 2: Document pinned/versioned installs**, update, uninstall, Node 22+, install locations, PATH behavior, checksum security, and troubleshooting.
- [ ] **Step 3: State clearly** that npm/curl/PowerShell all install the same GitHub Release CLI bytes and do not change profile ownership/security semantics.
- [ ] **Step 4: Update v3.2.0 release notes** with installer channels without removing unsigned/unnotarized disclosures or required artifact inventory.
- [ ] **Step 5: Run doc/packaging tests**.
- [ ] **Step 6: Commit** `docs(cli): document professional installation flows`.

### Task 8: Full verification, PR, merge, and release

**Files:** all changed files.

- [ ] **Step 1: Run** `npm run verify:ci` and require exit 0.
- [ ] **Step 2: Run** `npm run build`, `git diff --check`, and production audit.
- [ ] **Step 3: Build and smoke host-native Desktop + CLI + npm bootstrapper + PowerShell installer** from the final tree.
- [ ] **Step 4: Push branch and open a PR** against `main`; wait for Security/Windows/Linux/macOS CI green.
- [ ] **Step 5: Merge only after final reviewed head is green** and update local evidence to the merge commit.
- [ ] **Step 6: Run the Release Candidate workflow** from merged `main`; all package/CLI/installer assembly jobs must succeed.
- [ ] **Step 7: Complete the documented real-host Linux X11/Wayland RC before public release promotion if the environment provides suitable hosts; otherwise report this as the only remaining release blocker and do not falsely claim the graphical RC was run.**
- [ ] **Step 8: Create/push tag `v3.2.0` only after release gates are satisfied**, allowing `publish.yml` to rebuild from the tag and publish the GitHub Release.
- [ ] **Step 9: Verify every GitHub asset URL, SHA256SUMS, README direct link, one-line installer, and npm registry package/version after publication.**
- [ ] **Step 10: Report exact release URL, npm install command, one-line installer commands, checksums/provenance status, and any unvalidated graphical Linux scope.**

## Self-review

- Spec coverage: npm bootstrapper, shell/PowerShell one-liners, single binary authority, checksum, atomic update/rollback, PATH, update/uninstall, Node requirement, deterministic tests, release ordering, and docs are each mapped to tasks.
- No placeholders: all tasks name concrete files, tests, commands, and acceptance behavior.
- Type/interface consistency: installer target keys remain the existing `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`; asset names remain the release contract already used by `scripts/cli-package.mjs`.
