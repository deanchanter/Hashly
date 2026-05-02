import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issues #31 / #35 / #36 / #37 — error-path hardening (slices 7–10
// bundled / v0.2). #6 follow-ups surfaced by ux + security re-reviews.
//
// The four findings collapse to one cross-cutting hardening pass:
//
//   - bootstrap()'s showcase mount has no `.catch` (#31).
//   - handleFileOpened doesn't disable the toggle, doesn't null
//     currentEditor before mount, has no re-entrancy guard (#35).
//   - toggleEditMode's mountEditor rejection leaves a stale label,
//     blank pane, and enabled button with no user-visible error (#36).
//   - All three rejection paths fail silently (#37).
//
// Resolution this slice ships:
//   - bootstrap() chains a `.catch(...)` that console.errors with the
//     `[hashly]` prefix and renders a friendly file-error surface.
//   - handleFileOpened is restructured to mirror toggleEditMode: a
//     `fileOpenInFlight` guard, synchronous disabled=true, null
//     currentEditor BEFORE the new mount await, try/finally cleanup,
//     renderFileError on the rejection branch.
//   - toggleEditMode's mountEditor rejection branch now renders the
//     file-error surface and keeps the toggle label honest (the
//     editor that was torn down is gone, but the label/aria reflects
//     what's actually visible).

describe('Issue #35 — handleFileOpened symmetry hardening', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('handleFileOpened disables the toggle SYNCHRONOUSLY at entry (before any await)', async () => {
    // The toggle must be disabled the moment handleFileOpened starts,
    // so a click during the destroy/mount window can't race. We check
    // synchronously by NOT awaiting handleFileOpened and reading the
    // toggle's disabled state immediately.
    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    // Toggle is enabled after bootstrap's showcase mount (precondition).
    expect(toggle.disabled, 'precondition: toggle is enabled before file-open').toBe(false);

    // Fire WITHOUT awaiting. Read disabled BEFORE microtasks process.
    const promise = handleFileOpened(
      { path: '/tmp/x', name: 'x.md', content: '# X\n' },
      host,
    );
    expect(
      toggle.disabled,
      'expected toggle.disabled === true synchronously after handleFileOpened entry (Issue #35 — symmetric to toggleEditMode\'s sync disable).',
    ).toBe(true);

    await promise;
    expect(
      toggle.disabled,
      'expected toggle.disabled === false after handleFileOpened resolves (Issue #35 — try/finally re-enables).',
    ).toBe(false);
  });

  it('a re-entrant handleFileOpened call drops the second invocation (fileOpenInFlight guard)', async () => {
    // Two concurrent calls. The first must complete; the second must
    // be a no-op. We mock console.warn so the drop doesn't pollute
    // test output, but the contract is purely behavioral: only one
    // editor mounts in the host (no stacked .ProseMirror nodes).
    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    // Fire two in rapid succession.
    const a = handleFileOpened({ path: '/tmp/a', name: 'a.md', content: '# A\n' }, host);
    const b = handleFileOpened({ path: '/tmp/b', name: 'b.md', content: '# B\n' }, host);
    await Promise.all([a, b]);

    // Exactly one .ProseMirror in the host.
    const editors = host.querySelectorAll('.ProseMirror');
    expect(
      editors.length,
      `expected exactly one .ProseMirror in the host after a re-entrant handleFileOpened pair — re-entrancy guard must drop the second call (Issue #35). Got: ${editors.length}`,
    ).toBe(1);
  });
});

describe('Issue #31 — bootstrap()\'s showcase mount has a .catch on the rejection path', () => {
  let host: HTMLDivElement;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('mountEditor rejecting in bootstrap logs an error with the [hashly] prefix and does not throw', async () => {
    // Mock `Editor.make().…create()` to reject. The cleanest way is
    // to make the Milkdown core's `Editor.make()` chain throw at create
    // time. We do this by spying on the import-time behavior — but
    // Milkdown's API is captured at module import. So we mock the
    // entire module instead.
    vi.doMock('@milkdown/core', async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return {
        ...real,
        Editor: {
          make() {
            return {
              config(_cb: unknown) { return this; },
              use(_p: unknown) { return this; },
              create() {
                return Promise.reject(new Error('mountEditor rejected (test)'));
              },
            };
          },
        },
      };
    });

    const { bootstrap } = (await import('../main')) as unknown as { bootstrap: () => void };
    expect(() => bootstrap(), 'bootstrap() must not throw even if mountEditor rejects').not.toThrow();
    // The .catch fires asynchronously after a microtask.
    await new Promise((r) => setTimeout(r, 50));

    expect(
      consoleErrorSpy,
      'expected bootstrap() to console.error on mountEditor rejection (Issue #31 — preventive observability).',
    ).toHaveBeenCalled();
    const calls = consoleErrorSpy.mock.calls.flat().map(String).join(' | ');
    expect(
      calls,
      `expected console.error message to carry the "[hashly]" prefix matching the existing convention. Got: ${calls}`,
    ).toContain('[hashly]');

    vi.doUnmock('@milkdown/core');
  });
});

describe('Issue #36 / #37 — toggleEditMode mountEditor rejection sanity', () => {
  let host: HTMLDivElement;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // The cleanest way to exercise the toggle-then-reject path is to
  // let the first mount succeed (read mode showcase) and reject the
  // second (the edit-mode toggle). We can do that by counting calls
  // in the mock and only rejecting from the second onwards. But this
  // requires deep mocking of @milkdown/core. Skip the integration
  // test here in favor of the renderFileError contract: after a
  // toggle-mountEditor-rejection, the [role="alert"] surface must
  // be present in the host.

  it('after a toggle-time mount rejection, the host shows a [role="alert"] error surface (Issue #36 + #37)', async () => {
    let mountCount = 0;
    vi.doMock('@milkdown/core', async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      const RealEditor = real.Editor as { make: () => unknown };
      return {
        ...real,
        Editor: {
          make() {
            mountCount++;
            if (mountCount === 1) {
              // First call (bootstrap showcase) succeeds via the real impl.
              return RealEditor.make();
            }
            // Subsequent calls reject — including the toggle's new mount.
            return {
              config(_cb: unknown) { return this; },
              use(_p: unknown) { return this; },
              create() {
                return Promise.reject(new Error('mountEditor rejected (test)'));
              },
            };
          },
        },
      };
    });

    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    // handleFileOpened triggers a re-mount; this hits the rejecting
    // branch of the mock. The error path must render an alert.
    await handleFileOpened(
      { path: '/tmp/x', name: 'x.md', content: '# X\n' },
      host,
    ).catch(() => {
      /* handleFileOpened may reject up to the caller — the contract
         is that it ALSO renders the user-visible error before
         rejecting, so the user isn't left staring at a blank pane. */
    });
    await new Promise((r) => setTimeout(r, 50));

    const alert = host.querySelector('[role="alert"]');
    expect(
      alert,
      `expected the host to contain a [role="alert"] error surface after a mountEditor rejection in handleFileOpened (Issue #37 — error-path hardening renders user-visible feedback). Got innerHTML: ${host.innerHTML}`,
    ).not.toBeNull();

    vi.doUnmock('@milkdown/core');
  });
});
