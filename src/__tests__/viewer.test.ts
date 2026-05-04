import { describe, it, expect, beforeEach } from 'vitest';

// Issue #90 / AC 4.4 — Mount Milkdown in read-only mode with v0.2
// rendering polish.
//
// `mountViewer(host, content)` is the web-mode counterpart of v0.2's
// `mountEditor`. It mounts the supplied markdown into `host` as a
// read-only Milkdown editor (no toggle, no edit affordances) carrying
// over the v0.2 polish: GFM tables, fenced code, list rhythm, H1
// underline, broken-image fallback, frontmatter recognition.
//
// Per team-lead: don't re-test every v0.2 polish detail here — the
// regression suite (`table-rendering.test.ts`, `fenced-code.test.ts`,
// `h1-rule.test.ts`, `list-rhythm.test.ts`, `broken-image.test.ts`,
// `frontmatter.test.ts`) already pins those for the v0.2 mount.
// Pin only viewer-specific contract:
//
//   1. `mountViewer` is a named export of `src/viewer.ts`.
//   2. The mount is read-only (aria-readonly="true",
//      contenteditable="false").
//   3. The supplied content actually reaches the DOM (a real <h1>).
//   4. GFM polish carries through (a single regression smoke check
//      so a future `mountViewer` impl that quietly drops the gfm
//      preset is caught at this AC's level rather than only via
//      the v0.2 regression suite that doesn't exercise the viewer
//      path).
//   5. Frontmatter is stripped before the markdown reaches Milkdown
//      so the viewer doesn't render the YAML fences as a literal
//      `---` thematic break / heading.

describe('Issue #90 / AC 4.4 — mountViewer (read-only Milkdown)', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('is a named export of src/viewer.ts', async () => {
    // RED until builder creates `src/viewer.ts` exporting `mountViewer`.
    const mod = (await import('../viewer')) as unknown as {
      mountViewer?: unknown;
    };
    expect(
      typeof mod.mountViewer,
      'expected `mountViewer` to be exported as a function from src/viewer.ts (Issue #90 AC 4.4).',
    ).toBe('function');
  });

  it('mounts the supplied markdown as a read-only Milkdown — `# Hello` becomes <h1>Hello</h1>', async () => {
    const { mountViewer } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<unknown>;
    };

    await mountViewer(host, '# Hello');

    // (a) The mount is read-only. Pin both the aria-readonly attribute
    // AND the role="textbox" on the same .ProseMirror element so a
    // future regression that moves either to a wrapper (which silently
    // breaks assistive tech announcement of read-only) is caught.
    const readOnlyRoot = host.querySelector<HTMLElement>(
      '.ProseMirror[aria-readonly="true"]',
    );
    expect(
      readOnlyRoot,
      'expected the .ProseMirror root to have aria-readonly="true" (Issue #90 AC 4.4 — viewer is read-only).',
    ).not.toBeNull();
    expect(
      readOnlyRoot?.getAttribute('role'),
      'expected role="textbox" on the .ProseMirror root so aria-readonly is honored by assistive tech (matches the v0.2 read-only contract).',
    ).toBe('textbox');
    expect(
      readOnlyRoot?.getAttribute('contenteditable'),
      'expected contenteditable="false" on the .ProseMirror root (Issue #90 AC 4.4 — keyboard editing is suppressed in the viewer).',
    ).toBe('false');

    // (b) The supplied content actually rendered. A regression that
    // mounts an empty editor would still pass the read-only checks
    // above; this assertion is the real-behavior anchor.
    const h1 = host.querySelector('h1');
    expect(
      h1,
      'expected an <h1> rendered inside the host after mountViewer (Issue #90 AC 4.4 — the viewer must actually render the supplied markdown).',
    ).not.toBeNull();
    expect(h1?.textContent ?? '').toContain('Hello');
  });

  it('renders a GFM table (regression smoke that the gfm preset is wired into the viewer)', async () => {
    // The team-lead asked us NOT to re-test every v0.2 polish detail.
    // This single GFM-table smoke is the load-bearing regression: if
    // a future contributor copy-pastes only the commonmark preset
    // into mountViewer (forgetting gfm), tables render as plain
    // pipe text and the viewer silently regresses against the AC's
    // "v0.2 rendering polish" requirement. Pinning one polish pin in
    // the viewer test slot catches that without duplicating the full
    // table-rendering suite.
    const { mountViewer } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<unknown>;
    };

    const md =
      '| Risk | Likelihood |\n|------|------------|\n| A    | High       |\n| B    | Low        |';
    await mountViewer(host, md);

    const table = host.querySelector('table');
    expect(
      table,
      'expected a <table> rendered from the GFM table fixture (Issue #90 AC 4.4 — gfm preset must be wired into mountViewer, same as v0.2 mountEditor).',
    ).not.toBeNull();
    const dataRows = table!.querySelectorAll('tbody tr');
    expect(
      dataRows.length,
      'expected 2 data rows in the GFM table',
    ).toBeGreaterThanOrEqual(2);
  });

  it('strips frontmatter before mounting so YAML fences do not render as a thematic break / heading', async () => {
    // Without frontmatter recognition, a doc that starts with
    //
    //   ---
    //   title: Spec
    //   ---
    //
    //   # Body
    //
    // would render the leading `---` as a CommonMark thematic break
    // (or, if Milkdown's parser interprets it as a setext underline,
    // a giant H2 with the title-line as its heading). Both are the
    // wrong UX. v0.2's `mountEditor` strips frontmatter via
    // `parseFrontmatter` and routes only the body to Milkdown; the
    // viewer must do the same.
    //
    // We assert the body's `# Body` lands as the FIRST <h1> AND that
    // the literal text "title: Spec" is NOT in the rendered DOM
    // (otherwise the viewer rendered the YAML as prose).
    const { mountViewer } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<unknown>;
    };

    const md = '---\ntitle: Spec\nauthor: Dean\n---\n\n# Body\n\nbody prose';
    await mountViewer(host, md);

    const h1s = host.querySelectorAll('h1');
    expect(
      h1s.length,
      `expected exactly one <h1> when the doc has frontmatter + a single body heading. Got ${h1s.length}. If >1, the YAML fences likely rendered as setext-underlined H1/H2.`,
    ).toBe(1);
    expect(h1s[0]?.textContent ?? '').toContain('Body');

    // The frontmatter MAY surface in a panel above the editor (v0.2
    // pattern) — we don't pin where it lives, only that the YAML
    // doesn't end up inside the rendered prose. Check the
    // .ProseMirror root specifically (the editor's content), not
    // the whole host (a frontmatter panel is fine).
    const editorRoot = host.querySelector('.ProseMirror');
    expect(
      editorRoot,
      'expected a .ProseMirror editor root inside host',
    ).not.toBeNull();
    expect(
      editorRoot!.textContent ?? '',
      'expected the YAML "title: Spec" line NOT to appear inside the .ProseMirror editor body (Issue #90 AC 4.4 — frontmatter must be stripped before mounting; YAML belongs in a separate panel surface, not in the rendered markdown).',
    ).not.toContain('title: Spec');
  });
});
