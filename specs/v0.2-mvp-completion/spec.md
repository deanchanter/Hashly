# Hashly v0.2 — MVP Completion

**Status:** Draft
**Author:** deanchanter
**Date:** 2026-05-01

## Summary

Hashly v0.2 finishes what v0.1 promised, lands the SDD-native wedge as a walking skeleton, *and* installs the visual brand system. The deferred-MVP half: the five deferred v0.1 slices (Finder double-click, dirty + Cmd+S save, unsaved-on-close dialog, light/dark, `.dmg` GitHub release) plus the security/correctness hardening that becomes load-bearing once save round-trips text to disk. The SDD-wedge half: three baked-in spec templates (PRD, Vision, Task) reachable through *File > New From Template*, plus minimum-viable frontmatter recognition (parse leading YAML, render it as a metadata panel in reading view, autopopulate `date` + `author` on template-new). The brand half: a Hashly visual identity — palette, typography, the **refined geometric `#` mark** (committed; `MarkGeometric` from `brand/project/marks.jsx`), wordmark, app icon, favicon — derived from the design bundle in `specs/v0.2-mvp-completion/brand/`, drop-in compatible with the light/dark work from #9 and the `.dmg` packaging from #12. v0.2 also promotes editing to a first-class path — quick-fix editing of someone else's spec, *and* authoring a new spec from a template, are both primary scenarios now. The wedge and brand work layer on top of the deferred-MVP work within this same milestone; sequencing keeps the foundation solid before they land.

## Problem & motivation

v0.1 shipped partial. The reading-view path lands code-complete via File > Open, but the features that make Hashly behave like a real Mac app — Finder double-click, save, unsaved-on-close, dark mode, a downloadable `.dmg` — were all deferred. There is no live user base yet (no `.dmg` is published), so today the "pain" is structural rather than user-reported: the project cannot be installed, the editing path cannot round-trip changes back to disk, and the vision's distribution premise (SDD tutorials recommending Hashly) is impossible to execute against an incomplete artifact.

v0.2 exists to close that gap *and* to plant the SDD-native wedge flag in the same milestone. The wedge — spec templates plus frontmatter recognition — is what differentiates Hashly from a generic free WYSIWYG markdown editor and lines it up with the vision's distribution thesis (SDD tutorials). Doing both halves in one milestone is the deliberate call: the deferred-MVP slices and the wedge share so much technical surface (the file-open / template / save flows all touch the editor-wiring + frontmatter-aware-save path) that splitting them across two milestones would force the second milestone to retread the foundation work. The "build on sand" concern is mitigated by *sequencing inside* v0.2 — the deferred-MVP slices land first, wedge slices layer on top — not by deferring the wedge to v0.3.

## Users & primary use case

**Primary persona:** Same as v0.1 — a PM (or other non-engineer participating in SDD) working with `.md` SDD docs. Frequency: occasional, expected to grow with SDD adoption. v0.2 broadens the persona's mode of work from *reader-with-light-edits* to **reader-with-light-edits *and* author-from-template**, both as primary scenarios.

**Use case walkthroughs:**

*Quick-fix flow (inherited from v0.1, now first-class):* The PM receives a `spec.md` from an engineer or AI agent. They double-click it in Finder, the file opens in Hashly's reading view (with any frontmatter rendered as a metadata panel rather than as a horizontal rule), they read top-to-bottom. They spot a clarification that needs to land — a wrong owner, a misstated assumption, a typo in a heading. They toggle to edit mode, fix the line in WYSIWYG, hit Cmd+S; the dirty indicator clears. They close the window and hand the file back.

*Author-from-template flow (new in v0.2):* The PM has been asked to write a new spec — a PRD or task spec for a feature they own. They open Hashly, pick **File > New From Template > PRD**, and land in a new unsaved buffer in edit mode. The frontmatter is pre-filled with `status: Draft`, `author: <their system user>`, `date: <today>`, and the body is the PRD scaffold ready to fill in. They edit, hit Cmd+S, are prompted for a save location (because the buffer has no path yet), pick one, and the file is on disk.

The round-trip flows — disk → edit → save → disk for the quick-fix path, and template → edit → save → disk for the author path — are both load-bearing. v0.2 has to make both credible.

## Scope

### In scope — acceptance criteria

The five deferred v0.1 slices form the spine of v0.2. Each existing GitHub issue is the canonical source for the slice's acceptance criteria; the criteria below are the milestone-level "is v0.2 done" gates.

- [ ] **#5 Finder double-click** — opening a `.md` file via Finder double-click lands directly in the rendered reading view, equivalent to the File > Open path that already shipped.
- [ ] **#7 Dirty indicator + Cmd+S save** — any unsaved edit shows a visible dirty indicator; Cmd+S writes the file in place and clears the indicator on success. Save failure surfaces a blocking error dialog with a "Save As…" escape hatch (see *Edge cases* below); the dirty indicator stays sticky on failure. `save_md_file` is a custom Hashly Tauri command reached through the existing `core:default` IPC channel (no per-command ACL entry); path validation happens server-side in Rust via #44. `@tauri-apps/plugin-fs` is intentionally not used.
- [ ] **#8 Unsaved-changes-on-close dialog** — closing a window with unsaved edits triggers a standard *Save / Don't Save / Cancel* dialog.
- [ ] **#9 Light & dark mode** — both themes render correctly; the app strictly follows the OS theme. No in-app toggle, no settings UI.
- [ ] **#12 Package & ship** — a downloadable unsigned `.dmg` is published as a GitHub release, *and* a Homebrew cask is published in a `homebrew-hashly` (or equivalent) tap. Signing/notarization is intentionally deferred until there is user-base signal that the $99/yr Apple Developer ID is justified.

#### SDD-wedge — walking-skeleton acceptance criteria

The wedge slices are layered on top of the deferred-MVP slices within v0.2; sequencing puts them after #7 save lands so the author-from-template flow has a real save path to write into.

- [ ] **Spec templates — File > New From Template** — a *File > New From Template* menu exposes three baked-in templates: **PRD**, **Vision**, and **Task spec**, modelled on the structures already in `specs/` (parallel to what the feature-interviewer skill produces). Picking a template opens a new unsaved buffer in **edit mode** with frontmatter pre-filled (`status: Draft`, `author: <system user>`, `date: <today>`) and the template body below. Templates are static — baked into the app binary, not user-customizable in v0.2.
- [ ] **Frontmatter recognition** — a leading `---\n…\n---\n` block at byte offset 0 of the document is parsed as YAML frontmatter rather than rendered as a horizontal rule. **Reading view** shows a small key/value metadata panel above the rendered body. **Edit view** shows the same block as a fenced code-style region the user can edit as text — no structured form UI, no schema validation, no enum dropdowns. On save, the frontmatter block is re-emitted at the top of the file ahead of the editor-serialized body.
- [ ] **Frontmatter autopopulation on template-new** — `date` is filled with today's date in `YYYY-MM-DD`; `author` is filled with the current macOS system user (falls back to literal string `Author` if unavailable). No other autopopulation hooks in v0.2.
- [ ] **Frontmatter round-trips losslessly** — a doc opened, viewed, toggled edit/read, saved, and re-opened produces a frontmatter block byte-equal to the original (modulo any user edits inside the block). Verified as part of the Milkdown-fidelity gate task.

#### Brand & visual identity — acceptance criteria

The design bundle in [`brand/`](./brand/) is the source of truth. `Hashly Logo.html` is the focused brand sheet for the committed mark; `Hashly Logo - Explorations.html` preserves the eight mark explorations for reference but is not a v0.2 deliverable.

**Primary mark: `MarkGeometric` (refined).** Italic verticals at −9° slope drawn as trapezoidal paths (slightly narrower at the top), gold accent stem on the right vertical, ink on everything else. Formal mark spec from the brand sheet:

| Property | Value |
|---|---|
| Grid | 100 × 100u |
| Bar weight (horizontals) | 11u |
| Bar gap (between horizontals' inner edges) | 9u |
| Vertical slope | −9° |
| Vertical width | 8u |
| Corner radius | 2.5u |
| Clear space (around the mark) | ≥ 1× cap height |
| Minimum size | 14px |

The canonical SVG source lives in `brand/project/marks.jsx` as `MarkGeometric` and is exported into `src/brand/mark.svg` (and rasterized to PNG/`.icns`) as part of v0.2 delivery.

- [ ] **Palette installed as CSS custom properties** — `--paper: #f0f1ec`, `--paper-2: #e6e8e0`, `--ink: #14201b`, `--ink-2: #36443d`, `--muted: #7c8479`, `--rule: #d2d6cb`, `--accent: #1e3a2f` (deep forest), `--accent-2: #c9a24b` (muted gold). Light mode = paper background + ink text; dark mode = ink background + paper text. Forest and gold accents work in both modes. The palette resolves the v0.1 open question on theme behaviour mechanically — `prefers-color-scheme` flips the variable bindings.
- [ ] **Typography wired** — Fraunces (wordmark, `opsz 144`, weight 600, `SOFT 100`, tracking `-0.025em`), Schibsted Grotesk (UI/body, weights 400/500/600/700), JetBrains Mono (mono/code/annotations). Loaded via Google Fonts at runtime in dev; bundled or self-hosted for the production build to satisfy the offline constraint.
- [ ] **Wordmark `#hashly`** — gold `#` prefix in Fraunces weight 700, ink `hashly` in Fraunces weight 600, baseline-aligned. Used in the app titlebar / header area and in any future external context (README badge, GitHub social card).
- [ ] **App icon (`.icns`)** — `MarkGeometric` rendered into the macOS app icon set (16×16 through 1024×1024 in 1× and 2×). Replaces `tauri.conf.json`'s empty `"icon": []`. Surface treatment per the brand sheet:
  - **Primary icon:** gold (`#c9a24b`) background, ink (`#14201b`) glyph, *no separate accent stem* — on a gold background, the gold accent would disappear, so both verticals render in ink. (This matches `app.jsx`'s `<MarkGeometric color={INK} accent={INK}/>` on a `bg={GOLD}` icon.)
  - Secondary variants documented but not wired into `.icns`: forest-bg with paper glyph + gold accent; paper-bg with ink glyph + gold accent.
- [ ] **Favicon** — `MarkGeometric` rendered as 32×32 + 16×16 PNG (and an SVG fallback for the dev server), paper background, ink glyph, gold accent. Wired into `index.html`.
- [ ] **Mark usage rules enforced** — codified as both convention and lint:
  - **Do** render the mark on paper, ink, forest, or gold backgrounds with the colour pairings specified above.
  - **Don't** recolour the mark with off-palette colours.
  - **Don't** rotate the mark.
  - **Don't** render below 14px (the minimum size from the brand sheet).
- [ ] **First-run paint shows brand identity, not unstyled defaults** — the very first frame after `cargo tauri build` install + launch shows the brand palette, Fraunces wordmark, and the `MarkGeometric` icon, not Vite's default look. Brand should feel like a Hashly app from frame zero.

#### Hardening that ships *with* the deferred slices

These are not new features — they are correctness/security fixes that become load-bearing the moment save lands or the editing path is first-class. Treated as part of v0.2's "must-land" set rather than triaged out:

- **#44 `read_md_file` path traversal hardening** (canonicalize + prefix-check) — gated on #7; shipping save without this is a real vulnerability.
- **#33 `getCurrentEditor()` exposes write-capable handle bypassing read-only** — same gate; without it, "read-only" is not enforced once save exists.
- **#34 lossy round-trip test gap for fragile markdown through edit↔read toggle** — becomes critical the moment save round-trips text to disk; pairs with the Milkdown serializer fidelity gate task (see *Risks*).
- **#43 Sanitize `document.title` against Unicode RTL / zero-width chars in opened filenames** — filename now appears in the window title; small fix, real attack surface.
- **#29 dark-mode portion of toggle-button polish** — `#9` puts dark mode in scope, so the dark-mode chunk of #29 is in; the i18n + reduced-motion portions slip.

#### Should-land — real bugs surfaced by first-class editing

These were filed as #6 follow-ups; with editing promoted to first-class, they stop being polish and start being credibility issues:

- **#27** Tab key inside edit-mode editor may indent / be captured.
- **#35** `handleFileOpened` symmetry with `toggleEditMode` (disable + null + re-entrancy guard).
- **#36** `mountEditor` rejection in `toggleEditMode` leaves enabled button + stale label.
- **#37** Error-path hardening for toggle/file-open/bootstrap rejection paths.
- **#31** `bootstrap()`'s showcase mount lacks `.catch` — silent failure mode.

### Out of scope

Triaged to v0.3 unless they happen to be cheap when touching adjacent code:

- **#26** Differentiate error UI for non-UTF-8 vs other invoke failures.
- **#28** Toggle button hit target / scroll preservation / layout flash polish.
- **#30** HMR / re-bootstrap can duplicate toggle button (dev-only).
- **#32** Tighten Rust `frontend.rs` pin for default-read-only mode.
- **#38** Disabled toggle visual affordance + mode-label semantics.
- **#39** Toggle button positioning robustness (scrollbar overlap, z-index).
- **#40** Synchronous click→feedback timing pin.
- **#41** `aria-readonly` cross-state symmetry test pin.

SDD-wedge non-goals (slip to v0.3+):

- User-defined or downloadable templates.
- Structured frontmatter form / schema validation / enum pickers.
- Frontmatter folding / collapse in the editor.
- Template types beyond PRD / Vision / Task (no ADR, RFC, meeting-notes, etc., in v0.2).
- "Recent templates," favourites, or any template-management UI.
- Frontmatter-aware features beyond render-and-autopopulate (no metadata-driven sorting, no cross-doc linking, no graph).

Brand non-goals (slip to v0.3+):

- Animated marks (the `MarkCaret` blink animation from `marks.jsx` is decorative; if `MarkCaret` is selected as the primary mark, the static-frame variant is what ships in v0.2).
- Multiple-mark variants for different surfaces (one mark, used everywhere).
- Brand-system documentation as a public-facing site or readme — `brand/` stays internal-reference for v0.2.
- A standalone `Hashly` typeface or custom-drawn glyph beyond what Fraunces provides.
- Marketing/landing-page assets (no website work in v0.2).

Inherited from v0.1's out-of-scope list (still out for v0.2):

- Multi-file or folder browsing, tabs, find and replace, image paste, export to PDF/HTML, drag-drop file open (including drop onto Dock), recent-files list, settings/preferences UI, spellcheck.

### Constraints

- **Platform:** Mac only (inherited from v0.1).
- **Native app:** Tauri (system WebView), not Electron (inherited).
- **Offline:** No network dependency, no telemetry (inherited).
- **Single `.md` file** at a time (inherited).
- **Light and dark modes:** both required, strictly follows OS, no toggle, no settings UI.
- **Distribution:** Unsigned `.dmg` *and* Homebrew cask — no Apple Developer ID purchase in v0.2.

## User experience

### Flow — quick-fix path (existing-doc round-trip)

Inherits v0.1's reading-first sequence and adds the save round-trip:

1. **Entry:** User double-clicks a `.md` file in Finder (#5 new) or opens Hashly and uses File > Open (already shipped). Drag-onto-Dock still not supported.
2. **Land:** App opens directly into the rendered reading view of that file. Window title shows the (sanitized) filename. If the file has leading YAML frontmatter, it renders as a metadata panel above the body — not as a horizontal rule.
3. **Read:** User scrolls, follows links, etc. Theme tracks the OS automatically.
4. **(Optional) Edit:** User toggles to WYSIWYG-edit view, makes a change. The frontmatter (if any) appears as an editable fenced-style region; the body is WYSIWYG. Dirty indicator appears.
5. **Save:** User hits Cmd+S. The frontmatter block is re-emitted at the top of the file ahead of the serialized body. On success, the dirty indicator clears. On failure, a blocking error dialog appears (see *Edge cases*).
6. **Close:** User closes the window. If there are unsaved edits, the standard *Save / Don't Save / Cancel* dialog (#8) intercepts.

### Flow — author-from-template path (new in v0.2)

1. **Entry:** User opens Hashly (or already has it open) and picks **File > New From Template**, then a template (PRD / Vision / Task) from the submenu.
2. **Land:** A new window (or current window if empty) opens directly in **edit mode** with the template scaffolded: a frontmatter block at the top with `status: Draft`, `author: <system user>`, `date: <today>`; the template body below.
3. **Edit:** User fills in the template — heading by heading, frontmatter fields editable as text, body in WYSIWYG. Dirty indicator is on from the start (the buffer is unsaved).
4. **Save:** User hits Cmd+S. Because the buffer has no path yet, a Save As… picker appears (Tauri dialog plugin). User picks a destination, the file is written, the dirty indicator clears, the window title updates to the new filename.
5. **Subsequent edits:** Same as the quick-fix flow from step 4 onward.

### Edge cases & failure states

- **Save failure (disk full, permission denied, target file moved/deleted on disk while open):** Blocking error dialog. Body identifies the file by name and surfaces the underlying reason in plain language ("the folder no longer exists" / "you don't have permission to write here" / "the disk is full"). Dialog offers `Save As…` and `Cancel`. The dirty indicator stays sticky regardless of dialog outcome, so #8 still catches the unsaved state on close. *No disk-watcher is added in v0.2 — recovery is reactive, not proactive.*
- **First save of a template-new buffer:** there's no path yet, so Cmd+S routes through the Save As… picker. If the user cancels the picker, the buffer stays dirty and unsaved.
- **Malformed YAML frontmatter** (unclosed block, parse error, non-string values): pass the leading `---…---` block through to Milkdown unchanged so it renders as a horizontal rule + raw text — same as today's behaviour. *Don't* try to half-parse it. Treat the failure as "this isn't really frontmatter."
- **Frontmatter-only file** (`---\nfoo: bar\n---\n` with no body): metadata panel renders, body area is empty. Edit mode shows the frontmatter region only, no body content.
- **Multiple `---` blocks in a doc:** only the leading one (at byte offset 0) is treated as frontmatter; subsequent `---` lines stay horizontal rules.
- **`---` not at byte offset 0** (preceded by blank lines, BOM, or any other content): not treated as frontmatter — Milkdown renders the `---` as a horizontal rule. The detection rule is strict on purpose: ambiguous detection is worse than no detection.
- **Unsaved edits on close:** Standard *Save / Don't Save / Cancel* dialog (#8). Inherited semantics from v0.1's PRD.
- **OS theme changes mid-session:** App re-themes live (driven by `prefers-color-scheme` media query). No restart required.
- **Binary / non-UTF-8 `.md`:** Friendly "can't open this file" message (already shipped via #10; #26's differentiation polish is out of scope).
- **Malformed markdown:** Render best-effort (already shipped via #11).
- **Huge files (10MB+):** Still a documented known limitation, not a v0.2 target.
- **Finder double-click on an unsigned `.dmg` install (first run):** First launch will show Gatekeeper's "cannot check for malicious software" warning; user has to right-click → Open. Brew-cask installs auto-strip the quarantine flag and avoid the warning. This is documented in the README, not papered over in-app.

## Technical design

### Surface area

- **Frontend (TS):** save handler invoked on Cmd+S; dirty-state tracking derived from Milkdown editor changes; close-requested handler hooks the unsaved-on-close dialog; `prefers-color-scheme` listener wires Milkdown's theme switch. **New for SDD wedge:** a frontmatter pre-processor that strips the leading `---…---` block before passing the body to Milkdown and re-emits it on save; a metadata-panel component that renders parsed frontmatter in reading view; a template-loader that hydrates the editor from a baked-in template asset and autopopulates `date`/`author`.
- **Tauri Rust core:** new `save_md_file(path, contents)` command with path canonicalization + prefix-check baked in (#44); macOS file-open event handler for Finder double-click (#5); close-requested event for the unsaved-prompt round-trip with the frontend. **New for SDD wedge:** a `get_current_user` command (or equivalent) returning the macOS system user for `author` autopopulation, falling back to the literal `Author` if the lookup fails.
- **Templates (`src/templates/`):** three baked-in `.md` files — `prd.md`, `vision.md`, `task.md` — modelled on the structures already in `specs/` and on the feature-interviewer's reference templates. Imported as static Vite assets (raw text); shipped inside the bundle, no network fetch.
- **Frontmatter parser:** [`js-yaml`](https://github.com/nodeca/js-yaml) (small, well-tested). One new direct dependency. Detection rule: byte offset 0 must be `---\n`; the first subsequent line consisting of exactly `---` (optional trailing whitespace, `\n`-terminated) closes the block; the contents in between must parse as YAML to be treated as frontmatter — any parse error means "render as horizontal rule + text" (i.e., pass through). The strict rule is the safety net against false positives.
- **Menu wiring:** Tauri menu API extended with a *File > New From Template* submenu (PRD / Vision / Task entries), each emitting an event the frontend handles to load + hydrate the corresponding template.
- **Brand assets (`src/style.css`, `src/brand/`, `src-tauri/icons/`):** the palette lands as CSS custom properties in `src/style.css` (light + dark variants tied to `prefers-color-scheme`); the wordmark renders as a styled `<span>` (no SVG needed — it's typography). Fonts load via Google Fonts in dev and are self-hosted in the production bundle to satisfy the offline constraint. The committed `MarkGeometric` is exported from `brand/project/marks.jsx` to a hand-optimized SVG at `src/brand/mark.svg` (with a single `viewBox="0 0 100 100"` and the bar/path geometry from the brand sheet's spec table). Rasterized to PNG/`.icns` via standard Tauri tooling — `cargo tauri icon <source.png>` from a 1024×1024 source produces the full size set into `src-tauri/icons/`.
- **Tauri 2 capability ACL (`src-tauri/capabilities/default.json`):** v0.1's existing ACL (`core:default` + `dialog:default`) already covers custom Hashly IPC commands and the `open` dialog. v0.2 deltas are dialog-plugin permissions only:
  - Add `dialog:allow-save` (the Save As… picker).
  - Add `dialog:allow-ask` and/or `dialog:allow-message` (unsaved-on-close confirm + save-failure error dialogs — exact permission name verified against `@tauri-apps/plugin-dialog` at wire-up time).
  - **No** new entry for `save_md_file` — custom commands flow through `core:default`'s IPC channel; path validation is server-side via #44.
  - **No** `@tauri-apps/plugin-fs` permissions — granting `fs:write-all` would defeat #44's path-traversal hardening.
  - Finder double-click (`RunEvent::Opened`) does not go through the ACL system; no new entry needed there.
  - `src-tauri/tests/capabilities.rs` extends to pin v0.2's ACL contents the same way v0.1 pins the current ones — a regression in capability scope fails the build.
- **Build / distribution:** `tauri.conf.json` flips `bundle.active` to `true` and configures the `.dmg` target. New `homebrew-hashly` tap (or equivalent) hosting the cask formula; release pipeline updates the cask SHA on each GitHub release.
- **Dependencies (likely new):** Tauri's dialog plugin (Save As / unsaved-on-close prompts). Possibly the `single-instance` plugin if Finder double-clicks need to route to an existing window.

### Data model

_N/A — no new persistence. The `.md` file on disk remains the only state. Theme follows the OS, so it is not stored. Window size/position, last-opened file, recent files: still not persisted in v0.2._

### Decisions & open questions

**Decisions made:**

- **Editing is first-class.** Reading is still the dominant time-share, but the round-trip from disk → edit → save → disk is now a load-bearing flow that v0.2 must make credible.
- **Save failure → blocking error dialog with a `Save As…` escape hatch.** Reasoning: the persona is non-technical and the worst failure mode is silently losing the fix; inline banners are right for editors with autosave or version history, neither of which Hashly has.
- **Theme strictly follows the OS.** No in-app toggle, no settings UI. This locks in v0.1's "probably follows OS" open question.
- **Distribution: unsigned `.dmg` + Homebrew cask.** Signing/notarization is deferred until there is user-base signal that justifies the $99/yr Apple Developer ID. Engineers can `brew install --cask` cleanly; non-eng users will see Gatekeeper friction on the `.dmg` path and need the right-click → Open documentation.
- **The hardening set (#44, #33, #34, #43, #29-dark) ships with v0.2 — not as polish, but because each is load-bearing for one of the in-scope slices.**
- **Tauri 2 capability ACL is designed up-front, not retrofitted.** v0.1 had to add an ACL fix in the final review (`20ef68a` for File > Open) — that pattern doesn't scale across save + dialog + file-open. v0.2 designs the ACL surface alongside the Rust commands and tests it.
- **Custom Hashly commands over the generic `fs` plugin.** `save_md_file` is registered via `invoke_handler` and reached through `core:default`'s IPC channel — no per-command ACL entry is needed (this matches v0.1's `read_md_file` pattern, documented in `default.json`). Path validation happens server-side via #44. Granting `@tauri-apps/plugin-fs` permissions would expand the WebView's filesystem reach unnecessarily and defeat #44's hardening; the plugin is explicitly avoided.
- **Native Tauri dialog plugin for both unsaved-on-close and save-failure dialogs** (no custom HTML modals). Reasoning: unsaved-on-close is a canonical Mac platform convention (TextEdit, Pages — every Mac app uses NSAlert), and using HTML modals to intercept a system close-request inside the WebView feels off-platform. Save-failure dialog goes the same route for behavioural consistency. The three-option *Save / Don't Save / Cancel* shape may need `dialog:message` with custom buttons rather than `dialog:ask`'s yes/no — verified at wire-up time.
- **Homebrew tap is `deanchanter/homebrew-hashly`**, resolving to `brew install --cask deanchanter/hashly/hashly` (or `brew tap deanchanter/hashly && brew install --cask hashly`). Release pipeline: GitHub Actions on release-tag push, `macos-14` runner runs `cargo tauri build`, uploads the `.dmg` to the GH release, computes SHA256, and bumps the cask formula in the tap repo (via `dawidd6/action-homebrew-bump-formula` or hand-rolled `gh release upload` + `sed` + `gh pr create`).
- **Signing + notarization revisit trigger.** Revisit on the first of any of three signals: (1) **distribution** — first SDD tutorial / blog post / video mentions Hashly to a non-trivial audience; (2) **usage** — first confirmed install by someone outside the builder's direct circle (GitHub issue, Discord mention, etc.); (3) **friction** — first filed report saying "Gatekeeper blocked me, I gave up / lost time." The friction signal flips the decision unambiguously: it is anti-conversion data on the wedge audience.
- **SDD wedge ships in v0.2 alongside the deferred-MVP slices, not v0.3.** The wedge slices land *after* the deferred-MVP slices inside v0.2 sequencing — the build-on-sand concern is mitigated by ordering, not by milestone separation. Splitting the work across v0.2 and v0.3 would force v0.3 to retread the editor-wiring + frontmatter-aware-save surface; bundling is cheaper.
- **Frontmatter detection is strict and shape-based, not heuristic.** The rule is "byte offset 0 must be `---\n`, and the YAML between the fences must parse cleanly." Anything else is passed through to Milkdown unchanged. Strict-and-narrow is correct here: a false-positive on detection (treating a horizontal rule as frontmatter) would silently change how a doc renders, which is worse than not detecting an exotic frontmatter shape.
- **Brand identity ships in v0.2, not later.** The design bundle in `brand/` resolves the v0.1 *theme behaviour* open question mechanically (palette + `prefers-color-scheme` does the work) and resolves the bundle-icon open question by giving v0.2 a real source mark. Pushing brand to v0.3 would mean shipping a `.dmg` with a placeholder icon, which signals "unfinished" exactly when the project is trying to look credible to its first downloaders.

**Open questions:**

- Milkdown serializer fidelity for the CommonMark + GFM features Hashly already renders is **unverified**. v0.2 needs a "verify round-trip on a representative corpus before scoping save" gate task. This is the riskiest unknown for v0.2.
- Exact Homebrew tap name and release-pipeline shape (separate `homebrew-hashly` repo vs. inline tap?) is not yet decided.
- Whether the close-requested + unsaved-prompt round-trip goes through Tauri's dialog plugin or a custom HTML modal (consistency with the save-failure dialog argues for one or the other).

## Success metrics

v0.2 keeps v0.1's "ship it and see" stance — no usage metric is tracked yet. The vision-level signals (SDD tutorial mentions, etc.) belong to v0.3+.

| Signal | Target | How measured |
|---|---|---|
| GitHub release published with downloadable unsigned `.dmg` | Shipped | Manual / GitHub releases page |
| Homebrew cask installable via `brew install --cask hashly` (or equivalent name) | Shipped | Manual install on a clean Mac |

## Risks & mitigations

- **Milkdown serializer is not lossless on the CommonMark + GFM corpus Hashly already renders.** — Mitigation: gate the save scoping behind a Vitest-based round-trip verification task. Oracle is **AST-equality**, not byte-equality (markdown allows multiple syntactic forms for the same semantic, so byte-equality is too strict and produces noise). Corpus combines (a) the existing CommonMark fixture used by `frontend.rs`, (b) GFM-specific fixtures for tables / task lists / strikethrough — exactly what `@milkdown/preset-gfm@7.20.0` covers, and (c) a "fragile markdown" corpus targeting known prosemirror/milkdown serializer pitfalls: list-marker normalization (`*` ↔ `-`), code-fence style (``` ↔ `~~~`), setext → ATX heading collapse, reference-style → inline link collapse, hard-break (`  ` ↔ `\`), emphasis style (`*` ↔ `_`), table-cell padding/alignment. Output is a list of preserved-vs-lossy forms; lossy ones get a per-case decision before #7 is merged: fix upstream, flag-out, or accept as a documented v0.2 known-limitation. This is one of the two load-bearing technical risks for v0.2.
- **Tauri 2 capability ACL misconfiguration silently blocks dialogs (under-grant) or expands WebView filesystem reach (over-grant).** — Mitigation: design the ACL surface alongside the Rust commands rather than as a bundle-time afterthought (v0.1's `20ef68a` was caught only in final review). For v0.2 the ACL deltas are narrow — `dialog:allow-save` and `dialog:allow-ask`/`dialog:allow-message` only; no `fs` plugin entries; `save_md_file` and `get_current_user` flow through `core:default` like `read_md_file`. Extend `tests/capabilities.rs` to pin v0.2's ACL contents so a regression breaks the build, and add at least one Rust integration test that drives the dialog plugin through the actual ACL config (not bypassing it). This is the second load-bearing technical risk for v0.2.
- **Frontmatter strip / re-emit corrupts the document boundary.** A too-permissive strip rule could eat content; a too-strict one could mis-classify a standalone horizontal-rule line as frontmatter; an off-by-one re-emit could drop a blank line or duplicate the closing `---`. Mitigation: the strict detection rule (byte offset 0, `---\n`-bounded, YAML-must-parse) is the first line of defence; the round-trip verification corpus (Milkdown-fidelity gate task) is extended with frontmatter cases — including no-frontmatter, valid frontmatter, malformed frontmatter, frontmatter-only, and `---` not at offset 0 — so a regression in strip/re-emit fails the AST-equality check.
- **YAML parsing is a new dependency surface.** Mitigation: use `js-yaml` (small, well-vetted, popular); don't roll a parser. Treat any parse error as "this isn't really frontmatter" → pass through to Milkdown unchanged; never throw on user input. Pin the dependency version explicitly.
- **Templates drift from the structures they're modelled on** (the feature-interviewer reference templates, the existing `specs/` files). Mitigation: each template gets a frontend smoke test that snapshots its rendered structure, so a refactor that accidentally breaks a template (e.g., by changing the heading scaffold) fails the build. Treat templates as code, not just content.
- **Brand identity reads as "AI-generated" or "Anthropic-adjacent."** The chat transcript already caught this once — the original terracotta/cream palette was rejected for being too close to Anthropic's. Mitigation: the resolved palette (deep forest + muted gold on bone white) is intentionally distinct, but vigilance has to continue when the mark is chosen and refined. Avoid the obvious AI-tool defaults (gradient blobs, geometric-but-generic, "bot-eye" marks). If the chosen mark starts feeling generic during refinement, swap to a more idiosyncratic option from the eight rather than polish into safety.
- **Self-hosted fonts inflate bundle size or violate the offline constraint silently.** Mitigation: download Fraunces, Schibsted Grotesk, and JetBrains Mono as `woff2` subsets covering Latin + common punctuation only; check the resulting bundle delta before committing. If the delta is more than ~500KB, drop Schibsted Grotesk and fall back to system sans (`-apple-system, system-ui`) for UI body, keeping Fraunces only for the wordmark.
- **Gatekeeper friction on the unsigned `.dmg` path bounces non-eng PMs — exactly the wedge audience.** — Mitigation: lead with the Homebrew cask in the README install instructions; keep the `.dmg` path documented but secondary; revisit signing the moment there is real install signal.
- **Finder double-click integration on Tauri 2 turns out to be more painful than expected** (file-open events on macOS are a known sharp corner). — Mitigation: time-box; if the integration becomes a quagmire, ship #5 in a v0.2.x point release rather than block the rest of the milestone.
- **Scope creep from the ~17 follow-up issues.** — Mitigation: the *In scope* / *Out of scope* split above is the firewall; new issues filed during v0.2 default to v0.3 unless they meet the same load-bearing test.
- **Solo-build motivation loss across a hardening-heavy milestone.** — Manage as it comes; same posture as v0.1.

## Alternatives considered

- **v0.2 = deferred-MVP only; SDD wedge slips to v0.3** (the original framing of this PRD). Rejected — the wedge and the deferred-MVP work share too much technical surface (file-open, save, frontmatter-aware persistence, template-new flow) to split economically across two milestones, and the build-on-sand concern is mitigated by sequencing inside v0.2 (deferred-MVP first, wedge layered on top) rather than by deferral.
- **v0.2 = SDD wedge only; deferred-MVP slips further.** Rejected — without save, there is no author-from-template flow that can land on disk; the wedge depends on the deferred-MVP slices being in place.
- **Larger SDD wedge (template gallery, schema-validated frontmatter, structured form UI, ADR + RFC + meeting-notes templates, frontmatter folding).** Rejected for v0.2 — the walking skeleton is what lets the wedge ship at all alongside the MVP-completion work; polish belongs to v0.3+.
- **Ship `.dmg` with a placeholder icon and defer brand identity to v0.3.** Rejected — the `.dmg` is the project's first credibility surface for a stranger; landing it without an identity signals "unfinished" to exactly the audience the vision targets, and the brand work has already been done in the design bundle.
- **Other mark candidates (Stamp, Ribbon, Block, Page, Serif, Caret, Sketch).** Rejected when the user committed to `MarkGeometric`. Preserved at `brand/project/Hashly Logo - Explorations.html` for reference but not part of v0.2. Notably rejected: `MarkStamp` (filter degrades at small sizes), `MarkCaret` (animation can't ride along to a static `.icns`), `MarkPage` (too complex at 16px).
- **v0.2 = signed + notarized `.dmg` from day one** ($99/yr Apple Developer ID). Rejected for v0.2 — the vision is "free forever, no monetization," there is no usage signal yet, and Homebrew cask gives a clean install path for the engineer audience without spending the $99. Revisit once non-builder installs start happening.
- **v0.2 = Mac App Store distribution.** Rejected — requires signing + sandboxing + App Review; weeks of work; fights the "quiet drop" stance from v0.1 and the vision.
- **Keep grinding the v0.1 backlog without a milestone label.** Rejected — a named v0.2 with an explicit "complete MVP + plant the wedge flag" framing is what makes "the MVP is done and Hashly is positioned for SDD-tutorial pitches" a defensible claim, both for the builder's own sense of closure and for distribution.
- **Skip directly to v0.3 (web build) and accept that the Mac MVP stays partial.** Rejected — the web build's value depends on the Mac MVP being a credible reference implementation, and "save doesn't work, no templates" is not credible.

## Rollout

**Urgency / timing:** "When it's done." No timebox. Same posture as v0.1.

**Rollout mechanism:** GitHub release with an unsigned `.dmg`, plus a Homebrew cask published to a `homebrew-hashly` (or equivalent) tap. Quiet drop — no announcement, no Mac App Store, no signed build for v0.2.

**Stakeholders to inform:** None. Solo build, quiet drop.

## Open questions

Most of v0.1's open questions resolved during scoping (see *Decisions* above). What remains:

- **Milkdown serializer fidelity in practice.** The verification task is scoped (corpus + AST-equality oracle defined, frontmatter cases included) but unrun. Some lossy forms will likely surface; their per-case dispositions (fix / flag-out / accept) are decided when the verification produces its report, not in this PRD.
- **Exact `@tauri-apps/plugin-dialog` permission names** for the three-option *Save / Don't Save / Cancel* prompt — Tauri 2's permission naming has shifted between minor versions; the resolved permissions are confirmed at wire-up time and pinned into `tests/capabilities.rs`.
- **Bundle icon assets.** `tauri.conf.json` currently has `"icon": []`; flipping `bundle.active` to `true` for #12 requires a populated `.icns` icon set. Out of band from v0.2's feature work; flagged so it doesn't surprise the bundle-config slice.
- **Final shape of the three template scaffolds.** The structures from `specs/hashly-vision.md`, `specs/v0.1-wysiwyg-editor/spec.md`, and the feature-interviewer's PRD/Vision/Task templates are the obvious starting points, but the exact heading set baked into v0.2's templates is a follow-up decision when the slice gets built. Captured as part of the template-loader task, not this PRD.
- **Should the metadata panel in reading view be visually styled as part of v0.2, or render as plain key/value text?** Walking-skeleton answer is plain text; if dark-mode + light-mode work surfaces a clean styling pattern that costs nothing extra, panel styling can ride along. Otherwise: ship plain.
- **Mark refinement deltas during implementation.** The committed `MarkGeometric` is a refined version (italic verticals as trapezoidal paths instead of skewed rects, bar weight 11u, slope −9°). Minor tuning during SVG export — sub-pixel adjustments for crisp rendering at 16/32px, hinting decisions for the rasterized `.icns` — is expected and stays inside the brand-asset slice rather than re-opening the mark choice.

## References

- [Hashly Vision](../hashly-vision.md) — parent doc; v0.2 is phase two.
- [Hashly v0.1 — WYSIWYG Markdown Reader](../v0.1-wysiwyg-editor/spec.md) — predecessor PRD; v0.2 inherits its persona, constraints, and out-of-scope list.
- [`brand/`](./brand/) — design-bundle handoff (README, chat transcript, HTML/JSX prototypes). `Hashly Logo.html` is the focused brand sheet for the committed `MarkGeometric`; `Hashly Logo - Explorations.html` preserves the eight original mark explorations. Source of truth for palette, typography, wordmark, mark geometry, and usage rules.
- Milkdown — chosen WYSIWYG markdown editor library; v0.2's load-bearing dependency for save round-trip fidelity.
- Tauri — chosen native-app framework (Rust + system WebView).
- `js-yaml` — frontmatter parser for v0.2's wedge slice.
- Homebrew Cask documentation — distribution path for v0.2's unsigned `.dmg`.
- Fraunces, Schibsted Grotesk, JetBrains Mono (Google Fonts) — typography stack.

---

_Generated via feature-interviewer skill on 2026-05-01 (level: feature)_
