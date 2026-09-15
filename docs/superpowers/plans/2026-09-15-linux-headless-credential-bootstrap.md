# Linux Headless Credential Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `comgu setup` self-bootstrap a persistent secure credential source on headless Linux so a fresh Debian/Proxmox CLI install needs no manual `COMGU_CREDENTIAL_KEY` export.

**Architecture:** Keep the existing provider order (systemd credential -> explicit environment -> Secret Service), then add a validated profile fallback key as the last Linux provider. `comgu setup` creates that fallback only when no stronger source exists; normal runtime/service use simply reads the same validated profile key. Clone preparation removes it.

**Tech Stack:** TypeScript, Node.js crypto/fs, Vitest, GitHub Actions Linux/Windows/macOS CI.

**Spec:** `docs/superpowers/specs/2026-09-15-linux-headless-credential-bootstrap-design.md`

## Global Constraints

- No subagents.
- Preserve fail-closed behavior and existing provider priority.
- Fallback file is `credentials.linux.key`, Base64 random 32 bytes plus newline, mode `0600`.
- Never print/log/embed key material.
- Existing systemd/env/Secret Service sources must not cause fallback creation.
- Invalid existing fallback files are never silently overwritten.
- No change to WorkspaceScope/enabled roots, caller identity, pairing, terminal ownership, command confinement, or Wayland authority.
- Target release after verification: `v3.3.1`.

---

### Task 1: Profile fallback credential provider

**Files:**
- Modify: `src/main/credentials/linux-provider.ts`
- Test: `test/credential-provider-linux.test.ts`

**Interfaces:**
- Extend `LinuxProviderOptions` with optional `fallbackKeyPath` and test-only UID override seam.
- Export `LINUX_FALLBACK_KEY_FILE = 'credentials.linux.key'`.
- Export `bootstrapLinuxFallbackKey(profileDir)` to create the file exclusively at `0600`.
- Provider status detail for the fallback is `profile-fallback`.

- [ ] Write RED tests for fallback creation, mode, fresh-provider decrypt, provider precedence, invalid mode/content fail-closed behavior, and concurrent bootstrap stability.
- [ ] Run CI on the RED commit and confirm Linux fails because the new interface/behavior is absent.
- [ ] Implement minimal fallback loading/validation/bootstrap logic.
- [ ] Re-run focused/provider tests and typecheck through CI.

### Task 2: Setup bootstrap and clone cleanup

**Files:**
- Modify: `src/cli/credentials.ts`
- Modify: `src/cli/commands/admin.ts`
- Test: `test/cli-admin.test.ts`
- Test: `test/cli-service.test.ts`

**Interfaces:**
- Add an async CLI credential setup helper that probes the current vault, bootstraps only when Linux has no source, then re-probes and requires availability.
- `comgu setup` uses that helper unless a test credential factory is explicitly injected.
- Clone preparation removes `credentials.linux.key`.

- [ ] Write RED tests proving clone cleanup and Linux setup bootstrap behavior without secret leakage.
- [ ] Implement setup helper and clone cleanup.
- [ ] Confirm systemd unit still contains no credential material and service/runtime reads the profile fallback implicitly.

### Task 3: Docs, release metadata, and verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `docs/release-notes/v3.3.1.md`
- Modify version declarations/package locks only after feature verification.

- [ ] Document the two-command headless flow: installer then `comgu setup --name <machine>` / `comgu doctor`.
- [ ] Run full `npm run verify:ci` and `npm run build` on CI/local when available.
- [ ] Open PR, require Linux/Windows/macOS + security checks green, then merge only with the user's standing authorization to finish/release this hotfix.
- [ ] Prepare/publish `v3.3.1` only after code review/CI are green; verify GitHub Release assets and npm `comgu-cli@3.3.1` independently.
