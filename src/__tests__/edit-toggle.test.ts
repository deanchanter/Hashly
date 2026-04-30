import { describe, it, expect, beforeEach, vi } from 'vitest';

// Issue #6 — Read ↔ Edit toggle (WYSIWYG edit mode).
//
// AC #1: A visible toggle (button or menu item) switches between read-only
// and editable Milkdown.
//
// We pin the contract as a DOM <button> reachable via `[data-testid="edit-toggle"]`.
// Background:
//   - "Menu item" — i.e. a Tauri native menu item — cannot be exercised under
//     jsdom (Tauri's native menu APIs short-circuit / reject in non-Tauri
//     environments). The in-window button form is the testable contract; the
//     builder may ALSO wire a Tauri menu item alongside it, but the button is
//     what this test pins.
//   - The selector `[data-testid="edit-toggle"]` is a deliberate test-stable
//     hook. It lets the builder choose the visible label ("Edit", "Edit
//     mode", a pencil icon, etc.) without breaking the test, while still
//     pinning a reachable element. A semantic anchor (e.g. `aria-label`)
//     would also work, but we pin `data-testid` to keep the contract
//     orthogonal to label copy decisions.
//   - We pin `<button>` (not e.g. `<div role="button">`) so click + Enter +
//     Space activation come for free from the platform — preserving keyboard
//     accessibility without further wiring.

describe('Issue #6 AC #1 — visible read↔edit toggle button', () => {
  beforeEach(() => {
    // Reset module graph so `bootstrap()`'s module-level flags
    // (`dragDropGuardInstalled`, etc.) start fresh per test, matching the
    // pattern used by `src/__tests__/bootstrap.test.ts`.
    vi.resetModules();
    document.body.innerHTML = '<div id="editor"></div>';
    document.title = 'Hashly';
  });

  it('after bootstrap, the document contains a [data-testid="edit-toggle"] <button>', async () => {
    const { bootstrap } = (await import('../main')) as unknown as {
      bootstrap: () => void;
    };
    bootstrap();
    // Same wait pattern as `bootstrap.test.ts` — Milkdown's mount completes
    // across multiple macrotask boundaries in jsdom; 100 ms is empirically
    // safe and matches the prior art in this repo.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const toggle = document.querySelector<HTMLElement>('[data-testid="edit-toggle"]');
    expect(
      toggle,
      'expected a `[data-testid="edit-toggle"]` element after bootstrap (Issue #6 AC #1 — the toggle is the visible entry point to edit mode).',
    ).not.toBeNull();
    expect(
      toggle!.tagName,
      'expected the toggle to be a <button> so click + Enter/Space activation work natively (Issue #6 AC #1).',
    ).toBe('BUTTON');
    expect(
      toggle!.hasAttribute('disabled'),
      'expected the toggle to NOT be disabled by default — without an enabled toggle, the user has no path into edit mode (Issue #6 AC #1).',
    ).toBe(false);
  });

  it('clicking the toggle flips the .ProseMirror root from contenteditable="false" to "true"', async () => {
    const { bootstrap } = (await import('../main')) as unknown as {
      bootstrap: () => void;
    };
    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const editor = document.getElementById('editor')!;
    const proseMirror = editor.querySelector<HTMLElement>('.ProseMirror');
    expect(
      proseMirror,
      'precondition: editor must be mounted with a .ProseMirror root before the toggle is exercised',
    ).not.toBeNull();
    expect(
      proseMirror!.getAttribute('contenteditable'),
      'precondition: default state must be contenteditable="false" (Issue #6 AC #2 — read-only on open)',
    ).toBe('false');

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]');
    expect(
      toggle,
      'precondition: the [data-testid="edit-toggle"] button must exist before this test can exercise it',
    ).not.toBeNull();

    toggle!.click();
    // Allow ProseMirror's view-options update (or re-mount, depending on
    // implementation choice) to propagate before re-querying the DOM.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const proseMirrorAfter = editor.querySelector<HTMLElement>('.ProseMirror');
    expect(
      proseMirrorAfter,
      'expected a .ProseMirror root to remain after the toggle (the editor must still be mounted in edit mode — Issue #6 AC #1).',
    ).not.toBeNull();
    expect(
      proseMirrorAfter!.getAttribute('contenteditable'),
      'expected contenteditable="true" after clicking the toggle (Issue #6 AC #1 — the toggle puts the editor into edit mode).',
    ).toBe('true');
  });

  it('clicking the toggle a second time flips back to contenteditable="false"', async () => {
    const { bootstrap } = (await import('../main')) as unknown as {
      bootstrap: () => void;
    };
    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const editor = document.getElementById('editor')!;
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]');
    expect(
      toggle,
      'precondition: the [data-testid="edit-toggle"] button must exist',
    ).not.toBeNull();

    toggle!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      editor.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: first click must put the editor in edit mode',
    ).toBe('true');

    toggle!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      editor.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'expected contenteditable="false" after a second click (Issue #6 AC #1 — the toggle is bidirectional; once entered, edit mode must be exitable back to read mode).',
    ).toBe('false');
  });
});

// Issue #6 AC #2: Default state on file open is read-only.
//
// The two facets of this AC:
//   (a) `handleFileOpened` (the surface used by both File>Open and the
//       Tauri `menu-open-file` event listener) must mount the editor in
//       read-only mode regardless of any prior application state.
//   (b) Specifically, if the user has toggled into edit mode and THEN
//       opens a different file, the new file must come up read-only —
//       not inherit the "edit" mode from the prior session. This is the
//       cross-state boundary case that "default on file open" pins; it
//       guards against a regression that leaks `currentEditorMode` across
//       file boundaries.
//
// Both tests pin BOTH `contenteditable="false"` (keyboard-editability) and
// `aria-readonly="true"` (screen-reader announcement) on the new
// `.ProseMirror` root, matching the dual-attribute pattern established in
// `main.test.ts` for AC #3 of issue #18 / #21.

describe('Issue #6 AC #2 — default state on file open is read-only', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('handleFileOpened mounts the new editor in read-only mode (contenteditable="false", aria-readonly="true")', async () => {
    const { handleFileOpened } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    await handleFileOpened(
      { path: '/tmp/spec.md', name: 'spec.md', content: '# Spec' },
      host,
    );

    const pm = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pm,
      'precondition: a .ProseMirror root must be present after handleFileOpened',
    ).not.toBeNull();
    expect(
      pm!.getAttribute('contenteditable'),
      'expected contenteditable="false" on the .ProseMirror root after handleFileOpened (Issue #6 AC #2 — default-on-file-open is read-only).',
    ).toBe('false');
    expect(
      pm!.getAttribute('aria-readonly'),
      'expected aria-readonly="true" on the .ProseMirror root after handleFileOpened so screen readers announce read-only state (Issue #6 AC #2 + #21 a11y pin).',
    ).toBe('true');
  });

  it('after toggling to edit mode and then opening a different file, the new file is read-only (cross-state boundary)', async () => {
    // The interesting case: the user is mid-edit on file A and opens file
    // B. File B must come up read-only — the edit mode must NOT leak across
    // the file boundary. Without this contract, a contributor could ship an
    // impl that keeps `currentEditorMode = 'edit'` and the user lands inside
    // an editable view of someone else's file with no explicit handoff.
    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };
    bootstrap();
    // Wait long enough for the initial showcase mount to settle.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Step 1: enter edit mode on the initial doc.
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]');
    expect(toggle, 'precondition: toggle button must exist').not.toBeNull();
    toggle!.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: after the toggle click we must be in edit mode (otherwise this test is not exercising the cross-state case)',
    ).toBe('true');

    // Step 2: open a different file. The contract: the new file must come
    // up read-only.
    await handleFileOpened(
      { path: '/tmp/other.md', name: 'other.md', content: '# Brand New File' },
      host,
    );

    const pmNew = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pmNew,
      'expected a .ProseMirror root after the second handleFileOpened (the new file must mount)',
    ).not.toBeNull();
    expect(
      pmNew!.getAttribute('contenteditable'),
      'expected contenteditable="false" on the freshly-opened file (Issue #6 AC #2 — default-on-file-open must be read-only EVEN WHEN the prior session was in edit mode; the mode must NOT leak across file boundaries).',
    ).toBe('false');
    expect(
      pmNew!.getAttribute('aria-readonly'),
      'expected aria-readonly="true" on the freshly-opened file (Issue #6 AC #2 — read-only a11y state is part of the on-open contract).',
    ).toBe('true');
  });

  it('after the cross-state file open, clicking the toggle correctly enters edit mode (the toggle is rebound to the new editor)', async () => {
    // Subtle but important: when handleFileOpened destroys the prior editor
    // and mounts a new one, the toggle button's click handler MUST end up
    // pointing at the new editor — otherwise a click no-ops or, worse,
    // tries to dispatch on a destroyed editor and throws. We pin this by
    // entering edit mode on file A, opening file B (now read-only — see
    // the test above), then clicking the toggle and asserting file B
    // becomes editable. This catches the "toggle holds a stale editor
    // reference" regression class.
    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };
    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;

    // Enter edit on file A.
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Open file B (resets to read mode per the test above).
    await handleFileOpened(
      { path: '/tmp/B.md', name: 'B.md', content: '# B' },
      host,
    );
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: file B must be read-only after open',
    ).toBe('false');

    // Click toggle on file B — must enter edit mode for file B's editor.
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'expected file B to enter edit mode after the toggle click — i.e. the toggle is rebound to the new editor instance after handleFileOpened, not still wired to the destroyed prior editor (Issue #6 AC #2 cross-state correctness).',
    ).toBe('true');
  });
});
