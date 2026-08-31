# ComGu Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the current ComGu work to `Tanaboonnnnn/Com-gu`, make the repository landing page clearly ours, and ship a clean `v2.0.2` GitHub Release with the artifacts that were actually built.

**Architecture:** Treat publishing as a provenance-sensitive release operation. Rewrite current-facing documentation without changing runtime behavior, exclude transient build scratch, verify source and artifacts, then publish the exact verified state to `origin/main` and attach only artifacts that exist and were produced successfully.

**Tech Stack:** Git, GitHub, Markdown, Node.js/Electron build outputs, GitHub CLI/API.

**Spec:** User-approved release scope in the current conversation.

## Global Constraints

- Repository: `Tanaboonnnnn/Com-gu` via `origin` only; never push to `upstream`.
- Publish the current ComGu rebrand, Thai localization, and safe-boundary auto-compaction fix together.
- README must present ComGu as this project's current identity and use original wording.
- Do not commit `.tmp-linux-src/`, generated `release/` contents, `out/`, or other build scratch.
- Release tag: `v2.0.2` from `main`.
- Publish through the repository's native six-target GitHub Actions release workflow so macOS and Linux ARM64 are built on matching hosts rather than cross-built on Windows.
- Attach only artifacts that the native release workflow successfully builds and verifies, plus the standalone extension and SHA256 sums.

---

### Task 1: Repository landing page

**Files:**
- Modify: `README.md`
- Modify: `docs/release-notes/v2.0.2.md`

**Interfaces:**
- Consumes: current ComGu product behavior and verified artifact names.
- Produces: current-facing repository documentation and release copy.

- [x] Rewrite README around ComGu identity, setup, platforms, extension, security, build-from-source, and current release availability.
- [x] Rewrite v2.0.2 release notes to describe the actual ComGu release and known limitations.
- [x] Search current-facing docs for stale upstream branding that would confuse repository visitors.

### Task 2: Release hygiene and verification

**Files:**
- Remove from workspace only: `.tmp-linux-src/`
- Local `release/` artifacts are verification aids only; the published checksums and assets must come from the tagged native CI candidate.

**Interfaces:**
- Consumes: built artifacts in `release/`.
- Produces: a clean source commit candidate and verified artifact checksums.

- [x] Remove only the temporary Linux source copy created for container packaging.
- [x] Run typecheck, targeted tests, and production build.
- [x] Verify the locally built Windows x64/ARM64 and Linux x64 artifacts exist and compute local SHA-256 checksums as a sanity check.
- [x] Confirm no generated release binaries or build outputs are staged for source control.

### Task 3: Publish source

**Files:**
- Git metadata only.

**Interfaces:**
- Consumes: verified working tree.
- Produces: `thai-localization-v1` and `main` on `origin` pointing to the verified ComGu release commit.

- [ ] Commit the complete intended source/docs/assets change set.
- [ ] Push `thai-localization-v1` to `origin`.
- [ ] Fast-forward or merge the release commit into local `main` without touching upstream.
- [ ] Push `main` to `origin` and verify remote refs.

### Task 4: Publish GitHub Release

**Files:**
- Native GitHub Actions candidate produced from tag `v2.0.2`.

**Interfaces:**
- Consumes: verified `origin/main` commit, release notes, and checksums.
- Produces: GitHub Release `v2.0.2` with downloadable artifacts.

- [ ] Create annotated or lightweight tag `v2.0.2` at the published main commit and push it to origin.
- [ ] Dispatch `publish.yml` at `v2.0.2`; let it build and smoke-test all six native OS/CPU targets, assemble checksums/extension ZIP, and create `ComGu v2.0.2`.
- [ ] Monitor the workflow to completion; do not manually substitute unverified local artifacts for a failed native target.
- [ ] Fetch the release back from GitHub and verify tag, title, body, and asset list.
