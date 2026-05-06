## Why

v0.3 sunset the Tauri desktop app, but the Tauri-era code in `src/main.ts` (and the `src-tauri/` crate) was preserved unchanged for rollback safety. v0.3 has now shipped green, and the dual-mode bootstrap is actively leaking broken UI into the browser: the `installEditToggle` button is mounted globally and stays permanently `disabled` in web mode (it is only enabled in the Tauri showcase-mount path), so users see a dead "Edit" button in the viewer header. Other Tauri-only seams (Cmd+S save handler, drag-drop guard, close guard, `listen('menu-open-file' / 'new-from-template')`, `handleFileOpened`, frontmatter panel) are dormant in the browser but still loaded, complicate every change to `main.ts`, and pull in `@tauri-apps/*` packages the web build does not need.

CLAUDE.md flagged this cleanup as the planned post-merge follow-up to #95 once v0.3 had shipped green for one week — that gate has now passed.

## What Changes

- **BREAKING**: Delete the `src-tauri/` crate and the empty workspace `Cargo.toml` at the repo root. The desktop app is no longer buildable from this commit forward (v0.2.3 remains the final desktop release tag for rollback).
- Remove the `__TAURI_INTERNALS__` mode branch from `src/main.ts`; the bootstrap unconditionally runs the web flow.
- Delete Tauri-only code paths: `installSaveHandler` (Cmd+S → Tauri save dialog), `installDragDropGuard`, `installCloseGuard`, `installEditToggle` and `toggleEditMode`, `handleFileOpened`, `openFileViaDialog`, the `listen('menu-open-file' / 'new-from-template' / 'file-opened-by-os')` wiring, and the showcase-mount fallback.
- Remove imports of `@tauri-apps/api/event`, `@tauri-apps/api/core`, `@tauri-apps/plugin-dialog` from `src/main.ts` and uninstall the corresponding npm packages.
- Delete v0.2 desktop tests in `src/__tests__/` whose subject is Tauri-only (drag-drop guard, close guard, save handler, edit-toggle button, `handleFileOpened`, file-open-by-os, new-from-template) and remove the `vitest.setup.ts` Tauri-mode default that sets `window.__TAURI_INTERNALS__ = {}`. Tests for code that survives (frontmatter parsing, broken-image fallback, sanitizer, viewer mount, save flow, JIT-auth keydown, edit-mode flip) stay.
- Delete `src/fixtures/commonmark-showcase.md` and `src/templates/{prd,vision,task}.md` (only consumed by the desktop showcase / File > New From Template paths).
- Replace the stranded "Edit" button with a web-mode entry point: a button rendered by `src/viewer-header.ts` that calls `attemptEditAction(host)` (same path the keydown handler uses), enabled after `mountViewer` succeeds.
- Update CLAUDE.md and any stale references in `specs/` / `openspec/` to drop the "src-tauri kept for rollback" / "post-#95 follow-up" notes.

## Capabilities

### New Capabilities

<!-- None — this is a code-removal change. The viewer-header Edit button is a UX completion of the existing spec-pr-editor JIT-auth flow, not a new capability. -->

### Modified Capabilities

- `spec-pr-editor`: clarify the edit-mode entry-point requirement so it pins a visible, click-driven affordance (the viewer-header Edit button) in addition to the existing keydown trigger. Today the spec is silent on the affordance, which is how the disabled-button regression slipped through.

## Impact

- **Code removed**: `src-tauri/` (entire crate), root `Cargo.toml`, ~600 lines of Tauri-mode code in `src/main.ts`, ~8 desktop test files in `src/__tests__/`, `src/fixtures/`, `src/templates/`, `vitest.setup.ts` Tauri default.
- **Dependencies removed**: `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/cli` (devDep) — verified by `package.json` audit during tasks.
- **Code added**: viewer-header Edit button (~30 LOC in `src/viewer-header.ts`), a focused test asserting the button is enabled after `mountViewer` and click-fires `attemptEditAction`.
- **CI**: no change — the `src-tauri/` cargo job was already removed; Vitest suite shrinks. Bundle size drops (Vite no longer pulls `@tauri-apps/*` shims).
- **Deploy**: zero runtime impact in production (the deleted code was already dormant in the browser). Cloudflare Pages auto-deploys the next push.
- **Rollback**: reverting this change restores the desktop crate; v0.2.3 git tag is the canonical desktop rollback target either way.
- **Out of scope**: the desktop release infrastructure (signing, notarization specs in `specs/v0.2.3-bundle-signing/`) — those documents remain as historical record; no edits.
