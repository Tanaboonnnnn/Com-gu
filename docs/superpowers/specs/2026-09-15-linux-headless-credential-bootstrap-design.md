# Linux Headless Credential Bootstrap Design

## Goal

Make a fresh headless Linux ComGu CLI install usable with `comgu setup` without requiring the user to understand or manually export `COMGU_CREDENTIAL_KEY`, while preserving fail-closed credential handling and existing higher-priority secure providers.

Target release: v3.3.1.

## Problem

On a headless Debian/Proxmox VM, `comgu setup` currently calls the Linux credential provider only to report status. The provider accepts systemd credentials, `COMGU_CREDENTIAL_KEY`, or Secret Service. A TTY-only host commonly has none of those, so setup prints `Secure credential source: unavailable` and leaves the user to manually create/export a key. That environment variable also disappears with the shell, so it is unsuitable as the default persistent setup experience.

The existing systemd user service does not provision a credential source; it only starts `comgu start --profile <dir>`. Therefore a manually exported interactive key is not automatically available after reboot or service restart.

## Chosen design

Use an app-managed, user-private Linux fallback key only when no stronger existing credential source is available.

Provider priority remains:

1. systemd credential supplied through `CREDENTIALS_DIRECTORY`;
2. explicit `COMGU_CREDENTIAL_KEY` environment injection;
3. Secret Service when a usable D-Bus session and `secret-tool` are available;
4. ComGu user-private fallback key in the profile directory.

The fallback is intended for headless user-level Core operation where no OS secret service is available. It protects the credential vault against other local users through Unix ownership and mode enforcement; it does not claim to protect against compromise of the same Unix account.

## Fallback key format and location

- File name: `credentials.linux.key` under the selected ComGu profile directory.
- Contents: exactly one Base64-encoded random 32-byte key plus a trailing newline.
- Creation uses Node `randomBytes(32)`; no shelling out to OpenSSL.
- Creation is exclusive (`wx`) so concurrent setup calls cannot replace one another's key.
- File mode must be `0600`.
- Parent profile directory already belongs to the current user; setup must not use sudo or create a root-owned key.
- The key value must never be emitted in CLI output, logs, errors, service unit text, process arguments, or connector metadata.

## Validation and fail-closed behavior

Before the provider accepts the fallback key it must verify:

- regular file, not directory;
- on Linux, owner UID equals `process.getuid()` when available;
- no group or other permission bits are present (`mode & 0o077 === 0`);
- Base64 decodes to exactly 32 bytes.

If the fallback file exists but any check fails, the provider returns an unavailable/error state and must not silently regenerate or overwrite the file. Setup prints a concise repair-oriented error without exposing secret material. This prevents a permissions regression from being hidden by automatic recovery.

If no fallback file exists and no stronger provider is available, `comgu setup` creates it atomically and re-checks provider status. Existing systemd/env/Secret Service installations do not get a fallback file merely by running setup.

## Setup behavior

`comgu setup` on Linux becomes self-bootstrapping:

1. load/create machine profile and apply existing `--name`, `--root`, and optional Desktop behavior;
2. probe the credential vault/provider;
3. if a source is already available, keep it unchanged;
4. if unavailable specifically because no source exists, atomically create the private fallback key;
5. re-probe and require availability before reporting success;
6. print only the source class/status, never secret data.

Expected headless result:

```text
Machine: tian-proxy
Connector: ComGu Core
Secure credential source: available
```

`comgu doctor` must report `Secure credentials: available` in a fresh shell after setup, without any manual environment variable.

## Service behavior

No secret is embedded in `comgu.service`. The Linux runtime/provider reads the validated profile fallback key directly when no higher-priority source exists. Therefore the existing user service can restart/reboot without depending on an interactive shell export.

The service unit remains user-level and no sudo/UAC-equivalent requirement is introduced.

## Existing vault compatibility

- Existing vaults protected with systemd/env wrapping continue to use that source when it is present.
- Existing Secret Service vaults continue to use Secret Service.
- Setup does not migrate/re-encrypt a working vault just because a fallback mechanism now exists.
- A fallback-key vault requires the same validated fallback key on subsequent reads; missing/wrong/corrupt key fails closed.
- Clone preparation must delete the fallback key alongside the existing credential/vault state so a clone receives a new machine identity and new credential source.

## Security boundaries preserved

This change does not alter WorkspaceScope/enabled-root authority, caller identity, terminal ownership, pairing, MCP surface boundaries, Desktop/Wayland authority, or command confinement.

The fallback key is a Linux credential-at-rest mechanism only. No credential endpoint or model-visible tool is added.

## Tests

TDD coverage must prove:

1. headless Linux with no source starts unavailable;
2. setup creates a 32-byte fallback source and then reports available;
3. created file is `0600` and contains no secret in returned text/JSON/log-facing values;
4. a fresh provider/process environment can reopen the same protected vault with no `COMGU_CREDENTIAL_KEY`;
5. systemd credential, explicit env, and Secret Service remain higher priority and do not create fallback files;
6. group/world-readable, wrong-owner (where testable), malformed, or wrong-length fallback files fail closed and are not overwritten;
7. concurrent bootstrap cannot replace an already-created key;
8. clone preparation removes `credentials.linux.key`;
9. Linux service rendering contains no secret/key material;
10. existing Windows credential behavior remains unchanged.

## Documentation and release

Update CLI/README setup guidance so normal headless Linux installation is simply:

```bash
curl -fsSL https://github.com/Tanaboonnnnn/Com-gu/releases/latest/download/install.sh | sh
comgu setup --name <machine-name>
comgu doctor
```

Document that Secret Service/systemd/env sources still take precedence and that the fallback is user-private (`0600`), not hardware-backed or same-user-compromise-resistant.

Prepare v3.3.1 release metadata only after implementation, full verification, cross-platform CI, and review pass.