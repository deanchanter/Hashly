import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #92 / AC 6.5 — Frontend conflict UX.
//
// AC text: "on stale-SHA conflict (overlapping edits), display
// 'your edit and an upstream change overlap; please reload' message;
// preserve user's in-memory content so they can copy it out before
// reload (e.g., a 'Copy your edit' button that copies the current
// editor contents to clipboard)."
//
// Surfaces this slice pins:
//
//   1. **Unit**: `renderSaveConflict(host, opts)` exported from
//      `src/save-result.ts`. Creates a `[data-testid="save-conflict"]`
//      banner above the editor with:
//        - User-facing copy containing the literal AC phrase
//          "your edit and an upstream change overlap; please reload"
//          (lowercase + semicolon, verbatim).
//        - A button labeled with "Copy" and "edit" (suggested:
//          "Copy your edit") that, when clicked, calls
//          `navigator.clipboard.writeText` with the live editor
//          content as obtained via `opts.getContent()`.
//      Idempotent + mutually exclusive with `save-error` /
//      `save-success` (cross-pin from AC 6.3 family discipline).
//
//   2. **Integration**: click save → POST /api/save returns
//      `{ok:false, kind:'conflict', message}` → save-conflict
//      banner appears in the DOM. Importantly, the editor's
//      content is PRESERVED across the conflict (no remount, no
//      clear) — so the user can hit Copy and recover.
//
// The literal phrase is locked verbatim (lowercase, semicolon).
// AC 6.7's "ask the dev to add you as a collaborator..." pin set
// the precedent for verbatim user-facing copy.
//
// Tests opt out of vitest.setup.ts's Tauri-default flag — save
// flow is web-mode-only.

// AC 6.5 — VERBATIM. Issue #92 AC body.
const REQUIRED_PHRASE =
  'your edit and an upstream change overlap; please reload';

const SAVE_CONFLICT_TESTID = 'save-conflict';
const SAVE_ERROR_TESTID = 'save-error';
const SAVE_SUCCESS_TESTID = 'save-success';
const SAVE_BTN_TESTID = 'edit-toolbar-save';

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

describe('Issue #92 / AC 6.5 — renderSaveConflict form factor', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('exports `renderSaveConflict` as a named function from src/save-result.ts', async () => {
    // RED until builder adds the export. Floor pattern matches
    // renderSaveError (AC 6.7) and renderSaveSuccess (AC 6.3) —
    // co-located in the save-result module so the click handler
    // can import all three from one place.
    const mod = (await import('../save-result')) as unknown as {
      renderSaveConflict?: unknown;
    };
    expect(
      typeof mod.renderSaveConflict,
      'expected `renderSaveConflict` to be exported as a function from src/save-result.ts (Issue #92 / AC 6.5 — the conflict-banner seam used by the AC 6.1 click handler).',
    ).toBe('function');
  });

  it('creates a [data-testid="save-conflict"] element prepended ABOVE the editor body', async () => {
    // Form-factor pin. Mirrors the AC 6.3 success / AC 6.7 error
    // banner family. Above the editor so the user sees the
    // conflict prompt without scrolling past the body.
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };

    const editorBody = document.createElement('div');
    editorBody.className = 'ProseMirror';
    editorBody.textContent = 'editor body';
    host.appendChild(editorBody);

    renderSaveConflict(host, { getContent: () => '' });

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_CONFLICT_TESTID}"]`,
    );
    expect(
      banner,
      `expected a [data-testid="${SAVE_CONFLICT_TESTID}"] element after renderSaveConflict (AC 6.5 — the dedicated conflict banner surface).`,
    ).not.toBeNull();
    expect(
      host.firstElementChild,
      'expected the save-conflict banner to be the FIRST child of the host so it sits ABOVE the editor body (AC 6.5 banner positioning — mirrors the AC 6.3 / 6.7 family).',
    ).toBe(banner);
  });

  it('the banner textContent contains the AC 6.5 literal phrase verbatim', async () => {
    // The hard contract: AC 6.5 quotes the message as "your edit
    // and an upstream change overlap; please reload" (lowercase,
    // semicolon). Pin verbatim — a copy edit that loses any of
    // these words is a regression. Same precedent as AC 6.7's
    // verbatim phrase pin.
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => '' });

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_CONFLICT_TESTID}"]`,
    );
    expect(banner, 'precondition: banner must exist').not.toBeNull();
    expect(
      banner!.textContent ?? '',
      `expected the banner textContent to contain the AC 6.5 literal phrase verbatim ${JSON.stringify(REQUIRED_PHRASE)}. Got: ${JSON.stringify(banner!.textContent)}.`,
    ).toContain(REQUIRED_PHRASE);
  });

  it('the banner contains a button with copy-action labeling (text mentions both "Copy" and "edit")', async () => {
    // The AC explicitly calls for "a 'Copy your edit' button that
    // copies the current editor contents to clipboard." We accept
    // paraphrasing of the exact label, but require recognizable
    // anchors: button text must mention "Copy" (the action) AND
    // "edit" (the noun — what they're copying). Without these
    // anchors a regression to "Save to clipboard" / "Backup" /
    // any other phrasing would obscure the affordance.
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => '' });

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_CONFLICT_TESTID}"]`,
    );
    expect(banner, 'precondition: banner must exist').not.toBeNull();

    const buttons = Array.from(banner!.querySelectorAll<HTMLButtonElement>('button'));
    expect(
      buttons.length,
      'expected at least one <button> inside the conflict banner (AC 6.5 — the "Copy your edit" affordance).',
    ).toBeGreaterThan(0);
    const copyBtn = buttons.find((b) => {
      const text = (b.textContent ?? '').toLowerCase();
      return text.includes('copy') && text.includes('edit');
    });
    expect(
      copyBtn,
      `expected a button whose textContent mentions BOTH "Copy" and "edit" (AC 6.5 — recognizable anchors for the copy-action affordance). Buttons found: ${JSON.stringify(buttons.map((b) => b.textContent))}.`,
    ).toBeDefined();
  });
});

describe('Issue #92 / AC 6.5 — Copy-button writes editor content to clipboard', () => {
  let host: HTMLDivElement;
  let writeTextSpy: ReturnType<typeof vi.fn>;
  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);

    // jsdom's `navigator.clipboard` may be undefined or read-only.
    // Replace with a spy whose `writeText` we can assert against.
    writeTextSpy = vi.fn(async () => undefined);
    originalClipboard = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(navigator),
      'clipboard',
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText: writeTextSpy },
    });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(
        Object.getPrototypeOf(navigator),
        'clipboard',
        originalClipboard,
      );
    } else {
      // The clipboard property was set directly on navigator, not the
      // prototype — drop our override so the next test starts clean.
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  it('clicking the Copy button calls navigator.clipboard.writeText with the live `getContent()` value', async () => {
    // The recovery contract: the user's in-memory edit must NOT
    // be lost. AC 6.5 explicitly says "preserve user's in-memory
    // content so they can copy it out before reload". The
    // `getContent` callback is the seam; the click handler reads
    // from it FRESH on every click (so a regression that captures
    // the content at render time would lose any subsequent edits
    // the user made before clicking).
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };

    let liveContent = 'editor body at render time\n';
    renderSaveConflict(host, { getContent: () => liveContent });

    // User edits AFTER the banner appears (simulated by mutating
    // the content the getter returns). The fresh-read pin ensures
    // these post-render edits are also captured.
    liveContent = 'edited again after conflict banner appeared\n';

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_CONFLICT_TESTID}"]`,
    );
    const copyBtn = Array.from(
      banner!.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => {
      const t = (b.textContent ?? '').toLowerCase();
      return t.includes('copy') && t.includes('edit');
    });
    expect(copyBtn, 'precondition: copy button must exist').toBeDefined();

    copyBtn!.click();
    // The click handler is async (writeText returns a Promise).
    // Wait one microtask cycle.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    expect(
      writeTextSpy,
      'expected navigator.clipboard.writeText to be called exactly once after the Copy button click (AC 6.5).',
    ).toHaveBeenCalledTimes(1);
    expect(
      writeTextSpy.mock.calls[0]?.[0],
      `expected writeText arg to equal the LIVE getContent() value (AC 6.5 — the fresh-read pin lets post-render edits also reach the clipboard). Expected: ${JSON.stringify(liveContent)}. Got: ${JSON.stringify(writeTextSpy.mock.calls[0]?.[0])}.`,
    ).toBe(liveContent);
  });

  it('clicking the Copy button does NOT remove the conflict banner (the user may need to copy more than once)', async () => {
    // Defensive: a regression that auto-dismisses the banner on
    // copy would defeat "may need to copy more than once" — a user
    // could lose access to the affordance mid-recovery.
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => 'content' });

    const copyBtn = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        `[data-testid="${SAVE_CONFLICT_TESTID}"] button`,
      ),
    ).find((b) => {
      const t = (b.textContent ?? '').toLowerCase();
      return t.includes('copy') && t.includes('edit');
    });
    copyBtn!.click();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    expect(
      host.querySelector(`[data-testid="${SAVE_CONFLICT_TESTID}"]`),
      'expected the conflict banner to STILL be in the DOM after a Copy click (AC 6.5 — the user may need to copy more than once).',
    ).not.toBeNull();
  });
});

describe('Issue #92 / AC 6.5 — banner-family discipline (idempotency + mutual exclusion)', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('idempotent — a second renderSaveConflict call replaces the existing banner instead of stacking', async () => {
    const { renderSaveConflict } = (await import('../save-result')) as unknown as {
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => 'a' });
    renderSaveConflict(host, { getContent: () => 'b' });

    const banners = host.querySelectorAll(
      `[data-testid="${SAVE_CONFLICT_TESTID}"]`,
    );
    expect(
      banners.length,
      `expected exactly ONE [data-testid="${SAVE_CONFLICT_TESTID}"] element after two calls (AC 6.5 banner discipline — stacking would let stale prompts hide the live one).`,
    ).toBe(1);
  });

  it('renderSaveConflict clears existing save-error and save-success banners (mutual exclusion within save-* family)', async () => {
    // Three save-* banners: error / success / conflict. Only ONE
    // should be visible at a time. A retry that ends in conflict
    // must clear any prior error / success.
    const { renderSaveConflict, renderSaveError, renderSaveSuccess } =
      (await import('../save-result')) as unknown as {
        renderSaveConflict: (
          host: HTMLElement,
          opts: { getContent: () => string },
        ) => void;
        renderSaveError: (host: HTMLElement, message: string) => void;
        renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
      };

    renderSaveError(host, 'previous failure');
    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/1');
    // After the success, only the success banner is in the DOM
    // (success clears error per AC 6.3 mutual exclusion).
    expect(
      host.querySelector(`[data-testid="${SAVE_SUCCESS_TESTID}"]`),
      'precondition: success banner must exist before the conflict call',
    ).not.toBeNull();

    renderSaveConflict(host, { getContent: () => '' });

    expect(
      host.querySelector(`[data-testid="${SAVE_ERROR_TESTID}"]`),
      'expected the save-error banner (if any) to be cleared by renderSaveConflict (AC 6.5 mutual exclusion within save-* family).',
    ).toBeNull();
    expect(
      host.querySelector(`[data-testid="${SAVE_SUCCESS_TESTID}"]`),
      'expected the save-success banner to be cleared by renderSaveConflict (AC 6.5 mutual exclusion).',
    ).toBeNull();
    expect(
      host.querySelector(`[data-testid="${SAVE_CONFLICT_TESTID}"]`),
      'expected the conflict banner to render after clearing the others.',
    ).not.toBeNull();
  });

  it('renderSaveSuccess clears existing save-conflict banner (the AC 6.3 mutual-exclusion contract extended to cover save-conflict)', async () => {
    // The AC 6.3 mutual-exclusion test pinned save-error clearing
    // only — that was correct at the time because save-conflict
    // didn't exist. Now that AC 6.5 lands the conflict banner,
    // success-after-conflict (the user reloaded, retried, and
    // succeeded) must also clear the conflict prompt. Without
    // this pin, a stale conflict banner would persist alongside
    // a new success banner — contradictory state.
    const { renderSaveSuccess, renderSaveConflict } = (await import(
      '../save-result'
    )) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => '' });
    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/1');

    expect(
      host.querySelector(`[data-testid="${SAVE_CONFLICT_TESTID}"]`),
      'expected the save-conflict banner to be cleared when renderSaveSuccess fires (AC 6.5 + AC 6.3 mutual-exclusion extension; without this the UI shows contradictory conflict+success at once).',
    ).toBeNull();
  });

  it('renderSaveError clears existing save-conflict banner (mutual exclusion symmetric)', async () => {
    // Symmetric pin: an error after a conflict (e.g., user
    // reloads, retries, hits a different failure) must clear the
    // stale conflict banner.
    const { renderSaveError, renderSaveConflict } = (await import(
      '../save-result'
    )) as unknown as {
      renderSaveError: (host: HTMLElement, message: string) => void;
      renderSaveConflict: (
        host: HTMLElement,
        opts: { getContent: () => string },
      ) => void;
    };
    renderSaveConflict(host, { getContent: () => '' });
    renderSaveError(host, 'something else broke');

    expect(
      host.querySelector(`[data-testid="${SAVE_CONFLICT_TESTID}"]`),
      'expected the save-conflict banner to be cleared when renderSaveError fires (AC 6.5 mutual-exclusion symmetric extension).',
    ).toBeNull();
  });
});

describe('Issue #92 / AC 6.5 — click → POST /api/save 409 conflict → conflict banner appears', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    window.history.replaceState(
      {},
      '',
      '/?repo=foo/bar&path=specs/spec.md&ref=main',
    );

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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  async function mountAndEnterEditMode(
    content: string,
    opts: { baseSha?: string } = {},
  ): Promise<HTMLButtonElement> {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, content);
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (
        h: HTMLElement,
        opts?: { baseSha?: string },
      ) => Promise<void>;
    };
    await enterEditMode(host, opts);
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-testid="${SAVE_BTN_TESTID}"]`,
    );
    if (!btn) throw new Error('precondition: save button must exist');
    return btn;
  }

  it('on a 409 {kind:"conflict"} response, the save-conflict banner appears', async () => {
    // End-to-end integration: the AC 6.1 click handler must route
    // a kind:'conflict' result to renderSaveConflict. Without this
    // wiring, the worker correctly returns conflict but the user
    // sees nothing on the frontend.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'conflict',
          message: 'An upstream change advanced this file...',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode('# Spec\n\nbody\n', {
      baseSha: 'CAPTURED_BASE_SHA_abc123',
    });
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_CONFLICT_TESTID}"]`,
    );
    expect(
      banner,
      `expected a [data-testid="${SAVE_CONFLICT_TESTID}"] banner after a 409 conflict response (AC 6.5 — click handler must call renderSaveConflict on kind:'conflict').`,
    ).not.toBeNull();
    // The banner copy must carry the literal AC 6.5 phrase even
    // when the worker's message text is different. The frontend
    // owns user-facing copy; the worker's message is for logs.
    expect(
      banner!.textContent ?? '',
      `expected the rendered conflict banner to contain the AC 6.5 literal phrase ${JSON.stringify(REQUIRED_PHRASE)} regardless of the worker's message text. Got: ${JSON.stringify(banner!.textContent)}.`,
    ).toContain(REQUIRED_PHRASE);
  });

  it('after a conflict, getViewerMarkdown(host) STILL returns the user\'s content (preserve in-memory edit)', async () => {
    // The "preserve user's in-memory content" pin from the AC.
    // A regression that re-mounts the viewer / clears the editor
    // on conflict would lose the user's edit BEFORE they can
    // copy it out. Pin: the live editor body is still readable
    // via getViewerMarkdown after the conflict response is
    // processed.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'conflict',
          message: 'stale',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode('# Spec\n\noriginal\n', {
      baseSha: 'CAPTURED_BASE_SHA_abc123',
    });

    const { getViewerMarkdown } = (await import('../viewer')) as unknown as {
      getViewerMarkdown: (h: HTMLElement) => string | null;
    };
    const before = getViewerMarkdown(host);
    expect(
      before,
      'precondition: getViewerMarkdown must return content before the click',
    ).not.toBeNull();

    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const after = getViewerMarkdown(host);
    expect(
      after,
      'expected getViewerMarkdown to STILL return content after the conflict response (AC 6.5 — preserve user\'s in-memory edit so they can copy it out).',
    ).not.toBeNull();
    expect(
      after,
      'expected the editor content to be UNCHANGED across the conflict (no remount, no clear).',
    ).toBe(before);
  });
});
