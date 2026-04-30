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
