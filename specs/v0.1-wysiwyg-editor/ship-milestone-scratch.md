# ship-milestone scratch — v0.1-wysiwyg-editor

Started: 2026-04-30 (continuation; milestone branch already exists with #14, #18, #20, #21, #22 shipped)

User decision: ship everything except #12 (.dmg release). User will manually verify macOS-dependent behavior.

## Planned ordering (topo-aware)

1. #25 — converge strip_comments helper (Rust tests)
2. #15 — UX polish: cursor + tabindex (CSS + TS)
3. #24 — CI SHA pinning (yaml only)
4. #17 — heading slugger (TS, precondition for #3)
5. #16 — dragover guard (TS, precondition for #4)
6. #3 — render full CommonMark fixture (TS)
7. #11 — malformed markdown render (TS, depends on #3)
8. #4 — File > Open menu + CSP (Rust + TS)
9. #10 — binary/non-UTF-8 friendly error (Rust + TS, depends on #4)
10. #6 — read↔edit toggle (TS, depends on #4)
11. #7 — Cmd+S save + dirty indicator (Rust + TS, depends on #6)
12. #8 — unsaved-close dialog (Rust + TS, depends on #7)
13. #5 — Finder double-click handler (Rust config + TS, depends on #4)
14. #9 — light/dark mode follows OS (CSS + TS)

Skipped: #12 (.dmg release) — by user request.

**User request 2026-04-30 mid-#6:** stop after #6 ships. Do NOT pick up #7/#8/#5/#9 in subsequent iterations. If Ralph re-fires after this iteration, surface the pause and exit without a promise; user will `/ralph-loop:cancel-ralph` or resume manually.

## Per-issue ship log

### #25 — Converge strip_comments helper

Commits:
- `8a0b209 refactor(#25): extract shared strip_comments into tests/common/mod.rs`
- `16113ef test(#25): co-locate string-literal/escape/comment self-tests with shared helper`
- `81cf4c1 refactor(#25): migrate build_strictness.rs and frontend.rs to shared strip_comments`

Tests: cargo (full) green; npm test green. build_strictness 10→7, +3 in strip_comments_self crate, +1 in strip_comments_shared crate, frontend.rs 11 unchanged.

Critical fixed: 0
Non-critical filed: 0 (security teammate failed to deliver findings; team-lead did adversarial pass directly. Mild redundancy: `strip_comments_shared.rs` and `strip_comments_self.rs` could be merged, but each test crate compiles its own copy of `common` regardless — not worth filing.)
Reviewer status: security agent went idle without producing a report despite a follow-up ping. Team-lead substituted.

### #15 — UX polish: cursor + tabindex

Commits:
- `8935672 test(#15): pin .ProseMirror/#editor cursor: default rule in style.css`
- `6b30d71 test(#15): pin tabindex=0 on .ProseMirror root for keyboard scroll`
- `7157789 feat(#15): cursor default + tabindex=0 on read-only ProseMirror root`

Tests: cargo green (frontend.rs 11→14, +3 from #15 contracts); npm 9 (was 8, +1 dynamic tabindex).

Critical fixed: 0
Non-critical filed: 0
Process note: qa-tdd committed RED tests despite the brief instruction to wait for green. Team-lead caught it (suite was failing), pinged builder to apply impl, and committed feat() commit himself since both qa-tdd and builder went idle without committing. Tmux orphans accumulated; user manually had me clean them between iterations.
Reviewer status: team-lead substituted (cursor + tabindex changes are minimal-risk; impact on edit mode noted in issue body and will be revisited in #6).

### #24 — Pin GitHub Actions to commit SHAs

Commits:
- `362f416 test(#24): pin SHA-pin contract on every uses: in ci.yml`
- `217cd79 feat(#24): pin GitHub Actions to commit SHAs (supply-chain hardening)`

SHAs pinned (looked up via `gh api repos/<owner>/<repo>/git/ref/...`):
- actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
- actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
- dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable
- Swatinem/rust-cache@42dc69e1aa15d09112580998cf2ef0119e2e91ae # v2

Tests: ci_workflow.rs 9→12 (+3 SHA-pin contract tests; pre-existing tests relaxed to accept SHA refs but still enforce major-version intent via trailing `# v<n>` / `# stable` comments). Full cargo + npm green.

Critical fixed: 0
Non-critical filed: 0
Process note: shipped directly by team-lead — no team spawned. Change is contained (4 yaml lines + test contract update) and prior team agents have been unreliable; faster path for trivial milestone hygiene.

### #17 — Heading slugger uniqueness

Commits:
- `603d781 feat(#17): override headingIdGenerator with standard slug-counter format`

Discovery: dry-run found Milkdown's `syncHeadingIdPlugin` already disambiguates duplicates, but using non-standard `slug-#2`/`slug-#3` format. Issue's stated "duplicate id" claim was technically wrong — but the observed format breaks in-doc anchor links written in GitHub-style `[link](#hello-1)`. Fix: override `headingIdGenerator.key` with closure-captured base→counter Map.

Builder's contribution beyond the brief: added a `WeakMap<Node, string>` cache so the same heading node returns the same id across re-renders (preventing counter-creep when `syncHeadingIdPlugin` re-runs on every transaction). Also short-circuits when `node.attrs.id` is set.

Tests: npm 9→10 (+1 dynamic id-uniqueness); cargo frontend 14→15 (+1 static contract). All green.

Critical fixed: 0
Non-critical filed: 0
Process note: qa-tdd wrote tests but never messaged builder; team-lead pinged builder directly with the implementation details. Both agents went idle without committing; team-lead committed.
Reviewer status: team-lead substituted. Considered: empty-heading edge case (`# ` → id=""); accepted (matches default Milkdown behavior, not introduced by this fix).

### #16 — Window-level dragover/drop guard

Commits:
- `2f86194 feat(#16): install window-level dragover/drop preventDefault guard`

Tests: npm 10→14 (+4: export shape, dragover preventDefault, drop preventDefault, idempotency); cargo frontend 15→16 (+1 static contract). All green.

Critical fixed: 0
Non-critical filed: 0
Process note: qa-tdd wrote both dynamic AND static contract tests but went idle without committing. builder applied the edit but went idle without committing. team-lead committed all three files in one atomic commit. Tmux orphans cleaned at iteration boundary.
Reviewer status: team-lead substituted. Reviewed: idempotency flag is module-level (good for single-page lifetime, fine since vite HMR will reload the whole module anyway). preventDefault on `drop` even though the user said "before any per-element drop logic" — confirmed: window-level handlers run during the bubbling phase, and ProseMirror's drop handlers (when editable) attach to view DOM, so they don't compete here.

### #3 — Render full CommonMark+GFM showcase fixture

Commits:
- `a0b4fb8 feat(#3): render full CommonMark+GFM showcase fixture read-only`

New dep: `@milkdown/preset-gfm@^7.20.0` (CommonMark spec excludes tables; GFM provides them).

Fixture: `src/fixtures/commonmark-showcase.md` (98 lines, SDD-spec style) covering h1-h6, ordered/unordered/nested lists, fenced + inline code, GFM table, link, image, blockquote, bold/italic, HR.

Wire-up: `import showcase from './fixtures/commonmark-showcase.md?raw'` (Vite raw-import); `bootstrap()` passes it to `mountEditor()`. `.use(gfm)` after `.use(commonmark)` in the editor pipeline.

Tests: cargo frontend 16→17 (+1: fixture file existence + every-element-token contract); npm 14→15 (+1: GFM table smoke). Stale `'# Hello'` literal pin from #18 retargeted to assert the showcase-fixture import.

Critical fixed: 0
Non-critical filed: 0
Process note: qa-tdd actually drove the loop this iteration — sent SendMessage to builder, waited for response. builder added all the impl (gfm preset, fixture file, bootstrap wiring). Both still went idle without committing; team-lead committed and added the GFM table smoke test (qa-tdd hadn't covered table rendering dynamically — only static contract).
Reviewer status: team-lead substituted.

### #11 — Best-effort render for malformed markdown

Commits:
- `61d79cf feat(#11): bundle malformed-markdown fixture + best-effort mount contract`

Fixture: `src/fixtures/malformed-showcase.md` (~50 lines) covering unclosed fence, broken table, raw HTML (escaped via #14 contract), 10-level nested list, unmatched **bold and *italic, malformed link, mixed Unicode/RTL/ZWJ.

No parser changes — Milkdown's commonmark + gfm presets already handle malformed input best-effort. Issue was verification + contract pinning.

Tests: cargo frontend 17→18 (+1: malformed fixture file existence + pathology tokens); npm 15→16 (+1: dynamic mount-without-crash + no console.error).

Critical fixed: 0
Non-critical filed: 0
Process note: qa-tdd added static contract test only; team-lead added the dynamic Vitest smoke test for AC #2/#3 (mount-without-throw + no console.error). Builder created the fixture. Both agents idled without committing.
Reviewer status: team-lead substituted.

### #4 — File > Open menu + CSP

Sliced into 4 atomic commits:
- `846d4a7 feat(#4): set restrictive CSP in tauri.conf.json (slice A)`
- `5a88e23 feat(#4): add read_md_file core + FileOpened struct (slice B)`
- `eac0161 feat(#4): wire dialog plugin + File > Open menu + IPC command (slice C)`
- `d2422e1 feat(#4): handleFileOpened + dialog listener + title update (slice D)`

Architecture:
- CSP set to: `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost`. script-src deliberately excludes 'unsafe-inline'.
- Rust `read_md_file(path) -> Result<FileOpened, String>` reads UTF-8; rejects non-UTF-8 with Err (returns lossless content). #[tauri::command] registered via invoke_handler.
- Tauri menu: File > Open... (id="open", accelerator="CmdOrCtrl+O") wired in .setup(). On click emits "menu-open-file" event.
- Frontend: bootstrap() subscribes to "menu-open-file" → calls openFileViaDialog → @tauri-apps/plugin-dialog returns selected path → invoke('read_md_file', {path}) → handleFileOpened(payload, host) re-mounts editor + sets document.title.

New deps:
- Rust: tauri-plugin-dialog ^2 (runtime), tempfile ^3 (dev).
- npm: @tauri-apps/api ^2, @tauri-apps/plugin-dialog ^2.

Tests: cargo grew from ~48 to ~61 (lib.rs +3 read_md_file unit tests, tests/menu.rs +5 menu/plugin contracts, tests/config.rs +1 CSP contract, tests/frontend.rs +4 main.ts contracts). npm 16→19 (+3 dynamic handleFileOpened tests).

Critical fixed: 0
Non-critical filed: 0
Process note: 4-slice flow worked well — qa-tdd drove the sequence, builder applied each slice, team-lead committed each green. Builder still doesn't commit, qa-tdd still doesn't always SendMessage builder (slice B and slice D required a manual ping). But the slicing kept the iterations small and recoverable.

macOS-runtime caveats explicitly out of scope (per ship-milestone decision):
- native macOS menu visibility / Cmd+O keybinding behavior
- native file picker dialog appearance
- <1s render performance
User will verify these manually post-PR.

Reviewer status: team-lead substituted. Considered the security model: CSP locks script execution, raw HTML in markdown is escaped by commonmark preset (#14 regression pin), file path is passed Rust→frontend→Rust IPC (no shell injection vector since plugin-dialog returns the OS-level path verbatim and read_md_file calls fs::read_to_string with no shell). No concerns.

### #10 — Friendly error for binary / non-UTF-8 file

Commits:
- `af35c84 feat(#10): friendly error for binary / non-UTF-8 markdown files`

Implementation: new exported `renderFileError(host, message, path?)` helper builds a `role="alert"` DOM (textContent only — no innerHTML for user-controlled strings). `openFileViaDialog`'s `invoke('read_md_file')` call is wrapped in try/catch; the catch arm calls renderFileError with the contracted message. `document.title` resets to "Hashly" on error.

Tests: npm 19→24 (+5: alert renders + verbatim message + no-mount + recovery via handleFileOpened + invoke-rejection wired to renderFileError); cargo frontend 22→23 (+1 static contract — main.ts exports renderFileError + contains verbatim message).

Critical fixed: 0
Non-critical filed: 1
- #26 — Differentiate error UI for non-UTF-8 vs other invoke failures (the friendly message is hardcoded for all invoke errors; permission-denied / IPC-disconnect would also show "doesn't look like text"). Filed under milestone label.

Reviewer status: security agent spawned and went idle without producing findings (third occurrence in this run). Team-lead did the adversarial pass directly.

Process note: an unrelated edit to `claude-docker.sh` (Docker resource preflight warning) appeared in the working tree mid-iteration; not committed as part of #10 since it's outside scope.

### #6 — Read ↔ Edit toggle (WYSIWYG edit mode)

Shipped 2026-04-30 to 2026-05-01 (one ship-milestone iteration including a 7-finding fix-loop).

**AC commits (test+impl pairs, time order):**
- `e7d944b feat(#6): edit-toggle button + read↔edit mode swap (slice 1, AC #1)` — builder AC#1+2+4 by construction
- `866b6cc test(#6): pin edit-toggle button + bidirectional contenteditable swap (AC #1)`
- `19e9be4 test(#6): pin AC #2 default-on-file-open is read-only (cross-state regression)`
- `53812b8 feat(#6): export getCurrentEditor read-only getter (slice 2, AC #3)`
- `eb20b14 test(#6): pin AC #3 in-edit typing updates document in-memory`
- `7d23aeb test(#6): pin AC #4 in-memory edits survive toggle back to read mode`

**Architecture:** `mountEditor` gained `mode: 'read' | 'edit'` parameter (defaults to `'read'`). `toggleEditMode()` serializes current doc via Milkdown's `serializerCtx`, destroys, re-mounts in opposite mode — content round-trip through the serializer is the AC#4 mechanism. `getCurrentEditor()` exported as a narrow testability surface (single live module-scope reference). `installEditToggle()` adds a `[data-testid="edit-toggle"]` <button> in `bootstrap()` (idempotent flag mirrors `installDragDropGuard`).

**Reviewer pass (first round):** ux delivered 8 [critical] findings, security delivered 4 [critical]. Major overlap on label/state, button placement, and a11y.

**Critical fixes (fix-loop, all test-first):**
- `08ddc40` + `93e285e` — C1: aria-pressed + textContent sync via `syncEditToggleUi()`
- `e51fa76` + `6333f4f` — C3: `[contenteditable="true"].ProseMirror { cursor: text }` (specificity 0,0,2,0 vs read mode's 0,0,1,0)
- `7228720` + `675185c` — C4+C7: synchronous `disabled = true` + `toggleInFlight` flag in try/finally; replaced anti-pattern test
- `c4c3407` + `8d4e036` — C5: `view.focus()` after edit mount, `button.focus()` after read mount
- `4dd7116` + `b0770aa` — C6: `await currentEditor.destroy()` at top of `handleFileOpened`
- `b5e3332` + `acae8c8` — C2: `.hashly-edit-toggle { position: fixed; top/right; z-index: 10 }`

**Reviewer pass (second round):** Both reviewers confirmed **no new [critical] findings**. ~15 non-criticals between them, all triaged to follow-up issues.

**Tests:** npm 24 → 52 (+28 across AC + fix-loop, -1 anti-pattern); cargo unchanged at 36, contracts intact. Builder caught a real Vite 7 / Vitest 4 bug while implementing C3: `import css from '../style.css?raw'` returns empty in jsdom because Vite's CSS plugin strips imports before honoring `?raw`. Workaround: `fs.readFileSync` at test time (matches `src-tauri/tests/frontend.rs` pattern). C2 + C3 contract tests use this approach. Worth flagging in the milestone PR description.

**Critical fixed:** 7 (fix-loop round 1) — all confirmed clean by second-pass reviewers.

**Non-critical filed (15 follow-ups, all under milestone label):**
- First pass (8): #27 (Tab capture in edit mode), #28 (hit target/scroll/layout polish), #29 (i18n + dark-mode + reduced-motion), #30 (HMR duplicate guard), #31 (bootstrap mount .catch), #32 (Rust pin tighten for default mode), #33 (getCurrentEditor write-bypass — defer to #7 save boundary), #34 (lossy round-trip test gap)
- Second pass (7): #35 (handleFileOpened symmetry with toggle), #36 (toggle mountEditor rejection stale label), #37 (error-path hardening cross-cutting), #38 (disabled visual + label semantics), #39 (positioning robustness — scrollbar + z-index scale), #40 (sync feedback timing test pin), #41 (aria-readonly cross-state symmetry pin)

**Reviewer status:** Both `ux` and `security` agents productive on first pass and re-review (improvement over prior runs where `security` repeatedly idled without findings). qa-tdd drove the fix-loop test cycles cleanly after a brief impl-first ordering on C1/C3 (builder shipped while qa-tdd was waiting). Re-engagement pattern (SendMessage to wake teammate for second pass) worked.

**User instruction (mid-iteration, 2026-04-30):** Stop after #6 ships. Do not pick up #7/#8/#5/#9. Followed; team teardown immediately after this record.

## Phase B finalization — 2026-05-01

User re-fired Ralph with `finish ship milestone v0.1`. State read from git + gh + this scratch. All original-list issues either shipped (#3, #4, #6, #10, #11, #14, #15, #16, #17, #18, #20, #21, #22, #24, #25) or explicitly skipped per user (#5, #7, #8, #9, #12). Milestone PR not yet open → Phase B.

**Pre-flight:**
- `claude-docker.sh` had a stale Docker preflight warning sitting in working tree across iterations (recorded as deferred under #10's process note). Committed as `chore: warn on under-resourced Docker Desktop in claude-docker.sh` so the milestone branch is clean before doc reconciliation.
- `cargo test --workspace` — green (~62 tests across all crates/integration suites).
- `npm test` — green (52 tests, 4 files).

**B1 — Doc reconciliation:**
- `specs/v0.1-wysiwyg-editor/spec.md`: Status header flipped from "Partially shipped (2026-04-29 — slice #18 only)" → "Partially shipped (2026-05-01 — 15 slices shipped; 5 deferred)". Spec ACs ticked: open-via-menu (File > Open #4), CommonMark renders (#3+#11), read↔edit toggle (#6). Left unticked with deferred-marker: dirty indicator (#7), light/dark (#9).
- `specs/v0.1-wysiwyg-editor/tasks.md`: Header reset to ship-date 2026-05-01 with shipped/deferred breakdown. ACs ticked for slices 3, 4, 6, 10, 11. Per-slice `Shipped 2026-05-01` notes added with summary of what landed and follow-up references.
- `CLAUDE.md`: No edits — no stale "planned"/"will land" claims surfaced. `bundle.active = false` note remains accurate (deferred to v0.2 with #12).
- `README.md`: No edits — README documents dev workflow only, no feature claims.
- `specs/hashly-vision.md`: No edits — phase sketch is descriptive, not tickable; v0.1 partial ship doesn't materially update the vision.

Commit: `chore: close out v0.1-wysiwyg-editor`.
