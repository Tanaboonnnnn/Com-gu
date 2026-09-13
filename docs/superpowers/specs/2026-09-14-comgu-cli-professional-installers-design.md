# ComGu CLI Professional Installers Design

## Goal

Make ComGu CLI easy to install through two first-class channels without creating a second CLI implementation:

```text
npm install -g comgu-cli
curl -fsSL https://github.com/Tanaboonnnnn/Com-gu/releases/latest/download/install.sh | sh
irm https://github.com/Tanaboonnnnn/Com-gu/releases/latest/download/install.ps1 | iex
```

All installation paths must install the same platform CLI artifact produced and smoke-tested by the GitHub release pipeline. GitHub Release remains the executable-byte authority.

## Supported targets

- Windows x64
- Windows ARM64
- Linux x64
- Linux ARM64

Node.js 22+ remains required. This project does not add macOS CLI support.

## Distribution model

Authoritative release artifacts remain:

```text
ComGu-CLI-windows-x64.zip
ComGu-CLI-windows-arm64.zip
ComGu-CLI-linux-x64.tar.gz
ComGu-CLI-linux-arm64.tar.gz
SHA256SUMS.txt
```

The npm package and one-line installers are bootstrap layers only. They select, download, verify, extract, and activate these artifacts. They do not compile ComGu locally and do not bundle Electron, browser/session/Goal/agent code, or a second CLI runtime.

## npm channel

Publish a dedicated public package named `comgu-cli` with `bin.comgu` and `engines.node >= 22`.

The package lives under a dedicated publishable directory such as:

```text
packages/comgu-cli-bootstrap/
  package.json
  bin/comgu-bootstrap.mjs
  lib/install.mjs
```

Install behavior:

1. Read the npm package version.
2. Detect OS and architecture.
3. Map version `X.Y.Z` to GitHub tag `vX.Y.Z`.
4. Download `SHA256SUMS.txt` from that exact tag.
5. Download the matching CLI artifact from that exact tag.
6. Verify SHA-256 before extraction.
7. Extract into package-owned versioned storage.
8. Expose `comgu` as a stable shim that delegates to the extracted release CLI.
9. If any step fails, keep the previous known-good payload untouched and exit non-zero.

The npm package version and GitHub release version must match exactly. npm `latest` must never point to a version whose authoritative GitHub Release is missing or incomplete.

## Linux one-line installer

`install.sh` supports Linux x64 and ARM64.

Default user-owned locations:

```text
payload: ~/.local/share/comgu-cli/<version>/
launcher: ~/.local/bin/comgu
state:   ~/.local/share/comgu-cli/install.json
```

Behavior:

- detect `uname -s` and `uname -m`;
- reject unsupported targets;
- resolve latest stable release or an explicitly pinned version;
- pin all subsequent downloads to the resolved exact tag;
- download artifact and checksums to a temporary directory;
- verify SHA-256 before extraction;
- extract to a versioned staging directory;
- atomically activate only after verification succeeds;
- preserve the previous valid version until activation finishes;
- avoid `sudo` by default;
- print an explicit PATH instruction only if `~/.local/bin` is not reachable.

Checksum verification cannot be disabled by a convenience flag.

## Windows PowerShell installer

`install.ps1` supports Windows x64 and ARM64.

Default user-owned locations:

```text
payload: %LOCALAPPDATA%\ComGu\CLI\<version>\
launcher: %LOCALAPPDATA%\ComGu\bin\comgu.cmd
state:   %LOCALAPPDATA%\ComGu\CLI\install.json
```

Behavior:

- detect native Windows architecture;
- reject unsupported targets;
- resolve latest stable release or exact requested version;
- download checksums and ZIP from one exact tag;
- verify SHA-256 with built-in PowerShell/.NET APIs;
- extract to versioned staging;
- atomically activate the new version;
- update current-user PATH only when needed;
- never require machine-wide PATH mutation or UAC for normal installation;
- preserve the prior known-good version if activation fails.

## Stable command contract

All channels must produce the same user-facing command:

```text
comgu --version
comgu setup
comgu start
comgu status
comgu doctor
```

The installer launcher only delegates to the existing packaged CLI launcher. It does not duplicate command parsing.

Installer state records only distribution metadata:

- installed version;
- artifact filename;
- artifact SHA-256;
- install channel (`npm`, `shell`, or `powershell`);
- platform/architecture;
- installation timestamp.

It must not store secrets, machine IDs, approved roots, profile credentials, or workspace paths.

## Update behavior

Add a professional `comgu update` experience.

For bootstrap-managed installs:

- resolve latest stable version;
- clearly no-op when current;
- download and verify before activation;
- preserve the current version until the replacement is active;
- report old and new versions;
- never mutate ComGu profile/runtime data.

For npm-managed installs, update behavior must remain owned by the npm channel. The CLI may delegate to or instruct the matching npm update path, but must not silently convert an npm installation into a shell-managed installation.

Installation channel ownership is recorded so different channels do not overwrite one another unexpectedly.

## Uninstall behavior

Uninstall removes only installer-owned launchers, payloads, state, and PATH entries that still exactly match installer-owned values.

By default it must preserve:

- ComGu profiles;
- credentials;
- approved roots;
- logs;
- machine identity;
- user data.

Any future purge-data operation must be separate and explicit.

## Version and integrity rules

Default one-line installs resolve GitHub's latest non-prerelease stable release once, then pin every subsequent URL to that exact tag.

Exact-version installs accept `3.2.0` or `v3.2.0`, normalize once, and use only that exact tag.

Fail closed on:

- unsupported platform/architecture;
- missing release;
- missing artifact;
- missing checksum entry;
- malformed checksum file;
- SHA-256 mismatch;
- malformed archive;
- failed extraction;
- failed activation.

Downloaded code is never executed before checksum validation and successful extraction.

## Atomic activation and rollback

Install and update use versioned payload directories plus a small stable launcher/current pointer.

The sequence is:

```text
download -> checksum -> extract staging -> smoke basic launcher -> activate -> update state
```

If any stage before activation fails, the current launcher continues pointing to the old version. If activation fails, restore the previous pointer/state before returning an error.

This must be covered by deterministic tests, not timing-based tests.

## npm publication safety

The Electron root package stays private. Only the dedicated bootstrap package is publishable.

Requirements:

- package name `comgu-cli`;
- explicit `files` allowlist;
- no secrets or root project source accidentally included;
- `npm pack --dry-run` audited in CI;
- package version checked against root `package.json` and release tag;
- package publication only after the matching GitHub Release exists and required CLI assets/checksums are confirmed.

Publication order:

```text
reviewed source
-> tag
-> native build + smoke
-> GitHub Release
-> verify release assets/checksums
-> npm publish comgu-cli@same-version
-> npm install smoke
```

This prevents npm from advertising a version before the executable bytes it references exist.

## Release workflow changes

CI/release must add deterministic coverage for:

1. target and architecture mapping;
2. version/tag normalization;
3. release URL construction;
4. checksum parsing and selection;
5. checksum mismatch failure before activation;
6. unsupported target rejection;
7. installation-channel metadata;
8. atomic activation and rollback;
9. PATH mutation idempotency;
10. npm package files/version/bin contract;
11. `npm pack --dry-run` contents;
12. Linux installer smoke on x64 and ARM64;
13. PowerShell installer smoke on x64 and ARM64;
14. npm bootstrap install smoke on all four supported targets;
15. uninstall preserving profile/user data.

Installer integration tests use a local fixture release server rather than the public internet. Public release smoke may run after publication, but deterministic CI must not depend on GitHub network availability.

## Release artifact compatibility

This work must preserve all current CLI invariants:

- Node.js 22+;
- Windows x64/ARM64 and Linux x64/ARM64;
- no Electron dependency in CLI artifacts;
- shared Desktop/CLI profile ownership;
- compatibility-aware profile resolution;
- fail-closed ownership recovery;
- headless operation without a graphical session;
- no profile migration during installation.

## Security invariants

- Installers write only to documented user-owned install locations and exact PATH metadata.
- Runtime/profile authority is unchanged.
- Checksum verification cannot be bypassed.
- No downloaded payload is executed before integrity verification.
- npm lifecycle/bootstrap code must not start ComGu automatically or mutate runtime permissions.
- No root/admin escalation happens automatically.
- Production download URLs are fixed to `Tanaboonnnnn/Com-gu`.
- Test-only release-source overrides must be isolated from the published production path.
- Installer failures must not expose secrets or dump private environment state.

## Documentation UX

README becomes install-first:

```text
npm install -g comgu-cli
curl -fsSL https://github.com/Tanaboonnnnn/Com-gu/releases/latest/download/install.sh | sh
irm https://github.com/Tanaboonnnnn/Com-gu/releases/latest/download/install.ps1 | iex
```

Direct ZIP/TAR.GZ links remain available as advanced/manual fallback.

Documentation covers supported targets, Node.js requirement, install paths, PATH behavior, exact-version installation, update/uninstall, checksum verification, npm/GitHub relationship, and `comgu doctor` troubleshooting.

## Acceptance criteria

The feature is complete when:

1. `npm install -g comgu-cli` installs a working `comgu` command on all four supported targets by consuming the verified GitHub Release artifact for the same version.
2. Linux users can install with one `curl ... | sh` command without root by default.
3. Windows users can install with one `irm ... | iex` command without UAC by default.
4. Every channel verifies SHA-256 before activation.
5. Failed installs/upgrades preserve the last known-good CLI.
6. Update/uninstall is channel-aware and preserves ComGu profile data.
7. README presents command installation first and direct downloads second.
8. CI tests installers deterministically without public-network dependence.
9. GitHub Release remains the executable-byte authority and npm publication occurs only after matching release publication.
10. Existing security, ownership, lightweight CLI, build, and cross-platform release gates remain green.
