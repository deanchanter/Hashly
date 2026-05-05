import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #92 fix-loop iter-1 — final polish (#15, #16, #17).
//
// AC for adversarial-reviewer's bundle:
//
//   #15 (Cmd+S in web mode) — `installSaveHandler` is wired
//   unconditionally in `bootstrap()`. In web mode, Cmd+S
//   preventDefault'd then calls Tauri's saveCurrent which
//   eventually tries to open the Tauri save-dialog. The dialog
//   call fails silently in the browser. User pressed Cmd+S,
//   sees no banner, no PR, no feedback. Fix: gate
//   `installSaveHandler` behind `isTauri`. (Option (b): route
//   Cmd+S in web edit mode through the new save click handler
//   — also acceptable; honors muscle memory.)
//
//   #16 ("View on GitHub" link wording collision) — both
//   `renderSaveSuccess` (success banner) and `renderViewerHeader`
//   (persistent header) read "View on GitHub". User sees two
//   identical links above the editor → can navigate to wrong
//   place (header → file blob view; banner → PR review view).
//   Fix: change save-success banner link text to "View pull
//   request" or "Open PR on GitHub".
//
//   #17 (Conflict banner Reload affordance) — Copy is a button;
//   reload is plain text in the message. User must remember
//   Cmd+R / F5 at a high-stakes recovery moment. Fix: add a
//   `<button>Reload now</button>` next to the Copy button.
//   Click → `window.location.reload()`.
//
// Tests opt out of vitest.setup.ts's Tauri-default flag for the
// #15 tests; the #16 / #17 tests are pure DOM and don't depend
// on the bootstrap entry path.

const SAVE_SUCCESS_TESTID = 'save-success';
const SAVE_CONFLICT_TESTID = 'save-conflict';

interface FakeLocation {
  href: string;
  origin: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  assign: (url: string) => void;
  replace: (url: string) => void;
  reload: () => void;
  toString: () => string;
}

describe('Issue #92 fix #15 — Cmd+S in web mode does NOT trigger Tauri saveCurrent', () => {
  let originalLocation: Location;
  let saveDialogSpy: ReturnType<typeof vi.fn>;
  let invokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    // Web-mode bootstrap branch: __TAURI_INTERNALS__ absent.
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML =
      '<header id="viewer-header"></header><div id="editor"></div>';
    document.title = 'Hashly';
    window.history.replaceState({}, '', '/?repo=foo/bar&path=spec.md&ref=main');

    originalLocation = window.location;
    let _href = originalLocation.href;
    const fakeLocation: FakeLocation = {
      get href() { return _href; },
      // eslint-disable-next-line accessor-pairs
      set href(v: string) { _href = v; },
      origin: originalLocation.origin,
      protocol: originalLocation.protocol,
      host: originalLocation.host,
      hostname: originalLocation.hostname,
      port: originalLocation.port,
      pathname: originalLocation.pathname,
      search: originalLocation.search,
      hash: originalLocation.hash,
      assign: () => {},
      replace: () => {},
      reload: () => {},
      toString() { return _href; },
    } as unknown as FakeLocation;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: fakeLocation,
    });

    // Mock Tauri APIs with spies so we can assert "NOT called".
    saveDialogSpy = vi.fn(async () => null);
    invokeSpy = vi.fn(async () => undefined);
    vi.doMock('@tauri-apps/api/event', () => ({
      listen: vi.fn(async () => () => {}),
    }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: vi.fn(async () => null),
      save: saveDialogSpy,
    }));
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeSpy }));
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/core');
  });

  it('Cmd+S keydown in web mode does NOT call Tauri saveDialog (the bug — Tauri save flow is irrelevant in web)', async () => {
    // The central #15 pin. Today, `installSaveHandler` is wired
    // unconditionally in bootstrap(); in web mode, pressing
    // Cmd+S triggers the Tauri saveCurrent path which calls
    // saveDialog (since web-mode currentFilePath is null).
    // saveDialog fails silently in the browser; user sees
    // nothing. Fix: gate `installSaveHandler` behind isTauri
    // (or route Cmd+S in web mode through onSaveClick).
    //
    // We pin OUTCOME — saveDialog must NOT be called from a
    // Cmd+S keydown in web mode — without committing to which
    // fix option (a) or (b) the builder picks.
    const { bootstrap } = await import('../main');
    bootstrap();
    // Wait for any async setup the bootstrap kicks off.
    await new Promise((r) => setTimeout(r, 50));

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(
      saveDialogSpy,
      `expected Tauri saveDialog to NOT be called from a web-mode Cmd+S keydown (#15 — without the gate, web users press Cmd+S and silently get nothing because saveDialog fails outside Tauri). Got ${saveDialogSpy.mock.calls.length} call(s).`,
    ).not.toHaveBeenCalled();
  });

  it('Cmd+S keydown in web mode does NOT call invoke("save_md_file", ...) (the Tauri save IPC)', async () => {
    // Belt: even if a future regression skips the saveDialog
    // path (e.g., currentFilePath becomes non-null somehow),
    // the underlying Tauri save IPC must not fire either.
    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 50));

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    const saveCalls = invokeSpy.mock.calls.filter(
      ([cmd]) => cmd === 'save_md_file',
    );
    expect(
      saveCalls.length,
      `expected invoke('save_md_file', ...) to NOT be called from a web-mode Cmd+S keydown (#15 — Tauri IPC is irrelevant outside Tauri runtime). Got ${saveCalls.length} call(s).`,
    ).toBe(0);
  });
});

describe('Issue #92 fix #16 — save-success link text differs from viewer-header link', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('renderSaveSuccess link textContent contains "pull" (case-insensitive — recognizable as PR-specific)', async () => {
    // The fix: link text should distinguish "this is the PR
    // review thread" from the viewer-header's "View on GitHub"
    // (which goes to the file blob view). Pinning the substring
    // "pull" matches "View pull request" / "Open pull request"
    // / "Pull request" / etc. — paraphrasing OK.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/42');

    const link = host.querySelector<HTMLAnchorElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"] a[href]`,
    );
    expect(link, 'precondition: link must exist').not.toBeNull();
    const text = (link!.textContent ?? '').toLowerCase();
    expect(
      text.includes('pull'),
      `expected the link textContent to contain "pull" (case-insensitive — recognizable as PR-specific copy; e.g. "View pull request"). Got: ${JSON.stringify(link!.textContent)}.`,
    ).toBe(true);
  });

  it('renderSaveSuccess link textContent is NOT exactly "View on GitHub" (the viewer-header link text)', async () => {
    // The collision pin. The viewer-header (Issue #90 AC 4.5)
    // renders a link with literal text "View on GitHub" pointing
    // at the file blob view. The save-success banner must NOT
    // duplicate that text — same words on a different target
    // make the user navigate to the wrong place.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/42');

    const link = host.querySelector<HTMLAnchorElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"] a[href]`,
    );
    expect(link, 'precondition: link must exist').not.toBeNull();
    expect(
      (link!.textContent ?? '').trim(),
      `expected the save-success link text to NOT be "View on GitHub" verbatim (#16 — the viewer-header link uses that copy for the file blob view; identical text on the success banner causes navigation confusion). Got: ${JSON.stringify(link!.textContent)}.`,
    ).not.toBe('View on GitHub');
  });
});

describe('Issue #92 fix #17 — conflict banner has a Reload button', () => {
  let host: HTMLDivElement;
  let reloadSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);

    // jsdom 29 ships `Location.reload` as a non-configurable
    // prototype property — `Object.defineProperty(window.location,
    // 'reload', ...)` throws. Same fakeLocation swap-out pattern
    // as the fix #15 / jit-auth tests works around it: replace
    // `window.location` with a fresh object whose `reload` is
    // our spy, then restore the original Location in afterEach.
    reloadSpy = vi.fn();
    originalLocation = window.location;
    let _href = originalLocation.href;
    const fakeLocation: FakeLocation = {
      get href() { return _href; },
      // eslint-disable-next-line accessor-pairs
      set href(v: string) { _href = v; },
      origin: originalLocation.origin,
      protocol: originalLocation.protocol,
      host: originalLocation.host,
      hostname: originalLocation.hostname,
      port: originalLocation.port,
      pathname: originalLocation.pathname,
      search: originalLocation.search,
      hash: originalLocation.hash,
      assign: () => {},
      replace: () => {},
      reload: reloadSpy as unknown as () => void,
      toString() { return _href; },
    } as unknown as FakeLocation;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: fakeLocation,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('renderSaveConflict includes a button labeled with "Reload" alongside the Copy button', async () => {
    // The form-factor pin: the user gets a CLICKABLE reload
    // affordance, not just text instructing them to press Cmd+R.
    // Defense against the "user reads 'please reload' but doesn't
    // know how" UX trap at a high-stakes recovery moment.
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => 'content' });

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_CONFLICT_TESTID}"]`,
    );
    expect(banner, 'precondition: conflict banner must exist').not.toBeNull();

    const buttons = Array.from(banner!.querySelectorAll<HTMLButtonElement>('button'));
    const reloadBtn = buttons.find((b) => {
      const text = (b.textContent ?? '').toLowerCase();
      return text.includes('reload');
    });
    expect(
      reloadBtn,
      `expected a button whose textContent contains "reload" inside the conflict banner (#17 — Reload affordance). Buttons found: ${JSON.stringify(buttons.map((b) => b.textContent))}.`,
    ).toBeDefined();
  });

  it('clicking the Reload button calls window.location.reload()', async () => {
    // The behavior pin: the reload button isn't decorative.
    // Without this, the button could exist but bind to a no-op
    // (or accidentally something destructive). Pin the exact
    // call to window.location.reload.
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => 'content' });

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_CONFLICT_TESTID}"]`,
    );
    const reloadBtn = Array.from(
      banner!.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => {
      const text = (b.textContent ?? '').toLowerCase();
      return text.includes('reload');
    });
    expect(reloadBtn, 'precondition: Reload button must exist').toBeDefined();

    reloadBtn!.click();
    // The click handler may or may not be async; yield once.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    expect(
      reloadSpy,
      'expected window.location.reload to be called when the Reload button is clicked (#17 — the button is the recovery action, not just a label).',
    ).toHaveBeenCalledTimes(1);
  });

  it('the Reload button does NOT trigger reload before being clicked (defensive)', async () => {
    // Floor: rendering the banner alone must NOT call reload.
    // A regression that wired `addEventListener('click',
    // window.location.reload())` (function CALL, not reference)
    // would reload synchronously on render.
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => 'content' });

    expect(
      reloadSpy,
      'expected window.location.reload to NOT fire on banner render (defensive — the reload should only happen on click).',
    ).not.toHaveBeenCalled();
  });
});
