import { describe, it, expect, beforeEach } from 'vitest';

// remove-tauri-legacy / spec-pr-editor — visible Edit affordance.
//
// `renderViewerHeader(host, info, onEdit?)` SHALL, when an `onEdit`
// callback is supplied, render a `[data-testid="header-edit-button"]`
// inside the header. The button:
//
//   1. Is initially disabled — the bootstrap enables it after
//      `mountViewer` resolves.
//   2. When clicked while enabled, invokes the `onEdit` callback
//      (which the bootstrap wires to `attemptEditAction(editorHost)`).
//   3. When clicked while disabled, is a no-op (the browser blocks
//      `click` on a disabled `<button>` in any case, but we double-pin
//      so a future regression that drops `disabled` and replaces it
//      with `aria-disabled` doesn't quietly fire the JIT auth chain
//      mid-mount).
//
// `setEditButtonEnabled(headerHost, enabled)` is the bootstrap-side
// flip — flipping `disabled` to `false` after the read-only viewer
// finishes mounting, or back to `true` if a future flow needs to
// re-disable (none today, but the symmetry is cheap).

describe('viewer-header — Edit button', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('is absent when no onEdit callback is supplied', async () => {
    const { renderViewerHeader } = await import('../viewer-header');

    renderViewerHeader(host, {
      repo: 'deanchanter/Hashly',
      path: 'README.md',
      ref: 'main',
    });

    expect(
      host.querySelector('[data-testid="header-edit-button"]'),
      'expected NO edit button when onEdit is omitted (e.g. landing / error surface paths).',
    ).toBeNull();
  });

  it('renders a [data-testid="header-edit-button"] button, initially disabled', async () => {
    const { renderViewerHeader } = await import('../viewer-header');

    renderViewerHeader(
      host,
      { repo: 'deanchanter/Hashly', path: 'README.md', ref: 'main' },
      () => {
        /* no-op for this assertion */
      },
    );

    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="header-edit-button"]',
    );
    expect(button, 'expected the header to render an Edit button when onEdit is supplied').not.toBeNull();
    expect(button!.tagName).toBe('BUTTON');
    expect(button!.disabled, 'Edit button must start disabled until the viewer finishes mounting').toBe(true);
  });

  it('setEditButtonEnabled flips the disabled state', async () => {
    const { renderViewerHeader, setEditButtonEnabled } = await import('../viewer-header');

    renderViewerHeader(
      host,
      { repo: 'deanchanter/Hashly', path: 'README.md', ref: 'main' },
      () => {},
    );

    setEditButtonEnabled(host, true);
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="header-edit-button"]',
    )!;
    expect(button.disabled, 'expected setEditButtonEnabled(host, true) to enable the button').toBe(false);

    setEditButtonEnabled(host, false);
    expect(button.disabled, 'expected setEditButtonEnabled(host, false) to re-disable the button').toBe(true);
  });

  it('click on the enabled Edit button invokes onEdit', async () => {
    const { renderViewerHeader, setEditButtonEnabled } = await import('../viewer-header');

    let calls = 0;
    renderViewerHeader(
      host,
      { repo: 'deanchanter/Hashly', path: 'README.md', ref: 'main' },
      () => {
        calls += 1;
      },
    );
    setEditButtonEnabled(host, true);

    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="header-edit-button"]',
    )!;
    button.click();

    expect(calls, 'expected click on enabled Edit button to invoke onEdit exactly once').toBe(1);
  });

  it('setEditButtonEnabled is a benign no-op when no header has been rendered', async () => {
    const { setEditButtonEnabled } = await import('../viewer-header');

    // No renderViewerHeader call — host is empty.
    expect(() => setEditButtonEnabled(host, true)).not.toThrow();
  });
});
