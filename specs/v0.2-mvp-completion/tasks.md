# Tasks: Hashly v0.2 — MVP Completion

Source: [spec.md](./spec.md)

Sequencing per PRD: deferred-MVP slices first (1–10), wedge layered on top (13–14), brand alongside (11–12), ACL hardening (15) pairs with whichever dialog slice lands first, packaging (16) closes the milestone.

1. [Milkdown round-trip fidelity gate](https://github.com/deanchanter/Hashly/issues/45) — verify CommonMark+GFM (+ frontmatter) survive edit↔serialize with AST-equality before save lands.
2. [Save in place via Cmd+S](https://github.com/deanchanter/Hashly/issues/7) — Cmd+S writes the file in place; dirty indicator clears on success, blocking error dialog with Save As… on failure. Bundles #44, #33, #34.
3. [Unsaved-changes-on-close dialog](https://github.com/deanchanter/Hashly/issues/8) — closing a window with unsaved edits prompts Save / Don't Save / Cancel.
4. [Finder double-click opens .md](https://github.com/deanchanter/Hashly/issues/5) — double-click in Finder lands directly in reading view; bundles filename sanitization (#43).
5. [Light & dark mode follows OS](https://github.com/deanchanter/Hashly/issues/9) — both themes render correctly, switches live with prefers-color-scheme; bundles dark-mode chunk of #29.
6. [Tab key inside edit-mode editor](https://github.com/deanchanter/Hashly/issues/27) — Tab no longer indent-traps inside the editor.
7. [handleFileOpened symmetry with toggleEditMode](https://github.com/deanchanter/Hashly/issues/35) — disable + null + re-entrancy guard.
8. [mountEditor rejection in toggleEditMode](https://github.com/deanchanter/Hashly/issues/36) — no enabled button + stale label on rejection.
9. [Error-path hardening for toggle/file-open/bootstrap](https://github.com/deanchanter/Hashly/issues/37) — rejection paths surface errors instead of swallowing.
10. [bootstrap()'s showcase mount lacks .catch](https://github.com/deanchanter/Hashly/issues/31) — eliminate silent failure mode.
11. [Brand: palette + typography + wordmark](https://github.com/deanchanter/Hashly/issues/46) — paper/ink palette as CSS vars, Fraunces/Schibsted Grotesk/JetBrains Mono wired, `#hashly` wordmark in titlebar.
12. [Brand: MarkGeometric → app icon + favicon](https://github.com/deanchanter/Hashly/issues/47) — export mark to SVG, rasterize to .icns + favicon, wire into `tauri.conf.json` and `index.html`.
13. [Frontmatter recognition end-to-end](https://github.com/deanchanter/Hashly/issues/48) — parse leading YAML, render metadata panel in reading view, editable text region in edit view, lossless round-trip on save.
14. [File > New From Template](https://github.com/deanchanter/Hashly/issues/49) — PRD / Vision / Task templates open unsaved edit-mode buffer with frontmatter pre-filled (date, author); Cmd+S routes to Save As….
15. [Tauri 2 capability ACL extension + pinning test](https://github.com/deanchanter/Hashly/issues/50) — add dialog:allow-save + dialog:allow-ask/message; pin ACL contents in tests/capabilities.rs.
16. [Package & ship — unsigned .dmg + Homebrew cask](https://github.com/deanchanter/Hashly/issues/12) — flip bundle.active, GH Actions release pipeline, deanchanter/homebrew-hashly cask formula.

---

### 1. Milkdown round-trip fidelity gate

**User value:** Before save (#7) lands, we know which markdown shapes survive edit↔serialize losslessly and which don't — so #7 ships with a known disposition (fix / flag-out / accept-as-known-limitation) for every lossy form rather than discovering loss in production.

**Acceptance criteria:**
- [ ] Vitest harness drives a corpus through Milkdown's parse → edit → serialize cycle and asserts AST-equality (not byte-equality) against the source.
- [ ] Corpus covers (a) the existing CommonMark fixture used by `frontend.rs`, (b) GFM features from `@milkdown/preset-gfm@7.20.0` (tables, task lists, strikethrough), (c) fragile-markdown forms (list-marker normalization `*`↔`-`, code-fence style ` ``` `↔`~~~`, setext→ATX heading collapse, reference→inline link collapse, hard-break `  `↔`\`, emphasis style `*`↔`_`, table-cell padding/alignment), (d) frontmatter cases (no-frontmatter, valid, malformed, frontmatter-only, `---` not at offset 0).
- [ ] Output is a written report listing each lossy form with a per-case disposition: fix upstream, flag-out, or accept as documented v0.2 known-limitation.
- [ ] #7 (Save in place) is gated on this report being committed.

**Notes:** Load-bearing risk #1 in PRD § Risks. AST-equality oracle, not byte-equality. Frontmatter cases must be in the corpus from the start so slice 13 can reuse the same harness.

### 2. Save in place via Cmd+S *(existing #7; bundles #44, #33, #34)*

**User value:** PM edits a file in WYSIWYG, hits Cmd+S, and the change lands on disk in place; dirty indicator clears on success, blocks with Save As… on failure.

**Acceptance criteria:** Inherited from existing #7. Hardening sub-issues #44 (path-traversal canonicalize+prefix-check), #33 (`getCurrentEditor()` write-handle bypass), #34 (lossy round-trip test gap) ship in the same slice — they become load-bearing the moment save exists.

**Notes:** `save_md_file` registered via `invoke_handler`, reached through `core:default` IPC channel — no per-command ACL entry. `@tauri-apps/plugin-fs` explicitly avoided. Save-failure dialog: Tauri dialog plugin, three-option `Save As… / Cancel`. Depends on slice 1.

### 3. Unsaved-changes-on-close dialog *(existing #8)*

**User value:** Closing a window with unsaved edits prompts Save / Don't Save / Cancel instead of silently discarding work.

**Acceptance criteria:** Inherited from existing #8.

**Notes:** Native Tauri dialog plugin (`dialog:ask` or `dialog:message` with custom buttons — verified at wire-up). Depends on slice 2.

### 4. Finder double-click opens .md *(existing #5; bundles #43)*

**User value:** Double-clicking a `.md` in Finder opens it directly in Hashly's reading view, equivalent to File > Open.

**Acceptance criteria:** Inherited from #5. Plus #43 (sanitize `document.title` against Unicode RTL / zero-width chars).

**Notes:** macOS `RunEvent::Opened` handler. Doesn't go through ACL system. Time-box per PRD risk note — if integration becomes a quagmire, ship in v0.2.x point release.

### 5. Light & dark mode follows OS *(existing #9; bundles dark portion of #29)*

**User value:** App renders correctly in both themes and switches live with the OS — no in-app toggle, no settings UI.

**Acceptance criteria:** Inherited from #9. Plus the dark-mode chunk of #29 (toggle-button polish in dark mode); i18n + reduced-motion portions of #29 slip to v0.3.

**Notes:** `prefers-color-scheme` flips palette CSS variable bindings (slice 11 lands the variables). Pairs with slice 11.

### 6. Tab key inside edit-mode editor *(existing #27)*

**User value:** Tab key behaves correctly inside the edit-mode editor — not captured / indent-trapped.

**Acceptance criteria:** Inherited from existing #27.

### 7. handleFileOpened symmetry with toggleEditMode *(existing #35)*

**User value:** File-open path is as robust as the toggle path — disable + null-guard + re-entrancy guard symmetric across both.

**Acceptance criteria:** Inherited from existing #35.

### 8. mountEditor rejection in toggleEditMode *(existing #36)*

**User value:** A failed `mountEditor` no longer leaves the toggle button enabled with a stale label.

**Acceptance criteria:** Inherited from existing #36.

### 9. Error-path hardening for toggle/file-open/bootstrap *(existing #37)*

**User value:** Rejection paths surface errors to the user instead of swallowing them silently.

**Acceptance criteria:** Inherited from existing #37.

### 10. bootstrap()'s showcase mount lacks .catch *(existing #31)*

**User value:** Eliminates the silent failure mode in `bootstrap()`'s showcase mount.

**Acceptance criteria:** Inherited from existing #31.

### 11. Brand: palette + typography + wordmark

**User value:** First frame after install shows Hashly's brand identity — paper/ink palette, Fraunces wordmark — not Vite defaults.

**Acceptance criteria:**
- [ ] Palette installed as CSS custom properties in `src/style.css`: `--paper #f0f1ec`, `--paper-2 #e6e8e0`, `--ink #14201b`, `--ink-2 #36443d`, `--muted #7c8479`, `--rule #d2d6cb`, `--accent #1e3a2f`, `--accent-2 #c9a24b`. Light-mode + dark-mode variants tied to `prefers-color-scheme`.
- [ ] Fraunces (`opsz 144`, weight 600, `SOFT 100`, tracking `-0.025em`), Schibsted Grotesk (400/500/600/700), JetBrains Mono wired. Loaded via Google Fonts in dev; bundled/self-hosted as `woff2` (Latin + common punctuation subsets) for production.
- [ ] Bundle delta from self-hosted fonts measured; if >~500KB, drop Schibsted Grotesk, fall back to system sans for UI body, keep Fraunces for wordmark.
- [ ] `#hashly` wordmark in titlebar/header: gold `#` in Fraunces 700, ink `hashly` in Fraunces 600, baseline-aligned. Styled `<span>` — no SVG.

**Notes:** Source of truth: `specs/v0.2-mvp-completion/brand/`. Pairs with slice 5.

### 12. Brand: MarkGeometric → app icon + favicon

**User value:** App icon in Dock and favicon in window/dev-server show the committed `MarkGeometric`, not Tauri's empty placeholder.

**Acceptance criteria:**
- [ ] `MarkGeometric` exported from `brand/project/marks.jsx` to a hand-optimized `src/brand/mark.svg` (`viewBox="0 0 100 100"`, geometry per the brand-sheet spec table: bar weight 11u, bar gap 9u, vertical slope −9°, vertical width 8u, corner radius 2.5u).
- [ ] App icon set generated via `cargo tauri icon` from a 1024×1024 source into `src-tauri/icons/`. Primary surface: gold (`#c9a24b`) background, ink (`#14201b`) glyph, both verticals in ink (no gold-on-gold accent).
- [ ] `tauri.conf.json` `"icon"` field points at the generated set (no longer `[]`).
- [ ] Favicon: 32×32 + 16×16 PNG plus SVG fallback, paper background, ink glyph, gold accent. Wired into `index.html`.
- [ ] Mark usage rules codified (do/don't recolour, don't rotate, min size 14px).

**Notes:** Depends on slice 11. Slice 16 depends on this slice.

### 13. Frontmatter recognition end-to-end

**User value:** A `.md` with leading YAML frontmatter renders the YAML as a metadata panel in reading view (not as a horizontal rule), shows it as an editable text region in edit view, and round-trips losslessly on save.

**Acceptance criteria:**
- [ ] Strict detection: byte offset 0 must be `---\n`; first subsequent line of exactly `---` (optional trailing whitespace, `\n`-terminated) closes the block; YAML between fences must parse cleanly.
- [ ] Any parse error → pass through to Milkdown unchanged. Never throws on user input.
- [ ] Reading view shows a key/value metadata panel above the rendered body (plain text styling acceptable).
- [ ] Edit view shows frontmatter as a fenced-code-style editable region; body in WYSIWYG.
- [ ] On save, frontmatter block re-emitted at byte offset 0 ahead of editor-serialized body. Doc opened → edited (body) → saved → re-opened produces frontmatter byte-equal to original.
- [ ] Frontmatter cases extend slice 1's fidelity corpus.
- [ ] `js-yaml` added as direct dependency, version pinned.

**Notes:** Depends on slices 1, 2.

### 14. File > New From Template

**User value:** PM picks **File > New From Template > PRD** (or Vision / Task) and lands in an unsaved edit-mode buffer with frontmatter pre-filled (`status: Draft`, `author: <macOS user>`, `date: <today>`); Cmd+S routes through Save As….

**Acceptance criteria:**
- [ ] Tauri menu API extended with **File > New From Template** submenu (PRD, Vision, Task entries).
- [ ] Each entry emits an event the frontend handles by loading + hydrating the template.
- [ ] Three baked-in `.md` templates at `src/templates/` — `prd.md`, `vision.md`, `task.md` — imported as static Vite raw-text assets.
- [ ] Template-new buffer opens in edit mode with dirty indicator on from frame zero.
- [ ] Frontmatter autopopulation: `date` filled with today (`YYYY-MM-DD`); `author` filled via Rust `get_current_user`, falls back to literal `Author` if lookup fails.
- [ ] Cmd+S on a path-less buffer routes through Save As…; cancelling the picker leaves buffer dirty + unsaved.
- [ ] Each template gets a frontend smoke test snapshotting its rendered structure.

**Notes:** Depends on slices 2, 13. Templates are static — not user-customizable in v0.2.

### 15. Tauri 2 capability ACL extension + pinning test

**User value:** ACL surface for v0.2's new dialogs is designed up-front and a pinning test breaks the build on regressions — avoiding v0.1's late-stage ACL retrofit (`20ef68a`).

**Acceptance criteria:**
- [ ] `src-tauri/capabilities/default.json` adds `dialog:allow-save` (Save As…) and `dialog:allow-ask` and/or `dialog:allow-message` (unsaved-on-close + save-failure). Exact names verified against `@tauri-apps/plugin-dialog` at wire-up.
- [ ] No new entry for `save_md_file` or `get_current_user` — they flow through `core:default`.
- [ ] No `@tauri-apps/plugin-fs` permissions added.
- [ ] `src-tauri/tests/capabilities.rs` extended to pin v0.2's ACL contents.
- [ ] At least one Rust integration test drives the dialog plugin through the actual ACL config (not bypassing it).

**Notes:** Load-bearing risk #2 in PRD § Risks. Pairs with whichever slice (2/3/14) lands the dialog first.

### 16. Package & ship — unsigned .dmg + Homebrew cask *(existing #12, body extended)*

**User value:** Anyone with a Mac can install Hashly: download the unsigned `.dmg` from the GitHub release, or `brew install --cask deanchanter/hashly/hashly`.

**Acceptance criteria:** Inherited from existing #12 (extended with v0.2 deltas — Homebrew cask, release pipeline, `bundle.active=true`, README install paths).

**Notes:** `bundle.active` flips to `true`; depends on slice 12 (icon set). Sign/notarize trigger: first SDD-tutorial mention, first non-circle install, or first Gatekeeper-friction report.
