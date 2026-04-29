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

  it('mounts a Milkdown instance and marks the editor root aria-readonly="true"', async () => {
    await mountEditor(host, '# Hello');

    // The editor root is the ProseMirror node Milkdown creates inside `host`.
    // Milkdown sets aria-readonly via editorViewOptionsCtx → EditorProps.attributes
    // (see src/main.ts). The selector deliberately scopes to within `host` so
    // this test does not collide with any other DOM.
    const readOnlyRoot = host.querySelector<HTMLElement>('[aria-readonly="true"]');
    expect(
      readOnlyRoot,
      'expected an element with aria-readonly="true" inside the mount host (read-only Milkdown root)',
    ).not.toBeNull();
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
});
