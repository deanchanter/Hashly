# Tasks: Hashly v0.1 — WYSIWYG Markdown Reader

**Partially shipped on 2026-04-29** — only slice 13 (#18, Frontend test harness) shipped via the milestone PR. All other slices remain open for a follow-up run.

Source: [spec.md](./spec.md)

1. [Tauri window opens with hello-world HTML](https://github.com/deanchanter/Hashly/issues/1) — A developer can launch a Hashly window via `cargo tauri dev`.
2. [Milkdown mounts and renders a one-line markdown string read-only](https://github.com/deanchanter/Hashly/issues/2) — The app shows actual rendered markdown via Milkdown.
3. [Render a full CommonMark fixture read-only](https://github.com/deanchanter/Hashly/issues/3) — All standard CommonMark elements render correctly.
4. [Open a `.md` file via File > Open](https://github.com/deanchanter/Hashly/issues/4) — A PM can open their SDD spec from the menu bar.
5. [Open a `.md` file via Finder double-click](https://github.com/deanchanter/Hashly/issues/5) — Double-clicking a `.md` in Finder opens it in Hashly.
6. [Read ↔ Edit toggle (WYSIWYG edit mode)](https://github.com/deanchanter/Hashly/issues/6) — A PM can switch between reading and editable views.
7. [Dirty indicator + Cmd+S save](https://github.com/deanchanter/Hashly/issues/7) — Edits show a dirty marker; Cmd+S saves and clears it.
8. [Unsaved-changes-on-close dialog](https://github.com/deanchanter/Hashly/issues/8) — Closing with unsaved edits prompts Save / Don't Save / Cancel.
9. [Light & dark mode (follows OS)](https://github.com/deanchanter/Hashly/issues/9) — Both views render correctly in either macOS appearance.
10. [Friendly error for binary / non-UTF-8 `.md`](https://github.com/deanchanter/Hashly/issues/10) — Non-text files show a clear message instead of crashing.
11. [Best-effort render for malformed markdown](https://github.com/deanchanter/Hashly/issues/11) — Pathological markdown renders without crashing.
12. [Package & ship: `.dmg` GitHub release](https://github.com/deanchanter/Hashly/issues/12) — A downloadable `.dmg` exists on a GitHub release.
13. [Frontend test harness: Vitest unit tests](https://github.com/deanchanter/Hashly/issues/18) — `npm test` runs a Vitest suite covering frontend behavior.

---

### 1. Tauri window opens with hello-world HTML

**User value:** A developer can run `cargo tauri dev` and see a Hashly window appear on macOS — proves the toolchain is set up.

**Acceptance criteria:**
- [x] `cargo tauri dev` launches a native macOS window titled "Hashly".
- [x] Window contains static HTML (e.g. `<h1>Hello Hashly</h1>`).
- [x] Repo has a working Tauri project structure (Rust core + frontend assets) committed.
- [x] README documents the dev command.

**Notes:** No Milkdown yet. Establishes the Tauri scaffolding the rest of the slices build on. Pin a Tauri version.

### 2. Milkdown mounts and renders a one-line markdown string read-only

**User value:** The app shows actual rendered markdown (not raw HTML), proving the chosen WYSIWYG library works inside Tauri's WebView.

**Acceptance criteria:**
- [x] Window contents replaced by a Milkdown instance.
- [x] Milkdown renders the string `# Hello` as a styled H1.
- [x] Editor is read-only (no caret, can't type).
- [ ] No console errors in the WebView. _(awaiting manual host smoke — `cargo tauri dev` + WebView devtools)_

**Notes:** Depends on #1. Confirmed Milkdown integrates with Tauri's system WebView. Adopted Vite + TypeScript (lifted the "no JS toolchain" v0.1 constraint). ProseMirror baseline CSS (`@milkdown/prose/view/style/prosemirror.css`) ships; `aria-readonly="true"` set on the editor root via `EditorProps.attributes` to compensate for Milkdown's hardcoded `role="textbox"`. Verify pass surfaced six follow-ups (production build hardening, CSP, UX polish, README troubleshooting, dragover bypass, heading-id collisions) — see "Follow-ups from #2 verify pass" at the bottom.

### 3. Render a full CommonMark fixture read-only

**User value:** Confirms Hashly can render the full range of markdown a PM will see in an SDD spec.

**Acceptance criteria:**
- [ ] A fixture markdown string/file is bundled covering: headings (h1–h6), ordered + unordered + nested lists, fenced code blocks, inline code, tables, links, images, blockquotes, bold/italic, horizontal rules.
- [ ] All elements render correctly in the read-only Milkdown view.
- [ ] Visual check passes in both light and dark system appearance (even if theming isn't wired yet — just confirm it doesn't break).

**Notes:** Depends on #2. Fixture will be reused as a manual smoke test for later slices. **Blocked by follow-up:** "Heading id collisions: commonmark slugger emits duplicates" — fixture must include duplicate heading text and assert unique ids.

### 4. Open a `.md` file via File > Open

**User value:** The PM can open their actual SDD spec from disk via the menu bar.

**Acceptance criteria:**
- [ ] App has a native macOS menu with **File > Open…** (Cmd+O).
- [ ] Selecting it shows a native file picker filtered to `.md` files.
- [ ] Choosing a file replaces the current view with that file's rendered content.
- [ ] Window title updates to the filename.
- [ ] Opens in <1s for a typical (<1MB) spec doc.

**Notes:** Depends on #3. File reading happens in Rust; pass content to the WebView. **Blocked by follow-ups:** "Set CSP on Tauri WebView before #4 lands" (security — arbitrary markdown rendering needs CSP set first) and "ProseMirror dragover bypass surfaces if Tauri dragDropEnabled is flipped" (must install a window-level dragover guard before any HTML5 drag-drop work).

### 5. Open a `.md` file via Finder double-click

**User value:** The PM can double-click a `.md` in Finder and have Hashly open it — the primary entry point for the persona.

**Acceptance criteria:**
- [ ] Hashly registers as a handler for `.md` files (Tauri `fileAssociations` bundle config).
- [ ] Double-clicking a `.md` in Finder launches Hashly (if not running) or focuses it (if running) and renders that file.
- [ ] Works against an installed `.app` bundle (not just `cargo tauri dev`).

**Notes:** Depends on #4. Requires building/installing the app bundle to test. May surface signing/notarization issues early — that's fine, defer the fix to #12.

### 6. Read ↔ Edit toggle (WYSIWYG edit mode)

**User value:** The PM can switch into an editable WYSIWYG view to make a clarification or correction, then switch back to reading.

**Acceptance criteria:**
- [ ] A visible toggle (button or menu item) switches between read-only and editable Milkdown.
- [ ] Default state on file open is **read-only**.
- [ ] In edit mode, user can type and the document updates in-memory.
- [ ] Switching back to read mode preserves the in-memory edits (does not discard them or reload from disk).

**Notes:** Depends on #4. Edits aren't persisted yet — that's #7.

### 7. Dirty indicator + Cmd+S save

**User value:** The PM can save their edits back to disk and see clearly whether there are unsaved changes.

**Acceptance criteria:**
- [ ] Any in-memory edit sets a visible dirty indicator (e.g. dot in title bar, modified filename).
- [ ] Cmd+S serializes the current document back to markdown and writes it to the original file path.
- [ ] After a successful save, the dirty indicator clears.
- [ ] Round-trip: open → edit → save → reopen → edits are present.

**Notes:** Depends on #6. Milkdown's markdown serialization should be lossless for CommonMark; verify on the fixture doc.

### 8. Unsaved-changes-on-close dialog

**User value:** The PM doesn't lose work by accidentally closing the window.

**Acceptance criteria:**
- [ ] Closing the window (red button or Cmd+W) with a dirty document shows a native "Save / Don't Save / Cancel" dialog.
- [ ] **Save** writes to disk and closes.
- [ ] **Don't Save** discards and closes.
- [ ] **Cancel** keeps the window open with edits intact.
- [ ] Closing a clean document closes immediately, no prompt.

**Notes:** Depends on #7. Standard macOS behavior — use Tauri's close-requested event + native dialog.

### 9. Light & dark mode (follows OS)

**User value:** The reading view looks right whether the PM uses light or dark macOS appearance.

**Acceptance criteria:**
- [ ] Read view and edit view both render legibly in light appearance.
- [ ] Both render legibly in dark appearance.
- [ ] Switching macOS appearance while Hashly is open updates the app live (no restart).
- [ ] No settings UI; theme is purely OS-driven.

**Notes:** PRD open question resolved as "follow OS" since there's no settings UI. Use `prefers-color-scheme` in the WebView; verify Milkdown theming swaps cleanly.

### 10. Friendly error for binary / non-UTF-8 `.md`

**User value:** If the PM accidentally opens a corrupt or binary file with a `.md` extension, they see a clear message instead of a crash or garbled output.

**Acceptance criteria:**
- [ ] Opening a non-UTF-8 file shows a friendly message ("Can't open this file — it doesn't look like text.") in place of rendered content.
- [ ] App does not crash.
- [ ] User can dismiss/recover and open another file via File > Open.

**Notes:** Depends on #4. Detect at file-read time in Rust; propagate a typed error to the frontend.

### 11. Best-effort render for malformed markdown

**User value:** Pathological or weird markdown still opens and renders something — never a crash or blank screen.

**Acceptance criteria:**
- [ ] A test fixture of malformed markdown (unclosed code fences, broken tables, weird HTML, deeply nested lists) renders without crashing.
- [ ] Rendering is best-effort — partial output is acceptable.
- [ ] No unhandled exceptions in the WebView console.

**Notes:** Depends on #3. Mostly relies on Milkdown's resilience; this slice is about *verifying* and adding fixtures, not building a parser.

### 12. Package & ship: `.dmg` GitHub release

**User value:** A non-technical PM can download Hashly from a GitHub release page, install it, and open their first `.md` file.

**Acceptance criteria:**
- [ ] `cargo tauri build` produces a `.dmg`.
- [ ] A GitHub release exists with the `.dmg` attached.
- [ ] Downloading and double-clicking the `.dmg` installs Hashly to Applications.
- [ ] Launching the installed app and opening a `.md` works end-to-end.
- [ ] Gatekeeper friction is either resolved (signing + notarization) or documented in the release notes with the right-click-Open workaround.

**Notes:** PRD open question on signing/notarization. Acceptable to ship unsigned with documented workaround for v0.1; revisit if friction is too high.

### 13. Frontend test harness: Vitest unit tests

**User value:** Maintainers can lock down frontend behavior with fast unit tests, catching regressions in the Milkdown wiring (read-only mode, fixture rendering, edit toggle) before they hit a manual host smoke.

**Acceptance criteria:**
- [x] Vitest + jsdom added as devDependencies; `vitest.config.ts` configured.
- [x] `npm test` runs Vitest and exits 0 on a green suite.
- [x] At least one meaningful passing test against existing frontend behavior — `mountEditor` produces a read-only Milkdown instance with `aria-readonly="true"` on the editor root, renders `# Hello` as an `<h1>`, and configures `contenteditable="false"`.
- [x] Test files colocated under `src/__tests__/` — convention documented in README.
- [x] README documents `npm test` alongside the existing `cargo test` line.
- [x] CI follow-up filed as #20 (no GitHub Actions workflow exists yet — wiring deferred to that issue).

**Notes:** Depends on #2. Today the frontend is only verified via Rust integration tests (`src-tauri/tests/`) + manual `cargo tauri dev` smoke. A Vitest layer lets future tasks (#3 fixture rendering, #6 edit toggle, #7 dirty/save round-trip) ship with TS-level coverage instead of leaning entirely on manual checks. Pick `jsdom` if Milkdown's ProseMirror needs full DOM APIs; `happy-dom` is faster but has gaps — verify before committing. **Shipped 2026-04-29 with `jsdom`; verify pass surfaced 3 follow-ups (#20 CI, #21 stronger ARIA assertions, #22 auto-mount guard) — see "Follow-ups from #18 verify pass" at the bottom.**

---

## Follow-ups from #2 verify pass

Filed as separate GitHub issues (numbers assigned at `gh issue create` time — see `/.claude/file-followup-issues.sh`). Not part of the v0.1 task list above; tracked here only so dependencies on #3 and #4 are visible.

- **Tighten production build: enable sourcemaps + tsconfig strictness** — dev quality.
- **Set CSP on Tauri WebView before #4 lands** — security; **blocks #4**.
- **UX polish: read-only editor shows I-beam cursor + isn't keyboard-focusable** — a11y/UX.
- **README: document `cargo tauri dev` failure modes (port 1420 busy, missing `node_modules`)** — DX.
- **ProseMirror dragover bypass surfaces if Tauri `dragDropEnabled` is flipped** — **blocks #4** if it uses HTML5 drag-drop.
- **Heading id collisions: commonmark slugger emits duplicates** — **blocks #3**.

## Follow-ups from #18 verify pass

Filed during the 2026-04-29 ship-milestone run. All carry the `v0.1-wysiwyg-editor` label so a future run picks them up.

- **#20: CI: run npm test alongside cargo test in GitHub Actions** — no CI workflow exists yet.
- **#21: Strengthen #18 mountEditor test assertions: pin to ProseMirror root + assert role** — current ARIA assertions match any descendant; future Milkdown upgrade could regress silently.
- **#22: Guard `src/main.ts` auto-mount against test-time side effects + warn on missing `#editor`** — current auto-mount is silent on missing host and could race future Vitest tests that pre-seed `#editor`.
