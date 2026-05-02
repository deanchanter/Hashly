import { describe, it, expect, beforeEach, vi } from 'vitest';

// Issue #27 — Tab key inside edit-mode editor (slice 6 / v0.2).
//
// Surfaced by ux-reviewer on issue #6: in edit mode, contenteditable=true
// + ProseMirror's default keymap captures Tab. A user mid-list cannot
// Tab out to reach the toggle button or any other UI. The AC asks us
// to either rebind Tab, document an alternative escape, or add a
// visible "Done editing" affordance.
//
// Resolution chosen for v0.2: keep Tab as ProseMirror's natural list
// indent (matches every markdown editor the persona has used), but
// install an explicit `Escape` handler that blurs the editor and
// focuses the [data-testid="edit-toggle"] button. This gives an
// explicit, discoverable keyboard escape path without breaking the
// indent ergonomics inside lists.
//
// Pin shape:
//   - Pressing Escape while focus is inside the edit-mode editor
//     moves focus to the toggle button (document.activeElement
//     identity check).
//   - Escape in read mode is a no-op (read-mode editor isn't focusable
//     for editing; this avoids stealing focus on read-only browsing).
//   - Escape with no editor mounted is a no-op.

describe('Issue #27 — Escape blurs the edit-mode editor and focuses the toggle button', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('Escape in edit mode moves focus to [data-testid="edit-toggle"]', async () => {
    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/x', name: 'x.md', content: '# X\n' },
      host,
    );

    // Toggle into edit mode.
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));

    // Focus the editor (mountEditor already focuses it on edit-mode
    // mount, but we do it explicitly here so the precondition is
    // independent of the toggle's focus behavior).
    const proseMirror = host.querySelector<HTMLElement>('.ProseMirror')!;
    proseMirror.focus();
    expect(
      document.activeElement,
      'precondition: editor must hold focus before Escape is dispatched',
    ).toBe(proseMirror);

    // Dispatch Escape — bubble + cancelable so the global handler
    // sees it.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 30));

    expect(
      document.activeElement,
      `expected Escape to move focus to the [data-testid="edit-toggle"] button (Issue #27 — explicit keyboard escape from the editor). Got activeElement: ${(document.activeElement as HTMLElement | null)?.tagName ?? 'null'} dataset=${JSON.stringify((document.activeElement as HTMLElement | null)?.dataset ?? {})}`,
    ).toBe(toggle);
  });

  it('Escape in read mode does NOT move focus (read-mode editor is not the source of focus)', async () => {
    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/y', name: 'y.md', content: '# Y\n' },
      host,
    );

    // Stay in read mode. Move focus to a sentinel element to confirm
    // Escape doesn't grab the focus.
    const sentinel = document.createElement('input');
    sentinel.id = 'sentinel';
    document.body.appendChild(sentinel);
    sentinel.focus();
    expect(document.activeElement).toBe(sentinel);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 30));

    expect(
      document.activeElement,
      'expected Escape in read mode to be a no-op (focus stays where it was) — Issue #27 explicitly scopes the escape behavior to edit mode.',
    ).toBe(sentinel);
  });

  it('Escape with no editor mounted is a no-op (does not throw)', async () => {
    const { bootstrap } = (await import('../main')) as unknown as { bootstrap: () => void };
    bootstrap();
    await new Promise((r) => setTimeout(r, 50));
    // No handleFileOpened — currentEditor is set by bootstrap's
    // showcase mount but we'll dispatch Escape and assert no throw.

    expect(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    }, 'expected Escape with no edit-mode editor mounted to NOT throw.').not.toThrow();
  });
});
