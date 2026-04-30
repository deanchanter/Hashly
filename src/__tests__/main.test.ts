import { describe, it, expect, beforeEach } from 'vitest';
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
