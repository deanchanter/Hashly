import showcase from '../../fixtures/commonmark-showcase.md?raw';

// Issue #45 — Round-trip fidelity corpus.
//
// Each case carries an `expected` disposition that the harness asserts
// against. The point is to make the corpus itself an executable record
// of every shape we know about: a case marked `clean` MUST round-trip
// cleanly, and a case marked `lossy` MUST NOT — so a future Milkdown
// upgrade that fixes a lossy case fails this test (forcing the report
// to be updated) and a regression that breaks a clean case also fails
// (catching the loss before it reaches users).
//
// `note` is the one-line rationale that the disposition report copies
// verbatim. Keep them concise — long-form prose lives in the report.

export type FidelityCategory = 'commonmark' | 'gfm' | 'fragile' | 'frontmatter';
export type Disposition = 'clean' | 'lossy';

export interface FidelityCase {
  name: string;
  category: FidelityCategory;
  source: string;
  expected: Disposition;
  /** Required when `expected === 'lossy'`. */
  note?: string;
}

export const corpus: FidelityCase[] = [
  // ──────────────────────────────────────────────────────────────────
  // (a) CommonMark — bundled showcase fixture (AC2.a)
  // ──────────────────────────────────────────────────────────────────
  {
    name: 'commonmark-showcase fixture',
    category: 'commonmark',
    source: showcase,
    expected: 'lossy',
    note:
      'Fixture contains tight bullet lists (no blank lines between items). Milkdown\'s remark-stringify serialises them as LOOSE lists (blank lines between items, items wrapped in paragraphs). The two parse to different ProseMirror docs (`<list_item><paragraph>x</paragraph></list_item>` vs `<list_item>x</list_item>`). Disposition: ACCEPT as v0.2 known-limitation — visually identical to the user, the bullet content survives, and the fix is a remark-stringify config change worth deferring to v0.3.',
  },

  // ──────────────────────────────────────────────────────────────────
  // (b) GFM — preset-gfm@7.20.0 features (AC2.b)
  // ──────────────────────────────────────────────────────────────────
  {
    name: 'gfm-table simple',
    category: 'gfm',
    source:
      '| Feature | Status |\n' +
      '|---------|--------|\n' +
      '| Tables  | Yes    |\n' +
      '| Tasks   | Yes    |\n',
    expected: 'clean',
  },
  {
    name: 'gfm-task-list',
    category: 'gfm',
    source:
      '- [x] done\n' +
      '- [ ] pending\n' +
      '- [ ] also pending\n',
    expected: 'lossy',
    note:
      'Tight task list (no blank lines between items) normalised to loose on serialise — same root cause as `commonmark-showcase`. The `[x]`/`[ ]` checkbox state itself round-trips correctly; only the tightness changes. Disposition: ACCEPT as v0.2 known-limitation.',
  },
  {
    name: 'gfm-strikethrough',
    category: 'gfm',
    source: '~~struck through~~ and not.\n',
    expected: 'clean',
  },

  // ──────────────────────────────────────────────────────────────────
  // (c) Fragile-markdown forms (AC2.c) — surface forms that markdown
  // permits multiple syntaxes for. Under an AST oracle these *should*
  // collapse to a single canonical form — pinning each here makes the
  // collapse explicit.
  // ──────────────────────────────────────────────────────────────────
  {
    name: 'fragile-list tight bullet list (marker `*`)',
    category: 'fragile',
    source: '* one\n* two\n* three\n',
    expected: 'lossy',
    note:
      'Tight bullet list normalised to loose on serialise (paragraph-wrapped items, blank lines between). Marker normalisation `*` ↔ `-` is itself AST-equivalent (both produce `bullet_list`); the lossy half is the tightness change. Disposition: ACCEPT as v0.2 known-limitation.',
  },
  {
    name: 'fragile-list loose bullet list (already loose)',
    category: 'fragile',
    source: '* one\n\n* two\n\n* three\n',
    expected: 'clean',
  },
  {
    name: 'fragile-list ordered tight',
    category: 'fragile',
    source: '1. one\n2. two\n3. three\n',
    expected: 'clean',
  },
  {
    name: 'fragile-code-fence tildes vs backticks',
    category: 'fragile',
    source: '~~~js\nconst x = 1;\n~~~\n',
    expected: 'clean',
  },
  {
    name: 'fragile-heading setext h1',
    category: 'fragile',
    source: 'Title\n=====\n\nbody.\n',
    expected: 'clean',
  },
  {
    name: 'fragile-heading setext h2',
    category: 'fragile',
    source: 'Subtitle\n--------\n\nbody.\n',
    expected: 'clean',
  },
  {
    name: 'fragile-link reference style',
    category: 'fragile',
    source:
      'See the [Milkdown docs][md] for details.\n' +
      '\n' +
      '[md]: https://milkdown.dev\n',
    expected: 'clean',
  },
  {
    name: 'fragile-hard-break backslash',
    category: 'fragile',
    source: 'line one\\\nline two\n',
    expected: 'clean',
  },
  {
    name: 'fragile-emphasis underscore',
    category: 'fragile',
    source: '_emphasised_ and __strong__ run together.\n',
    expected: 'clean',
  },
  {
    name: 'fragile-table-cell padding tight',
    category: 'fragile',
    source: '|a|b|\n|-|-|\n|c|d|\n',
    expected: 'clean',
  },
  {
    name: 'fragile-table-cell alignment colons',
    category: 'fragile',
    source:
      '| left | center | right |\n' +
      '| :--- | :----: | ----: |\n' +
      '| a    | b      | c     |\n',
    expected: 'clean',
  },

  // ──────────────────────────────────────────────────────────────────
  // (d) Frontmatter cases (AC2.d) — slice 13 hasn't landed yet, so
  // every leading `---` block is parsed as plain markdown (setext
  // heading underline / horizontal rule). The corpus pins the
  // pre-slice-13 reality so when slice 13 lands these dispositions
  // flip in lockstep with the harness extension.
  // ──────────────────────────────────────────────────────────────────
  {
    name: 'frontmatter-none plain body',
    category: 'frontmatter',
    source: '# body\n\nplain markdown, no frontmatter.\n',
    expected: 'clean',
  },
  {
    name: 'frontmatter-valid leading yaml',
    category: 'frontmatter',
    source:
      '---\n' +
      'title: Spec\n' +
      'author: PM\n' +
      '---\n' +
      '\n' +
      '# body\n',
    expected: 'clean',
    // Round-trip clean per AST oracle, BUT Milkdown semantically misreads
    // `---\n…\n---` as a horizontal rule + setext-h2 underline rather than
    // as frontmatter. Slice 13 (frontmatter end-to-end) will fix the
    // reading-view interpretation; the round-trip itself is already
    // preserved, so no information is lost in the AC1 sense — this case
    // belongs in slice 13's spec, not in the fidelity report.
  },
  {
    name: 'frontmatter-malformed leading yaml',
    category: 'frontmatter',
    source:
      '---\n' +
      'key: : :: bad: yaml\n' +
      '---\n' +
      '\n' +
      '# body\n',
    expected: 'clean',
    // Same self-consistent misread as `frontmatter-valid`. Slice 13's
    // strict-detection rule will pass YAML parse failures through to
    // Milkdown unchanged, which keeps the round-trip clean by definition.
  },
  {
    name: 'frontmatter-only no body',
    category: 'frontmatter',
    source: '---\nkey: value\n---\n',
    expected: 'clean',
    // Self-consistent misread (HR + setext-h2). Slice 13 will render this
    // as a metadata-only document with an empty body in reading view.
  },
  {
    name: 'frontmatter-leading-fence not at offset 0',
    category: 'frontmatter',
    source:
      'leading paragraph.\n' +
      '\n' +
      '---\n' +
      'key: value\n' +
      '---\n' +
      '\n' +
      '# body\n',
    expected: 'clean',
    note:
      'A `---` not at byte offset 0 is NEVER frontmatter (per slice 13 strict-detection rule). This case must round-trip cleanly under the AST oracle so slice 13 does not need to special-case it.',
  },
];
