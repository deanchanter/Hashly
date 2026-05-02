# Hashly v0.2.1 — Rendering Polish

**Status:** Shipped 2026-05-02
**Author:** deanchanter
**Date:** 2026-05-02

## Summary

v0.2.1 is a small post-MVP point release that closes visible UX gaps in the WYSIWYG rendered-markdown surface. v0.2 shipped the brand system, dirty/save loop, frontmatter recognition, and templates — but a fixture walkthrough surfaced rendering issues in the read-only view (table layout, fenced code surfaces, broken-image fallback, list rhythm, and H1 hierarchy) that degrade the perceived quality of the editor. This release fixes those without expanding scope into v0.3 territory.

## Problem & motivation

The v0.2 milestone treated Milkdown's default node styling as good-enough for ship. It is not, in five concrete places:

1. **GFM tables** — header columns visually collide (no separator/padding) and body rows are vertically inflated by uncollapsed paragraph margins inside cells.
2. **Fenced code blocks** — render with the same background as the page, so block boundaries disappear. CLAUDE.md and the v0.1 fixture explicitly call out "fenced blocks should render with a code background" — that contract was not met.
3. **Broken images** — fall back to the OS '?' glyph instead of surfacing alt text. This is both ugly and an a11y regression: alt text exists for exactly this case.
4. **List rhythm** — `<li>` elements have visibly more vertical space between siblings than between paragraphs, breaking document rhythm.
5. **H1 hierarchy** — `# H1` headings render as plain display type with no separator, so the top-of-document break against following body text is weak. Standard markdown reader convention (GitHub) puts a thin rule under H1.

None of these are correctness bugs — the markdown is parsed and serialized faithfully. They are CSS-surface issues that make Hashly look unfinished against any docs site a PM has used before. Fixing them lifts perceived quality before any v0.3 distribution work.

## Users & primary use case

Same persona as v0.2 — a PM reading or quick-fix-editing an SDD `.md` doc. v0.2.1 does not change *what* the persona can do; it changes how confident they feel about handing a Hashly-rendered doc to a stakeholder. The primary scenario is unchanged: open `.md`, read top-to-bottom, optionally toggle to edit, save. v0.2.1 hardens that scenario's visual output.

## Scope

### In scope — acceptance criteria

- [x] **#78 Rendered-markdown UX bundle** — five fixes shipped together because they all live in `src/style.css` against the existing brand variables:
  - Table header cells get `border-bottom: 1px solid var(--rule)` and shared horizontal padding with body cells, so columns are unambiguously delimited.
  - Table body cells use `padding: 0.5rem 0.75rem`; `td > p` and `th > p` margins collapse to `0` so row height follows content.
  - Fenced `pre` renders on `var(--paper-2)` with `1px solid var(--rule)` border, `border-radius: 6px`, `padding: 0.75rem 1rem`. No syntax highlighting in scope.
  - Broken `<img>` surfaces its `alt` text inline via a small MutationObserver hook in `src/main.ts` that swaps the broken `<img>` with `<span class="hashly-broken-image" role="img" aria-label="{alt}" contenteditable="false">{alt}</span>`. CSS-only was not viable (no `:broken` pseudo-class). The OS '?' glyph never appears.
  - `<li>` items collapse `li > p` margins to `0` and use `margin: 0.25rem 0` on the `li` itself, so list rhythm matches paragraph rhythm.
- [x] **#79 H1 underline rule** — `.ProseMirror h1` gets `border-bottom: 1px solid var(--rule)` plus `padding-bottom: 0.3rem`. H2 / H3 are unchanged. GitHub-style hierarchy.
- [x] **All changes flow through the existing CSS variables** in `src/style.css` (`--paper-2`, `--rule`, `--ink`, etc.). No new hardcoded hex values. Both light and dark modes verified through palette-token references.
- [x] **Vitest coverage** in `src/__tests__/` — broken-image fallback uses runtime DOM assertions on the mounted editor (`broken-image.test.ts`); slices 2–5 use the static-contract pattern (regex against `src/style.css`) because jsdom does not apply Vite-imported CSS to computed styles. Coverage gap (slices 2/3/4/5 are static-contract rather than behavioral DOM) tracked in #80.

### Out of scope

- **Syntax highlighting inside fenced code.** A v0.3 candidate; v0.2.1 ships only the surface (background + border).
- **Print stylesheet.** Not requested, no signal yet.
- **Slice 16 / #12 — `.dmg` packaging + Homebrew cask.** v0.2 spec said "ships in a v0.2.x point release after v0.2 merges." It is *not* tagged `v0.2.1` at the time this spec is written. Decision: keep packaging in its own follow-up release (e.g. v0.2.2) so this release stays a tight CSS-only iteration that can ship inside a single TDD loop. Re-tag #12 to `v0.2.1` if the user disagrees.
- **Modal a11y polish (#66), CRLF frontmatter (#71), filename strip extra Unicode (#72), version bump (#73), js-yaml exact pin (#74), armRef race (#75), template hydration order-sensitivity (#76).** These are the existing v0.2 final-review follow-ups and are out of scope for v0.2.1's narrow rendering-polish frame; they remain candidates for v0.2.2 or v0.3.

## Risks

- **Milkdown image-node hook for the alt-text fallback may not be CSS-only.** If the broken-image state isn't exposed to CSS we'll need a small JS hook (MutationObserver on `<img>` or a Milkdown plugin) — that's still small but expands the test surface. Mitigation: discover during slice 1; if JS-required, scope the hook to `src/main.ts` and pin via Vitest.
- **Cell-padding changes can shift the existing fidelity-report screenshots.** Mitigation: re-run the Vitest fidelity gate from v0.2 slice 1 after the CSS changes land; update any pinned visual snapshots in the same commit so regressions are visible in review rather than rediscovered later.

## Open questions

- Should #12 (`.dmg` packaging) ride along in v0.2.1 or wait for v0.2.2? Default in this spec: wait. Flip if the user re-tags.

