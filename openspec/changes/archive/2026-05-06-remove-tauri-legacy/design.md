## Context

`src/main.ts` has been a dual-mode bootstrap since the v0.3 web pivot: a runtime `__TAURI_INTERNALS__` check branches between the v0.2 desktop flow (file-system reads, native dialogs, OS-level file-open events, Cmd+S save) and the v0.3 web flow (`bootstrapWeb` → URL parser → spec fetch → viewer mount → JIT-auth keydown). The Tauri branch was kept verbatim for rollback safety; `src-tauri/` remained on disk but was removed from the active Cargo workspace (the workspace `[workspace]` section is now empty) and from CI.

The dual-mode shape was always tactical. Two months in, the cracks are visible:

1. **UI bleed.** `installEditToggle` (Tauri-era global toggle button) is mounted from `bootstrap()` regardless of mode, and only enabled inside the Tauri showcase-mount `.then(...)` (`src/main.ts:853`). In web mode the button stays `disabled=""` permanently and confuses users who expect it to work — confirmed live (`<button data-testid="edit-toggle" ... disabled="">Edit</button>` in production DOM).
2. **Test scaffold drift.** `vitest.setup.ts` opts every test into Tauri mode by default (sets `window.__TAURI_INTERNALS__ = {}`), and web-mode tests have to opt out per-test. Adding tests to web modules requires remembering this default, which the qa-tdd agents have tripped on more than once.
3. **Bundle weight.** Vite still tree-shakes `@tauri-apps/api/event`, `@tauri-apps/api/core`, and `@tauri-apps/plugin-dialog` imports out of the production bundle, but they sit in `package.json` and `node_modules`, slowing installs and confusing dependabot.
4. **Cognitive cost.** Every change to `main.ts` requires reasoning about both modes. The file is 1,016 lines; a sizable fraction is dead in the browser.

Per CLAUDE.md, full deletion was always the plan once "v0.3 has shipped green for one week" — that gate has passed.

## Goals / Non-Goals

**Goals:**

- Eliminate the Tauri-mode runtime branch from `src/main.ts` so the web bootstrap is the only path.
- Delete `src-tauri/` and the root workspace `Cargo.toml` so the repo no longer carries a Rust crate.
- Remove `@tauri-apps/*` runtime + dev dependencies from `package.json`.
- Replace the disabled-Edit-button regression with a working web-mode entry point in the viewer header.
- Shrink and de-confuse the Vitest setup (no Tauri-mode default; web is the only mode).
- Keep `specs/v0.2.3-bundle-signing/` and other historical desktop docs as-is — they are history, not active spec.

**Non-Goals:**

- Re-architecting the web bootstrap. `bootstrapWeb`, `attemptEditAction`, `enterEditMode`, save flow, session indicator — unchanged contracts.
- Touching the Cloudflare Pages Functions backend (`functions/`). This is a frontend-only cleanup.
- Reviving any desktop-specific features in the web app (frontmatter side-panel rendering, File > New From Template menus, OS file-open routing). Those were Tauri-only affordances; the web flow has no analogue and does not need one.
- Rebranding or restructuring `openspec/`. Stale Tauri references get edited in-place; no reorganization.
- Touching the `pomodoro` → `Hashly` rename history (CLAUDE.md notes stale references; we will sweep them as we touch files but not as a goal).

## Decisions

### Decision 1: Delete `src-tauri/` and the workspace `Cargo.toml`, do not just stop building it

**Choice**: `git rm -r src-tauri/` and `git rm Cargo.toml` (root). No replacement.

**Rationale**: The crate is already excluded from the active workspace and from CI. Keeping it on disk for "rollback safety" is illusory — the canonical rollback target is the v0.2.3 git tag (a real, signed, notarized release), not a partial source tree on `main`. Leaving it on disk:
- Bloats `git grep` and IDE indexing (every search hits `src-tauri/src/lib.rs` once).
- Confuses contributors who clone the repo and assume it's an active build target.
- Defeats the cleanup's primary motivation (cognitive load).

**Alternatives considered**:
- *Move to a `legacy/` subtree*: same indexing/grep cost, just renamed. Rejected.
- *Tag the current SHA as `desktop-rollback-anchor` and delete*: redundant with the v0.2.3 release tag. Skipped.
- *Keep the directory but add `.gitignore`-style markers*: doesn't help indexing/grep. Rejected.

### Decision 2: Strip the `__TAURI_INTERNALS__` branch from `main.ts` rather than refactor `main.ts` into a web-only module

**Choice**: Edit `main.ts` in place — drop Tauri imports, remove Tauri-only functions, remove the `isTauri` check, inline `bootstrapWeb` into `bootstrap`.

**Rationale**: The shipped web code already lives in `main.ts` and downstream modules (`router.ts`, `fetch-spec.ts`, `landing.ts`, `viewer-header.ts`, `viewer.ts`, `edit-mode.ts`, `save-flow.ts`, `session-indicator.ts`). A rename + re-shuffle would force every test import path to change without producing better-named code. Keeping `main.ts` as the bootstrap entry preserves Vite's `index.html → src/main.ts` chain and the entire downstream import graph.

**Alternatives considered**:
- *Rename `main.ts` to `web-bootstrap.ts` and recreate `main.ts` as a thin re-export*: pure churn, no caller benefit.
- *Split web bootstrap into a new `src/bootstrap/` directory*: same churn; the file is small enough post-strip (~400 lines) that further splitting is premature.

### Decision 3: Replace the disabled `installEditToggle` button with a viewer-header Edit button instead of removing the affordance entirely

**Choice**: Delete `installEditToggle` / `toggleEditMode` from `main.ts`. Add a new Edit button rendered by `src/viewer-header.ts`, enabled after `mountViewer` succeeds, click-handler calls `attemptEditAction(host)` (same path keydown takes).

**Rationale**: The keydown-only entry point is hostile UX (no affordance, no discoverability) — discovered today when the user tried to "click edit" and nothing happened. The viewer-header is the natural home: it already carries the repo/path/ref coords and the "View on GitHub" link. Reusing `attemptEditAction` keeps the JIT-auth state machine (anonymous → /auth/start, no-push → view-only-lock, push-allowed → enter edit mode) as the single source of truth. The existing keydown listener stays as a fallback / power-user shortcut.

**Alternatives considered**:
- *Keep `installEditToggle` but enable it in web mode*: it appends to `document.body` (not the header), uses `position: fixed` styling tied to the desktop chrome, and routes through `toggleEditMode` (Tauri-flavored — destroys/re-mounts via the Tauri showcase path, no JIT auth). Wiring it to the web flow would be 80% rewrite anyway, and it would still live in the wrong DOM location.
- *Drop the button, leave keydown as the only entry*: regresses UX. Users will keep trying to click.
- *Add the button inside `bootstrapWeb` directly*: muddles the bootstrap with viewer-chrome rendering. The header already owns the chrome.

### Decision 4: Delete Tauri-only tests outright; do not skip / quarantine them

**Choice**: `git rm` the test files whose subject is exclusively a Tauri code path. Delete `vitest.setup.ts` Tauri-mode default. Web tests that previously called `delete window.__TAURI_INTERNALS__` to opt out drop the boilerplate.

**Rationale**: A skipped test is a permanently failing test that nobody reads. The deleted code paths have no behavioral coverage left to preserve — when the production code goes, the tests go with it. The list of deletable tests was enumerated in the proposal Impact section.

**Alternatives considered**:
- *Quarantine to a `__tests__/legacy/` directory and `it.skip`*: rot magnet. Rejected.
- *Convert to web-mode tests where possible*: most of the deletable tests assert behavior that has no web analogue (drag-drop into a browser is a different feature; Cmd+S in the browser intentionally has no handler per the comment at `main.ts:773-778`).

### Decision 5: Specs delta touches `spec-pr-editor` only

**Choice**: Add a single requirement to `spec-pr-editor` pinning that the edit-mode entry includes a visible click-driven affordance (the header Edit button), in addition to the existing keydown trigger.

**Rationale**: The `spec-pr-editor` spec is silent on the affordance shape today, which is exactly how the disabled-button regression slipped past review. Pinning the requirement creates a test gate against a future regression where someone removes the button. `spec-link-viewer` is unaffected (anonymous read flow has no edit affordance). No new capability — the JIT-auth flow itself already exists.

**Alternatives considered**:
- *Update both specs*: `spec-link-viewer` doesn't talk about editing; out of scope.
- *Skip the spec change*: leaves the same gap that allowed the regression. Rejected.

## Risks / Trade-offs

- **[Risk] A user has a workflow that depended on the Tauri-only desktop build from `main`** → Mitigation: v0.2.3 is the published desktop release; users are already directed there. CHANGELOG / release notes for this change will explicitly call out "desktop builds from `main` no longer work — use the v0.2.3 tag." The CLAUDE.md "post-#95 follow-up" note already telegraphed this.
- **[Risk] Removing `vitest.setup.ts`'s Tauri-mode default breaks tests that quietly relied on it** → Mitigation: the implementation runs the full Vitest suite after each deletion batch, not just at the end. A test that breaks tells us its subject is actually web-mode and was masking as Tauri — the fix is to drop its `__TAURI_INTERNALS__` opt-out, not restore the global default.
- **[Risk] The new viewer-header Edit button changes the header layout enough to break a CSS assumption** → Mitigation: snapshot the current header DOM in a test before adding the button; the header tests already exist (`viewer-header.test.ts` if present, else add). Visual regression is human-verified via `npm run dev` per the CLAUDE.md "for UI changes, test in browser" rule.
- **[Risk] We delete a test whose web-mode coverage was non-obvious** → Mitigation: every deletion in the tasks list is justified file-by-file, and the adversarial-reviewer pass after the build is the second gate. If a deletion was wrong, coverage gaps surface there.
- **[Trade-off] One-shot deletion vs. staged**: a staged plan (delete tests in PR 1, code in PR 2, deps in PR 3) lowers per-PR risk but multiplies review overhead and creates intermediate states where dead code is half-removed. Given the change is a removal (no new behavior to bake in), one PR is cleaner — the bisect target is one commit, not three.
- **[Trade-off] Rust crate deletion is irreversible without a tag**: covered by the v0.2.3 release tag, which is signed/notarized and publicly downloadable. Acceptable.
