import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountEditor } from '../main';

// Issue #18 — AC #3: at least one meaningful passing test against existing
// frontend behavior. `mountEditor` must produce a read-only Milkdown instance
// with `aria-readonly="true"` on the editor root, and must actually render the
// supplied markdown (so the assertion isn't a tautology — we verify a real
// `<h1>` is in the DOM after mount, not just that an attribute is set).
//
// This test pins the public shape of `mountEditor` so future work (#3 fixture
// rendering, #6 read↔edit toggle, #7 dirty/save) can hang behavioral tests off
// the same entry point.

describe('mountEditor', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('mounts a Milkdown instance and marks the .ProseMirror root aria-readonly="true" with role="textbox"', async () => {
    await mountEditor(host, '# Hello');

    // Issue #21: pin the assertion to the ProseMirror node specifically (not just
    // any descendant with the attribute), and assert the role too. Background:
    // aria-readonly is only honored by assistive tech when the element has a
    // role that supports it (textbox/grid/listbox). Milkdown's core sets
    // `role="textbox"` on the editor's content DOM at @milkdown/core/lib/index.js:452.
    // If a future Milkdown release moves aria-readonly to a wrapper or drops the
    // role, screen-reader announcement breaks but a `[aria-readonly]`-only
    // selector would still pass — pinning both class and role catches that
    // regression as a real test failure.
    const readOnlyRoot = host.querySelector<HTMLElement>('.ProseMirror[aria-readonly="true"]');
    expect(
      readOnlyRoot,
      'expected the .ProseMirror root to have aria-readonly="true" (read-only Milkdown root). Milkdown emits the ProseMirror class on its content DOM; if a future upgrade moves aria-readonly elsewhere, fix the contract here.',
    ).not.toBeNull();
    expect(
      readOnlyRoot?.getAttribute('role'),
      'expected Milkdown\'s core to set role="textbox" on the ProseMirror root (required for aria-readonly to be honored by assistive tech). Pinned by issue #21.',
    ).toBe('textbox');
  });

  it('renders the supplied markdown — `# Hello` becomes an <h1> with text "Hello"', async () => {
    await mountEditor(host, '# Hello');

    // Real-behavior assertion (not a tautology): proves Milkdown actually
    // parsed the markdown into the DOM, so a future regression that breaks
    // CommonMark parsing or accidentally mounts an empty editor is caught.
    const h1 = host.querySelector('h1');
    expect(h1, 'expected an <h1> element rendered inside the mount host').not.toBeNull();
    expect(h1?.textContent ?? '').toContain('Hello');
  });

  it('configures the editor as non-editable (contenteditable="false")', async () => {
    await mountEditor(host, '# Hello');

    // ProseMirror reflects `editable: () => false` by setting
    // `contenteditable="false"` on its root. This complements the
    // aria-readonly assertion: aria covers screen-reader announcement,
    // contenteditable covers actual keyboard editability.
    const peditable = host.querySelector<HTMLElement>('[contenteditable]');
    expect(peditable, 'expected an element with a contenteditable attribute').not.toBeNull();
    expect(peditable?.getAttribute('contenteditable')).toBe('false');
  });

  it('assigns unique heading ids in standard <slug> / <slug>-<n> format on duplicate headings (#17)', async () => {
    // Issue #17 — Heading id collisions. Milkdown's @milkdown/preset-commonmark
    // ships `headingIdGenerator` whose default produces `text.toLowerCase().trim().replace(/\s+/g, '-')`.
    // A separate `syncHeadingIdPlugin` step disambiguates duplicates — but in a
    // NON-STANDARD `-#2`/`-#3` format (note the leading hash). Readers writing
    // in-doc anchor links use the GitHub-flavored / remark-slug convention
    // (`hello`, `hello-1`, `hello-2`), so links like `[name](#hello-1)` will
    // 404 silently against the default Milkdown output.
    //
    // This test pins the contract: 4 H1s, all unique IDs, and the `hello-`
    // family is exactly `["hello", "hello-1", "hello-2"]` (sorted) — that is,
    // standard slug-counter format with `n` starting at 1, monotonically
    // increasing, NO leading `#` in the suffix.
    const md = '# Hello\n\n# Hello\n\n# World\n\n# Hello';
    await mountEditor(host, md);

    const headings = Array.from(host.querySelectorAll<HTMLHeadingElement>('h1'));
    expect(headings.length, 'expected 4 <h1>').toBe(4);

    const ids = headings.map((h) => h.getAttribute('id'));
    expect(
      new Set(ids).size,
      `expected 4 unique ids, got: ${JSON.stringify(ids)}`,
    ).toBe(4);

    const helloIds = ids.filter((id) => id?.startsWith('hello')).sort();
    expect(
      helloIds,
      `expected ["hello", "hello-1", "hello-2"] (Issue #17 standard slug-counter format), got: ${JSON.stringify(helloIds)}`,
    ).toEqual(['hello', 'hello-1', 'hello-2']);
  });

  it('mounts the malformed-markdown fixture without throwing (#11)', async () => {
    // Issue #11 ACs: pathological markdown must render best-effort —
    // partial output is acceptable, but the editor must NOT crash and
    // must not log unhandled exceptions to console.error during the
    // mount.
    //
    // The fixture covers: unclosed fenced code blocks, broken tables
    // (column-count mismatch), raw HTML (commonmark preset escapes by
    // default — see #14 regression pin), 10-level nested lists,
    // unmatched emphasis, malformed links, mixed Unicode/RTL/zero-width
    // joiners. Inlining a representative subset rather than reading the
    // file via `?raw` keeps the test self-contained and the failure
    // mode obvious.
    const malformed = [
      '# Malformed',
      '',
      '```js',
      'const x = 1; // unclosed fence',
      '',
      '| a | b |',
      '|---|',
      '| c |',
      '',
      '<div onclick="alert(1)">raw HTML — must be escaped</div>',
      '',
      '- one',
      '  - two',
      '    - three',
      '      - four',
      '',
      '**bold without close',
      '[link without close paren(',
      '',
      'Mixed: שלום ✨ مرحبا — control: ​‌‍',
    ].join('\n');

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(mountEditor(host, malformed)).resolves.not.toThrow();
      expect(
        host.querySelector('.ProseMirror'),
        'expected .ProseMirror node to exist after mounting malformed input — partial render is acceptable but the editor must mount',
      ).not.toBeNull();
      expect(
        errSpy,
        `expected NO console.error during malformed-fixture mount (Issue #11 AC #3 — no unhandled exceptions). Calls: ${JSON.stringify(errSpy.mock.calls)}`,
      ).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('renders a GFM table from the @milkdown/preset-gfm pipeline (#3)', async () => {
    // Issue #3 AC #2: tables are GFM, NOT CommonMark. With only
    // @milkdown/preset-commonmark, the pipe-delimited rows would render as
    // plain text. This smoke test pins the gfm preset's wiring by mounting a
    // minimal table fixture and asserting the rendered DOM contains a real
    // <table> with header + body cells. If `gfm` is dropped from
    // mountEditor's plugin chain, this test fails with a clear "no <table>"
    // signal rather than the silent regression of seeing pipes-as-text.
    const md = '| Risk | Likelihood |\n|------|------------|\n| A    | High       |\n| B    | Low        |';
    await mountEditor(host, md);

    const table = host.querySelector('table');
    expect(table, 'expected a <table> rendered from the GFM table fixture (Issue #3 AC #2)').not.toBeNull();
    const headerCells = table!.querySelectorAll('thead th, tr:first-child th');
    expect(headerCells.length, 'expected 2 header cells in the GFM table').toBeGreaterThanOrEqual(2);
    const dataRows = table!.querySelectorAll('tbody tr');
    expect(dataRows.length, 'expected 2 data rows in the GFM table').toBeGreaterThanOrEqual(2);
  });

  it('exposes the .ProseMirror root as a tab stop (tabindex="0") so keyboard users can scroll the read-only doc', async () => {
    // Issue #15 AC #2: `contenteditable="false"` removes the implicit tab-stop
    // that ProseMirror would otherwise inherit from `contenteditable="true"`.
    // Without an explicit `tabindex`, keyboard-only users (and Tab navigation
    // generally) can't focus the doc, which breaks Space / PgDn / arrow-key
    // scrolling of the read-only content. The fix is to set `tabindex="0"`
    // via Milkdown's `editorViewOptionsCtx → EditorProps.attributes`.
    //
    // We pin the value verbatim ("0", not e.g. "-1") because `-1` would make
    // the element programmatically focusable but NOT reachable by Tab — that
    // would silently fail the keyboard-scroll requirement while still putting
    // a tabindex attribute on the root. We pin both class and attribute on
    // the same element (matching the aria-readonly pattern at issue #21) so
    // a future regression that puts tabindex on a wrapper is caught.
    await mountEditor(host, '# Hello');

    const tabbableRoot = host.querySelector<HTMLElement>('.ProseMirror[tabindex="0"]');
    expect(
      tabbableRoot,
      'expected the .ProseMirror root to carry tabindex="0" (Issue #15 AC #2) so keyboard-only users can Tab to the read-only doc and use Space/PgDn/arrow keys to scroll. tabindex="-1" is NOT acceptable — it makes the element programmatically focusable but unreachable via Tab.',
    ).not.toBeNull();
  });
});

describe('Issue #16 — installDragDropGuard (window-level dragover/drop preventDefault)', () => {
  // Background: ProseMirror only `preventDefault`s drag events when the editor
  // is editable. In our read-only mode (`editable: () => false`) it leaves
  // them alone, so a file dropped onto the editor causes the WebView to
  // navigate to `file://...` — replacing the page entirely. Tauri's
  // `dragDropEnabled: true` (default) currently intercepts native OS drag-drop
  // BEFORE it reaches the WebView, hiding the bug. Issue #4 will flip
  // `dragDropEnabled` to `false` so HTML5 drag-drop reaches the DOM (we want
  // the future Markdown-image drop UX). The window-level guard MUST land
  // before #4, otherwise a single mis-aimed file drop blanks the app.
  //
  // The contract pinned here:
  //   1. `installDragDropGuard()` is a named export of `src/main.ts`.
  //   2. After invocation, `dragover` and `drop` events dispatched on `window`
  //      have `defaultPrevented === true` (i.e. a listener was registered AND
  //      it called `event.preventDefault()`).
  //   3. The function is idempotent — calling it N times still results in
  //      exactly one listener per event type. Without idempotency, hot-reload
  //      / Vite HMR would leak listeners on every module re-evaluation.
  //
  // Test isolation note: `vi.resetModules()` reinitialises the module-level
  // "already installed" flag so each test starts from a clean baseline. This
  // matches the pattern used in `src/__tests__/bootstrap.test.ts`.

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('is exported as a function from src/main.ts', async () => {
    // RED until builder lands `export function installDragDropGuard`. This
    // test exists separately from the behavioral checks below so the failure
    // mode "missing export" surfaces with a precise message rather than as
    // an opaque "cannot read property of undefined" inside another test.
    const mod = (await import('../main')) as unknown as {
      installDragDropGuard?: unknown;
    };
    expect(
      typeof mod.installDragDropGuard,
      'expected `installDragDropGuard` to be exported as a function from src/main.ts (Issue #16 AC #1)',
    ).toBe('function');
  });

  it('calls preventDefault on a window dragover event after installation', async () => {
    // RED until the dragover listener is registered. We dispatch a
    // *cancelable* Event so `preventDefault()` actually flips
    // `defaultPrevented` to true (an event with `cancelable: false` would
    // silently no-op preventDefault — checking that flag on a non-cancelable
    // event is a tautology).
    const { installDragDropGuard } = (await import('../main')) as unknown as {
      installDragDropGuard: (target?: Window | Document) => void;
    };
    installDragDropGuard();

    const ev = new Event('dragover', { cancelable: true });
    window.dispatchEvent(ev);

    expect(
      ev.defaultPrevented,
      'expected a dragover dispatched on window to be defaultPrevented after installDragDropGuard() — without the guard, the WebView would treat a dropped file as a navigation to file://... and replace the page (Issue #16 AC #1).',
    ).toBe(true);
  });

  it('calls preventDefault on a window drop event after installation', async () => {
    // Companion to the dragover test: `dragover.preventDefault()` is what
    // makes an element a valid drop target, but `drop.preventDefault()` is
    // what suppresses the WebView's default file-handling behavior. BOTH
    // must be guarded — preventing only one is the same as preventing
    // neither for the purposes of stopping the file:// navigation.
    const { installDragDropGuard } = (await import('../main')) as unknown as {
      installDragDropGuard: (target?: Window | Document) => void;
    };
    installDragDropGuard();

    const ev = new Event('drop', { cancelable: true });
    window.dispatchEvent(ev);

    expect(
      ev.defaultPrevented,
      'expected a drop dispatched on window to be defaultPrevented after installDragDropGuard() — without the guard, a file dropped on the read-only editor navigates the WebView to file://... and blanks the app (Issue #16 AC #1).',
    ).toBe(true);
  });

  it('is idempotent — registers exactly one listener per event type across multiple calls', async () => {
    // Without idempotency, Vite's HMR re-evaluates `src/main.ts` on edit and
    // each evaluation would push another (dragover, drop) pair onto the
    // window. After a few saves the dispatch chain runs N redundant
    // preventDefaults. Pinning idempotency here forces the builder to gate
    // the registrations with a module-level flag.
    //
    // We spy on `window.addEventListener` AFTER the spy is installed (so
    // the spy sees the install calls) and AFTER `vi.resetModules()` reset
    // the module-level flag (so the first call is the one that actually
    // registers). We then filter by event type so unrelated listener
    // registrations from jsdom internals or other modules don't pollute
    // the count.
    const { installDragDropGuard } = (await import('../main')) as unknown as {
      installDragDropGuard: (target?: Window | Document) => void;
    };

    const addSpy = vi.spyOn(window, 'addEventListener');
    try {
      installDragDropGuard();
      installDragDropGuard();
      installDragDropGuard();

      const draggish = addSpy.mock.calls.filter(
        ([type]) => type === 'dragover' || type === 'drop',
      );

      expect(
        draggish.length,
        `expected exactly 2 dragover/drop listener registrations across 3 install calls (one per event type, gated by an "already installed" flag); got ${draggish.length}: ${JSON.stringify(draggish.map(([t]) => t))} (Issue #16 idempotency).`,
      ).toBe(2);

      const types = draggish.map(([t]) => t).sort();
      expect(
        types,
        'expected exactly one dragover and one drop registration',
      ).toEqual(['dragover', 'drop']);
    } finally {
      addSpy.mockRestore();
    }
  });
});
