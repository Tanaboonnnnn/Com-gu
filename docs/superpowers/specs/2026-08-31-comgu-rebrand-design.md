# ComGu Rebrand Design

## Goal

Rebrand every user-visible surface of Chat On Steroids to **ComGu** and replace shipped application/extension artwork with the user-provided computer mascot, while preserving internal compatibility identifiers that existing installs, stored data, extension pairing, and protocol code depend on.

## Scope

The rebrand covers the desktop window, tray copy, renderer UI, Chrome extension name/title/copy, MCP connector display names, package/product names, installer and release artifact names, macOS/Linux metadata, documentation that describes the current product, and all tests that assert those visible names.

The user-provided mascot is stored in the repository as `artwork/comgu-logo.jpg` and is the canonical artwork source. The existing `scripts/make-icon.mjs` pipeline remains the authority for generated Windows ICO, macOS/Linux PNG resources, and Chrome extension icons.

## Compatibility Boundary

Do **not** rename compatibility or protocol identifiers merely because they contain the old brand. Preserve these unless a test proves they are user-visible branding rather than a compatibility key:

- `CLF_*` environment variables, DOM classes, globals, protocol fields, and internal prefixes.
- Bridge identity `app: 'chat-on-steroids'` and bridge protocol semantics.
- Existing per-user storage/data directory names such as `chat-on-steroids`.
- Existing durable fingerprints and migration keys.
- Existing virtual workspace/internal path semantics.

This keeps already-installed extensions, pairings, settings, stored sessions, and upgrade paths compatible.

## Visible Naming

- Product/app/window/tray name: `ComGu`
- MCP connector display names: `ComGu Core`, `ComGu Desktop`
- Chrome extension name: `ComGu companion`
- Chrome extension action title: `ComGu`
- Packaging artifact prefix: `ComGu`
- Windows shortcut/uninstaller display name: `ComGu`
- macOS bundle display/product names: `ComGu`
- Linux desktop display name: `ComGu`

Internal npm package name and stable Linux executable/package identifiers may remain `chat-on-steroids` where changing them would alter update/storage compatibility; user-visible package metadata and artifact filenames must say ComGu.

## Artwork

Use the supplied mascot in `artwork/comgu-logo.jpg` without AI regeneration or stylistic editing. Run `npm run icon` so every generated icon derives from the same source. Verify generated extension icons and build icons exist and are non-empty.

## Testing

Use TDD for behavioral/contract changes. Add or update tests before production changes so branding contracts fail on the old names, then turn them green. Focus on packaging metadata, MCP connector display names, renderer/extension visible titles, and icon pipeline outputs.

Run focused tests first, then typecheck, build, packaging tests, and the broad relevant suite. Do not use git during this task.
