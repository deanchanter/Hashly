# Tasks: Hashly v0.2.1 — Rendering Polish

Source: [spec.md](./spec.md)

Sequencing: discover the broken-image hook first (it's the only slice with a real unknown), then land the CSS-only slices in any order. All slices share `src/style.css` and Vitest in `src/__tests__/` — one PR per slice keeps review tight.

- [ ] 1. [Broken-image alt-text fallback (discovery + implementation)](https://github.com/deanchanter/Hashly/issues/78) — *partial: image fallback only*
- [ ] 2. [GFM table header borders + cell padding](https://github.com/deanchanter/Hashly/issues/78) — *partial: table layout only*
- [ ] 3. [Fenced code block surface (background + border)](https://github.com/deanchanter/Hashly/issues/78) — *partial: code surface only*
- [ ] 4. [List item rhythm — collapse paragraph margins inside `<li>`](https://github.com/deanchanter/Hashly/issues/78) — *partial: list rhythm only*
- [ ] 5. [H1 GitHub-style underline rule](https://github.com/deanchanter/Hashly/issues/79)

#78 is a bundle issue covering slices 1–4; close it when all four ship. #79 closes with slice 5.

---

### 1. Broken-image alt-text fallback

**User value:** When a `![alt](src)` target 404s, the reader sees the alt text inline instead of the OS '?' glyph — both better-looking and an a11y win for screen readers and low-bandwidth users.

**Acceptance criteria:**
- [ ] A deliberately broken `<img>` in the read-only fixture surfaces its `alt` attribute as visible text within the editor body.
- [ ] OS / browser broken-image glyph does not appear.
- [ ] Vitest DOM test mounts the editor with a broken image and asserts the alt text is present in the rendered output.
- [ ] Works in both light and dark modes (palette via `var(--ink-2)` / `var(--paper-2)`).

**Notes:** Discovery first — try CSS-only (`img:broken::after { content: attr(alt) }` or equivalent state hook) before reaching for a Milkdown plugin. If a JS hook is required, prefer a small MutationObserver in `src/main.ts` over a custom node spec. Sequenced first because it's the only slice with a real unknown; everything else is straight CSS.

### 2. GFM table header borders + cell padding

**User value:** Tables read as tables. Header columns are unambiguously delimited; body rows are tight enough that a 3-row table doesn't span the viewport.

**Acceptance criteria:**
- [ ] `.ProseMirror th` has `border-bottom: 1px solid var(--rule)`.
- [ ] `.ProseMirror th, .ProseMirror td` share `padding: 0.5rem 0.75rem`.
- [ ] `.ProseMirror td > p, .ProseMirror th > p` margins collapse to `0`.
- [ ] Vitest DOM test asserts the table header has a non-zero bottom border.
- [ ] No new hardcoded hex values; everything routes through `src/style.css` brand variables.

**Notes:** Verify the v0.2 fidelity-report (slice 1 of v0.2) Vitest harness still passes after cell-padding changes; update pinned snapshots in the same commit if they shift.

### 3. Fenced code block surface

**User value:** Fenced code blocks read as a distinct surface against the page, matching the contract called out in CLAUDE.md ("fenced blocks should render with a code background").

**Acceptance criteria:**
- [ ] `.ProseMirror pre` has `background: var(--paper-2)`, `border: 1px solid var(--rule)`, `border-radius: 6px`, `padding: 0.75rem 1rem`.
- [ ] Inline `code` retains current treatment — only the fenced surface changes.
- [ ] Light and dark modes both verified visually + via Vitest computed-style assertion.
- [ ] No syntax highlighting added (out of scope).

**Notes:** `--font-mono` is already wired on `.ProseMirror code, .ProseMirror pre`. This slice is purely a surface change.

### 4. List item rhythm

**User value:** List items read with the same vertical cadence as paragraphs — neither cramped nor inflated.

**Acceptance criteria:**
- [ ] `.ProseMirror li > p` margins collapse to `0`.
- [ ] `.ProseMirror li` has `margin: 0.25rem 0` (tune to match the body line-height — final value pinned in PR).
- [ ] Both `<ul>` and `<ol>` rendered; nested lists also verified (the showcase fixture has nested bullets that exercise this).
- [ ] Vitest DOM check asserts `li > p` has zero computed margin.

### 5. H1 GitHub-style underline rule

**User value:** H1 reads as a top-of-document break. GitHub-equivalent visual hierarchy.

**Acceptance criteria:**
- [ ] `.ProseMirror h1` has `border-bottom: 1px solid var(--rule)` plus `padding-bottom: 0.3rem` (tune in PR).
- [ ] H2 and H3 unchanged.
- [ ] Vitest DOM check asserts H1 has a non-zero bottom border and H2 does not.
- [ ] Light + dark verified via the `--rule` variable.

**Notes:** Smallest slice — good candidate to land first as a warm-up if slice 1 discovery is blocked.
