# Tasks: Hashly v0.2.1 — Rendering Polish

**Shipped on 2026-05-02** via the milestone PR. Source: [spec.md](./spec.md).

Sequencing: discover the broken-image hook first (it's the only slice with a real unknown), then land the CSS-only slices in any order. All slices share `src/style.css` and Vitest in `src/__tests__/` — landed as a single milestone PR rather than one PR per slice.

- [x] 1. [Broken-image alt-text fallback (discovery + implementation)](https://github.com/deanchanter/Hashly/issues/78) — *MutationObserver hook in `src/main.ts` swaps broken <img>s with `<span role="img" aria-label="{alt}">{alt}</span>`*
- [x] 2. [GFM table header borders + cell padding](https://github.com/deanchanter/Hashly/issues/78)
- [x] 3. [Fenced code block surface (background + border)](https://github.com/deanchanter/Hashly/issues/78)
- [x] 4. [List item rhythm — collapse paragraph margins inside `<li>`](https://github.com/deanchanter/Hashly/issues/78)
- [x] 5. [H1 GitHub-style underline rule](https://github.com/deanchanter/Hashly/issues/79)

#78 closes via the milestone PR (all four slices shipped). #79 closes with slice 5.

Follow-ups filed during the adversarial-review pass and deferred to v0.2.2 / v0.3: #80 (test coverage strengthening), #81 (broken-image hook hardening), #82 (--rule contrast against --paper), #83 (H1 scoping + nested-list margins + minor polish).

---

### 1. Broken-image alt-text fallback

**User value:** When a `![alt](src)` target 404s, the reader sees the alt text inline instead of the OS '?' glyph — both better-looking and an a11y win for screen readers and low-bandwidth users.

**Acceptance criteria:**
- [x] A deliberately broken `<img>` in the read-only fixture surfaces its `alt` attribute as visible text within the editor body.
- [x] OS / browser broken-image glyph does not appear.
- [x] Vitest DOM test mounts the editor with a broken image and asserts the alt text is present in the rendered output.
- [x] Works in both light and dark modes (palette via `var(--ink-2)` / `var(--paper-2)`) — verified through palette-token references in the rule body; dark-mode computed-style fidelity tracked in #80.

**Notes:** Discovery confirmed CSS-only is not viable (no `:broken` pseudo-class). Shipped as a small MutationObserver in `src/main.ts` that swaps the broken `<img>` for `<span class="hashly-broken-image" role="img" aria-label="{alt}" contenteditable="false">{alt}</span>`. Adversarial-review fixes (observer leak, empty-alt empty pill, a11y role, edit-mode safety, mixed-paragraph cleanup) landed in commit `1982f5f`. Hardening follow-ups in #81.

### 2. GFM table header borders + cell padding

**User value:** Tables read as tables. Header columns are unambiguously delimited; body rows are tight enough that a 3-row table doesn't span the viewport.

**Acceptance criteria:**
- [x] `.ProseMirror th` has `border-bottom: 1px solid var(--rule)`.
- [x] `.ProseMirror th, .ProseMirror td` share `padding: 0.5rem 0.75rem`.
- [x] `.ProseMirror td > p, .ProseMirror th > p` margins collapse to `0`.
- [x] Vitest test pins the contract — shipped as static-contract regex against `src/style.css` (jsdom does not apply Vite-imported CSS to computed styles); behavioral DOM coverage tracked in #80.
- [x] No new hardcoded hex values; everything routes through `src/style.css` brand variables.

**Notes:** v0.2 fidelity-report Vitest harness still passes (full suite green: 186 tests).

### 3. Fenced code block surface

**User value:** Fenced code blocks read as a distinct surface against the page, matching the contract called out in CLAUDE.md ("fenced blocks should render with a code background").

**Acceptance criteria:**
- [x] `.ProseMirror pre` has `background: var(--paper-2)`, `border: 1px solid var(--rule)`, `border-radius: 6px`, `padding: 0.75rem 1rem`.
- [x] Inline `code` retains current treatment — only the fenced surface changes.
- [x] Light and dark modes verified via palette-token reference (static-contract regex against `src/style.css`); behavioral computed-style coverage tracked in #80.
- [x] No syntax highlighting added (out of scope).

**Notes:** `--font-mono` is already wired on `.ProseMirror code, .ProseMirror pre`. This slice is purely a surface change.

### 4. List item rhythm

**User value:** List items read with the same vertical cadence as paragraphs — neither cramped nor inflated.

**Acceptance criteria:**
- [x] `.ProseMirror li > p` margins collapse to `0`.
- [x] `.ProseMirror li` has `margin: 0.25rem 0`.
- [x] Both `<ul>` and `<ol>` covered by the rule. Nested-list margin compounding tracked in #83 (selector applies at every depth, which is a follow-up scoping ask).
- [x] Vitest static-contract assertion pins `li > p { margin: 0 }` and `.ProseMirror li { margin: 0.25rem 0 }`; behavioral computed-style coverage tracked in #80.

### 5. H1 GitHub-style underline rule

**User value:** H1 reads as a top-of-document break. GitHub-equivalent visual hierarchy.

**Acceptance criteria:**
- [x] `.ProseMirror h1` has `border-bottom: 1px solid var(--rule)` plus `padding-bottom: 0.3rem`.
- [x] H2 and H3 unchanged (verified by `h1-rule.test.ts` AC3/AC4 — no `border-bottom` declaration in any rule targeting `.ProseMirror h2` or `.ProseMirror h3`, and h1's rule is not grouped with h2/h3 for `border-bottom`).
- [x] Vitest static-contract assertion pins the H1 border-bottom and excludes h2/h3 from the rule grouping; behavioral computed-style coverage tracked in #80.
- [x] Light + dark verified via the `--rule` variable's palette re-binding under `prefers-color-scheme: dark`. `--rule` contrast against `--paper` in light mode (~1.2:1, below WCAG 1.4.11) tracked in #82.

**Notes:** H1 underline scoping (every `<h1>` in the body, not just the first) tracked in #83.
