# Tasks: Hashly v0.2 — MVP Completion

**Shipped on 2026-05-02** (slices 1–15; slice 16 / #12 .dmg packaging deferred to v0.2.x point release per user.)

Source: [spec.md](./spec.md)

Sequencing per PRD: deferred-MVP slices first (1–10), wedge layered on top (13–14), brand alongside (11–12), ACL hardening (15) pairs with whichever dialog slice lands first, packaging (16) closes the milestone.

- [x] 1. [Milkdown round-trip fidelity gate](https://github.com/deanchanter/Hashly/issues/45) — shipped via PR #51 (merged into milestone branch).
- [x] 2. [Save in place via Cmd+S](https://github.com/deanchanter/Hashly/issues/7) — shipped (commits b138233 + d19827b + 15211ae). Bundles #44 (4f96072), #33 (15211ae mode guard), #34 (subsumed by slice 1 fidelity report + new disk-layer round-trip Rust test). Save-failure blocking-error dialog deferred to a follow-up paired with #50's `dialog:allow-message` (filed as #56).
- [x] 3. [Unsaved-changes-on-close dialog](https://github.com/deanchanter/Hashly/issues/8) — shipped (a271cb8). 3-button custom HTML modal (Tauri 2 plugin-dialog only natively supports 2-button confirms). Modal a11y polish filed as follow-up #66.
- [x] 4. [Finder double-click opens .md](https://github.com/deanchanter/Hashly/issues/5) — shipped (f3bdd84) + #43 filename sanitization (25b0806). Runtime smoke (actual Finder→.app double-click) gated on slice 16 / #12 packaging — `bundle.fileAssociations` configured, `RunEvent::Opened` handler wired, frontend listener routes through `read_md_file`.
- [x] 5. [Light & dark mode follows OS](https://github.com/deanchanter/Hashly/issues/9) — shipped mechanically via slice 11's palette inversion (`@media (prefers-color-scheme: dark)` re-binds the variables; no JS toggle). Dark-mode chunk of #29 included. i18n + reduced-motion portions of #29 slip to v0.3.
- [x] 6. [Tab key inside edit-mode editor](https://github.com/deanchanter/Hashly/issues/27) — shipped (79c799a). Tab kept as ProseMirror's natural list-indent; Escape blurs the editor + focuses the toggle as the explicit keyboard escape.
- [x] 7. [handleFileOpened symmetry with toggleEditMode](https://github.com/deanchanter/Hashly/issues/35) — shipped (aaa102f, bundled with 8/9/10).
- [x] 8. [mountEditor rejection in toggleEditMode](https://github.com/deanchanter/Hashly/issues/36) — shipped (aaa102f).
- [x] 9. [Error-path hardening for toggle/file-open/bootstrap](https://github.com/deanchanter/Hashly/issues/37) — shipped (aaa102f).
- [x] 10. [bootstrap()'s showcase mount lacks .catch](https://github.com/deanchanter/Hashly/issues/31) — shipped (aaa102f).
- [x] 11. [Brand: palette + typography + wordmark](https://github.com/deanchanter/Hashly/issues/46) — shipped (32f62f9). Self-hosted woff2 loading + bundle-delta measurement deferred to follow-up #67 (system fallbacks render today).
- [x] 12. [Brand: MarkGeometric → app icon + favicon](https://github.com/deanchanter/Hashly/issues/47) — shipped (8fca9ea). SVGs in `src/brand/`, favicon wired. PNG rasterization + `.icns` generation + `tauri.conf.json icon` wiring deferred to follow-up #68 (rasterization tooling not present in CI).
- [x] 13. [Frontmatter recognition end-to-end](https://github.com/deanchanter/Hashly/issues/48) — shipped (2764096). Read-mode panel + byte-equal round-trip via raw-block preservation. Edit-mode fenced-code editing deferred to follow-up #69.
- [x] 14. [File > New From Template](https://github.com/deanchanter/Hashly/issues/49) — shipped (4378b00). PRD / Vision / Task baked-in templates, autopopulation, Save-As routing.
- [x] 15. [Tauri 2 capability ACL extension + pinning test](https://github.com/deanchanter/Hashly/issues/50) — shipped (bb2c587). Wire-up discovery: `dialog:default` already covers v0.2 needs; slice's deliverable is the audit trail (4 new pinning tests).
- [ ] 16. [Package & ship — unsigned .dmg + Homebrew cask](https://github.com/deanchanter/Hashly/issues/12) — **deferred** out of milestone PR per user. Ships in a v0.2.x point release after this milestone PR merges.

---

### 1. Milkdown round-trip fidelity gate

**User value:** Before save (#7) lands, we know which markdown shapes survive edit↔serialize losslessly and which don't — so #7 ships with a known disposition (fix / flag-out / accept-as-known-limitation) for every lossy form rather than discovering loss in production.

**Acceptance criteria:**
- [x] Vitest harness drives a corpus through Milkdown's parse → edit → serialize cycle and asserts AST-equality (not byte-equality) against the source.
- [x] Corpus covers (a) the existing CommonMark fixture used by `frontend.rs`, (b) GFM features from `@milkdown/preset-gfm@7.20.0` (tables, task lists, strikethrough), (c) fragile-markdown forms (list-marker normalization `*`↔`-`, code-fence style ` ``` `↔`~~~`, setext→ATX heading collapse, reference→inline link collapse, hard-break `  `↔`\`, emphasis style `*`↔`_`, table-cell padding/alignment), (d) frontmatter cases (no-frontmatter, valid, malformed, frontmatter-only, `---` not at offset 0).
- [x] Output is a written report listing each lossy form with a per-case disposition: fix upstream, flag-out, or accept as documented v0.2 known-limitation.
- [x] #7 (Save in place) is gated on this report being committed.

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
