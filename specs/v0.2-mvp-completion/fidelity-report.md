# Milkdown Round-Trip Fidelity Report — v0.2

Source: [spec.md](./spec.md) · slice 1 / issue [#45](https://github.com/deanchanter/Hashly/issues/45)
Harness: `src/__tests__/fidelity.test.ts` · Corpus: `src/__tests__/fidelity/corpus.ts`

This report is the human-facing output of the fidelity gate. It enumerates every markdown shape that the corpus has identified as **lossy** under Milkdown's parse → serialize cycle (AST-equality oracle, not byte-equality), and assigns a disposition to each.

The corpus and this report are kept in sync by a vitest contract: every `lossy` corpus entry must appear here by name, and its corpus `note` is copied verbatim. Renaming a case in the corpus or editing its note breaks the test until the report is updated.

## Dispositions

Every lossy form gets one of three dispositions:

- **FIX UPSTREAM** — investigate Milkdown / remark-stringify configuration, fork or PR upstream, or override a Milkdown plugin to preserve the form.
- **FLAG OUT** — prevent the form from reaching the editor in the first place (e.g. reject the file at open time, or migrate it to a tolerated form before mounting).
- **ACCEPT** as a documented v0.2 known-limitation — the loss is visible in serialized markdown but does not change the rendered document, and the fix has a cost-benefit ratio that justifies deferring it past v0.2.

Every entry below pins a single disposition. If a future Milkdown release changes the round-trip behavior of a case, the harness fails (it expects `equal: false` for `lossy` cases) and the disposition must be revisited in the same commit that picks up the upstream change.

## v0.2 lossy corpus

### `commonmark-showcase fixture`

**Category:** `commonmark`
**Disposition:** ACCEPT as v0.2 known-limitation

**Why:** Fixture contains tight bullet lists (no blank lines between items). Milkdown's remark-stringify serialises them as LOOSE lists (blank lines between items, items wrapped in paragraphs). The two parse to different ProseMirror docs (`<list_item><paragraph>x</paragraph></list_item>` vs `<list_item>x</list_item>`). Disposition: ACCEPT as v0.2 known-limitation — visually identical to the user, the bullet content survives, and the fix is a remark-stringify config change worth deferring to v0.3.

**v0.3 follow-up:** investigate `remark-stringify`'s `bullet` and tight-list options (or override the `serializerCtx` slice in `mountEditor`) to preserve tightness on round-trip. If preserving tightness regresses other cases (e.g. lists containing block content), revisit and accept again.

### `gfm-task-list`

**Category:** `gfm`
**Disposition:** ACCEPT as v0.2 known-limitation

**Why:** Tight task list (no blank lines between items) normalised to loose on serialise — same root cause as `commonmark-showcase`. The `[x]`/`[ ]` checkbox state itself round-trips correctly; only the tightness changes. Disposition: ACCEPT as v0.2 known-limitation.

**v0.3 follow-up:** rolls up into the same remark-stringify config investigation as `commonmark-showcase fixture` — fixing one fixes both.

### `fragile-list tight bullet list (marker `*`)`

**Category:** `fragile`
**Disposition:** ACCEPT as v0.2 known-limitation

**Why:** Tight bullet list normalised to loose on serialise (paragraph-wrapped items, blank lines between). Marker normalisation `*` ↔ `-` is itself AST-equivalent (both produce `bullet_list`); the lossy half is the tightness change. Disposition: ACCEPT as v0.2 known-limitation.

**v0.3 follow-up:** isolated reproducer for the tight-list issue — useful as a regression pin once the v0.3 remark-stringify config investigation lands a fix.

## Cases that round-trip cleanly per oracle but warrant slice-level attention

These are NOT in the lossy corpus (they round-trip cleanly per AST-equality), but they have a known semantic mismatch that the AC1 oracle does not detect — slice 13 (Frontmatter recognition end-to-end) addresses them:

- **`frontmatter-valid leading yaml`**, **`frontmatter-malformed leading yaml`**, **`frontmatter-only no body`** — Milkdown self-consistently misreads the leading `---\n…\n---` as a horizontal rule + setext-h2 underline rather than as YAML frontmatter. The misread is *preserved* across round-trip (AST-equal in, AST-equal out), so this is not a fidelity loss in the AC1 sense — but the user-visible reading view is wrong. Slice 13 lands strict-detection and proper rendering; this report does not gate on it.

## Gating

#7 (Save in place via Cmd+S) is gated on this report being committed (per AC4). The Rust integration test at `src-tauri/tests/fidelity_report.rs` enforces the gate: it fails the build if this file is missing or empty, and is the cargo-side belt to vitest's suspenders.
