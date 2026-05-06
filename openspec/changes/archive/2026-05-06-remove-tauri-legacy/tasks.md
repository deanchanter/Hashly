## 1. Add the viewer-header Edit button (TDD before any deletion)

- [x] 1.1 Write a failing test in `src/__tests__/viewer-header-edit-button.test.ts`: after `renderViewerHeader` runs, the header contains a `[data-testid="header-edit-button"]` button that is initially disabled, and exposes a hook for the bootstrap to enable it.
- [x] 1.2 Write a failing test: clicking the (enabled) header Edit button calls `attemptEditAction` against the editor host (mock the import; assert it was called with the editor host element).
- [x] 1.3 Write a failing integration test in `src/__tests__/bootstrap-web-edit-button.test.ts`: after `bootstrapWeb` finishes a successful spec mount, the header Edit button is enabled. After a failed `mountViewer`, the header Edit button is absent (error surface owns the DOM).
- [x] 1.4 Implement: extend `src/viewer-header.ts` to render the Edit button (disabled by default), expose a `setEditButtonEnabled(host, enabled)` helper, and mount a click listener that calls `attemptEditAction` against the editor host element passed in via the header info.
- [x] 1.5 Wire `bootstrapWeb` in `src/main.ts` to call `setEditButtonEnabled(headerHost, true)` after `mountViewer` resolves successfully. Run `npm test` — all 1.x tests green.
- [ ] 1.6 Manually verify in `npm run dev`: load a public README link, observe the header Edit button enables after mount, clicking it triggers the JIT-auth redirect when anonymous, flips into edit mode for an authed push-allowed user. *(Deferred — user-side browser verification.)*

## 2. Strip the Tauri-mode branch from the bootstrap

- [x] 2.1 Write a failing test asserting `bootstrap()` runs the web flow regardless of `window.__TAURI_INTERNALS__` being defined or not (the mode check should be gone).
- [x] 2.2 Edit `src/main.ts`: remove the `isTauri` constant and the `if (!isTauri) { … return; }` branch; inline `bootstrapWeb`'s call into `bootstrap` directly.
- [x] 2.3 Delete the global `installEditToggle`, `toggleEditMode`, `syncEditToggleUi`, `editToggleButton`, `editToggleInstalled`, `EDIT_TOGGLE_LABEL_*` constants, and every `editToggleButton.disabled = …` site.
- [x] 2.4 Delete `installSaveHandler`, `installDragDropGuard`, `installCloseGuard`, `installEscapeHandler` (audit: keep only the parts that are web-relevant; the Tauri-flavored Cmd+S, drag-drop guard, and close-guard tracking are not).
- [x] 2.5 Delete `handleFileOpened`, `openFileViaDialog`, `sanitizeFilename`, `currentFileName`, `currentFilePath`, `currentFrontmatter` module state, the frontmatter `renderFrontmatterPanel` helper, and the `listen<>('menu-open-file' | 'new-from-template' | 'file-opened-by-os')` wiring.
- [x] 2.6 Delete the showcase mount fallback (the `mountEditor(host, showcase)` block in the old Tauri branch) and the `TEMPLATES` map / `TemplateKind` type.
- [x] 2.7 Remove `import` lines for `@tauri-apps/api/event`, `@tauri-apps/api/core`, `@tauri-apps/plugin-dialog`, the `showcase` fixture, and the `prd` / `vision` / `task` template raw imports.
- [x] 2.8 Run `npm test` after each deletion batch (2.3, 2.4, 2.5, 2.6) — fix any failure by deleting the now-orphaned test (tracked in section 4) rather than restoring the code.
- [x] 2.9 Run `npm run build` to confirm Vite still produces a clean bundle; spot-check the bundle no longer contains `data-testid="edit-toggle"` (the bleed-through artifact).

## 3. Remove `src-tauri/` and the workspace `Cargo.toml`

- [x] 3.1 Confirm v0.2.3 is tagged in `git tag --list` and the tag points at the desired desktop-rollback SHA. If not, document the rollback target in this task before deleting.
- [x] 3.2 `git rm -r src-tauri/`.
- [x] 3.3 `git rm Cargo.toml` (the empty root workspace manifest). Verify there is no other `Cargo.toml` at the repo root.
- [x] 3.4 Search for any remaining references: `git grep -i 'src-tauri\|tauri' -- ':!openspec' ':!CHANGELOG*'`. For each hit outside historical specs, update or delete.
- [x] 3.5 Run `npm test && npm run build` — both green.

## 4. Delete the orphaned Tauri tests

- [x] 4.1 Enumerate Tauri-only tests via `git grep -l '__TAURI_INTERNALS__\|@tauri-apps\|invoke(\|listen(' src/__tests__/`.
- [x] 4.2 For each file in 4.1, confirm it tests a code path that section 2 deleted (drag-drop guard, close guard, save handler, edit-toggle button, `handleFileOpened`, file-open-by-os, new-from-template, frontmatter panel rendering, showcase mount).
- [x] 4.3 `git rm` each confirmed Tauri-only test file.
- [x] 4.4 Edit `vitest.setup.ts`: remove the global `window.__TAURI_INTERNALS__ = {}` default. Drop any `vi.mock('@tauri-apps/...')` shims.
- [x] 4.5 In surviving tests, delete any `delete (window as any).__TAURI_INTERNALS__` opt-out or `__TAURI_INTERNALS__ = undefined` boilerplate — the global default is gone, so opting out is meaningless.
- [x] 4.6 Run `npm test` — all surviving tests green.

## 5. Drop runtime + dev dependencies

- [x] 5.1 Edit `package.json`: remove `@tauri-apps/api`, `@tauri-apps/plugin-dialog` from `dependencies`, and `@tauri-apps/cli` from `devDependencies` (any version pin).
- [x] 5.2 Run `npm install` so `package-lock.json` is regenerated cleanly. Verify with `npm ls @tauri-apps/api` (should print "(empty)" or fail with `not found`).
- [x] 5.3 Run `npm test && npm run build` — both green.
- [x] 5.4 Delete `src/fixtures/commonmark-showcase.md` and `src/templates/{prd,vision,task}.md` if no surviving code imports them. Confirm via `git grep -F 'src/fixtures' && git grep -F 'src/templates'`.

## 6. Documentation sweep

- [x] 6.1 Edit `CLAUDE.md`: remove the "src-tauri kept for rollback" note, the "post-#95 follow-up" note, the `cargo tauri dev` / `cargo tauri build` mention, and the line about `vitest.setup.ts` defaulting to Tauri mode. Confirm the rest of the file still reads coherently.
- [x] 6.2 Search `openspec/` for stale Tauri references: `git grep -i tauri openspec/`. Update only active specs (`openspec/specs/*.md`); leave `openspec/changes/archive/**` alone (history).
- [x] 6.3 Update `README.md` if it still mentions desktop-app install or `cargo tauri build`.
- [x] 6.4 Verify `specs/v0.2.3-bundle-signing/` and `specs/hashly-vision.md` are unchanged (historical record).

## 7. Final verification

- [x] 7.1 `npm run build` — clean.
- [x] 7.2 `npm test` — clean.
- [x] 7.3 `git grep -i 'tauri\|src-tauri\|__TAURI_INTERNALS__' -- ':!openspec/changes/archive' ':!CHANGELOG*' ':!specs/v0.2.3-bundle-signing'` — only intentional historical references remain.
- [ ] 7.4 Manually exercise in `npm run dev`: landing page renders, viewer renders for a public README link, header Edit button enables after mount, click as anonymous redirects to `/auth/start`, keydown still triggers the JIT flow. *(Deferred — user-side browser verification.)*
- [x] 7.5 `openspec validate remove-tauri-legacy` — change is valid (the CLI dropped `verify-change` in favor of `validate`).

## 8. Ship

- [x] 8.1 Open a single PR titled `chore: remove Tauri legacy from active codebase` with the proposal motivation in the body. *(PR #154.)*
- [x] 8.2 Note in the PR body: "Desktop builds from `main` no longer work; use the v0.2.3 git tag for desktop rollback." Link to the tag.
- [x] 8.3 After merge, run `/opsx:archive remove-tauri-legacy`. *(Archived before merge by user request.)*
