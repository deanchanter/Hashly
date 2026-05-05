import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #92 / AC 6.1 — Save button click handler.
//
// "Implement Save button that, when clicked, sends the current editor
// content + base SHA to a backend endpoint."
//
// Up to AC 6.7 the toolbar Save button was a deliberately disabled
// placeholder (Issue #91 fix-loop-1 / fix #6, now retired in this
// commit — see the tombstone in `fix-loop-1.test.ts`). AC 6.1 enables
// it and wires the click handler to call `submitSave` from
// `src/save-flow.ts` (committed at AC 6.7) with:
//
//   - content  = `getViewerMarkdown(host)` (the live editor body
//                with byte-equal frontmatter prepended; AC 5.6
//                cross-pin)
//   - baseSha  = the SHA captured at edit-mode entry (snapshot
//                semantics — required for AC 6.4 stale-SHA detection;
//                pinned via the new `enterEditMode(host, opts?:
//                {baseSha?: string})` second-arg seam)
//   - repo / path / ref = parsed from `document.URL` via parseSpecUrl
//
// We deliberately do NOT pin where the bootstrap acquires baseSha
// (extending fetchSpec, separate contents-fetch in attemptEditAction,
// etc.) — that's a wiring choice. AC 6.1 pins ONLY the
// click-handler ↔ submitSave plumbing; AC 6.4's tests will pin the
// actual capture mechanism if they need to.
//
// Pinned testid: `edit-toolbar-save` (carries over from #91 — already
// rendered by enterEditMode; the placeholder `disabled = true` flips
// to `disabled = false` in this slice).
//
// Tests opt out of vitest.setup.ts's Tauri-default flag — the save
// flow is a web-mode-only path.

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

describe('Issue #92 / AC 6.1 — Save button is enabled in edit mode', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('after enterEditMode, the [data-testid="edit-toolbar-save"] button has disabled === false (the AC 6.1 inversion of the #91 fix-loop-1 / fix #6 placeholder)', async () => {
    // The placeholder pin (disabled === true) is retired in this
    // commit. Once the click handler is wired, the button must
    // behave as a real save trigger — that means NOT visually
    // disabled. Without this inversion, a user who clicks would
    // see no response and assume save is broken.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n\nbody\n');
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (h: HTMLElement) => Promise<void>;
    };
    await enterEditMode(host);

    const saveBtn = document.querySelector<HTMLButtonElement>(
      `[data-testid="${SAVE_BTN_TESTID}"]`,
    );
    expect(
      saveBtn,
      'precondition: save button must exist after enterEditMode (#91 AC 5.1 cross-pin).',
    ).not.toBeNull();
    expect(
      saveBtn!.disabled,
      'expected button.disabled === false after enterEditMode (Issue #92 / AC 6.1 — #91 fix #6 placeholder inversion: the click handler is now wired).',
    ).toBe(false);
  });

  it('after enterEditMode, the save button does NOT carry aria-disabled="true" (a11y carries the inversion too)', async () => {
    // a11y belt — screen readers must announce the button as
    // actionable, not disabled. A regression that flips `disabled`
    // but leaves `aria-disabled="true"` would silently mislead
    // assistive-tech users.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec');
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (h: HTMLElement) => Promise<void>;
    };
    await enterEditMode(host);

    const saveBtn = document.querySelector<HTMLButtonElement>(
      `[data-testid="${SAVE_BTN_TESTID}"]`,
    );
    const ariaDisabled = saveBtn!.getAttribute('aria-disabled');
    expect(
      ariaDisabled === null || ariaDisabled === 'false',
      `expected aria-disabled to be absent or "false" after enterEditMode (Issue #92 / AC 6.1 — a11y carries the disabled inversion). Got: ${JSON.stringify(ariaDisabled)}.`,
    ).toBe(true);
  });
});

describe('Issue #92 / AC 6.1 — Save button click → POST /api/save', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Pin a representative spec URL so parseSpecUrl returns a
    // known repo/path/ref triple. The click handler reads from
    // document.URL (same as checkWriteAccess in AC 5.5).
    window.history.replaceState(
      {},
      '',
      '/?repo=foo/bar&path=specs/v0.3-web-pivot/spec.md&ref=main',
    );

    // Sandbox window.location so any inadvertent assigns don't
    // navigate the test runner.
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

  /**
   * Mount viewer → enter edit mode (with optional baseSha seed) →
   * return the live save button. Centralizes the boilerplate so the
   * individual ACs read cleanly.
   */
  async function mountAndEnterEditMode(
    initialContent: string,
    opts?: { baseSha?: string },
  ): Promise<HTMLButtonElement> {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, initialContent);
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
    if (!btn) {
      throw new Error('precondition: save button must exist after enterEditMode');
    }
    return btn;
  }

  it('clicking the Save button fires exactly one fetch to /api/save with method POST', async () => {
    // Floor: click → POST /api/save. Not GET (would not carry the
    // body fields). Not multiple paths (would defeat the in-flight
    // lock pinned later). Not /save or /api/saves or any close
    // typo — the URL is exact.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode('# Spec\n\nbody\n', {
      baseSha: 'CAPTURED_BASE_SHA_abc123',
    });
    btn.click();

    // The click handler is async (fires submitSave in the
    // background). Wait for the microtask queue + the fetch
    // microtask before counting.
    await new Promise((r) => setTimeout(r, 30));

    const saveCalls = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === '/api/save',
    );
    expect(
      saveCalls.length,
      `expected exactly ONE fetch to /api/save after clicking the save button (Issue #92 / AC 6.1 — the click handler must fire submitSave). Got ${saveCalls.length}.`,
    ).toBe(1);

    const [, init] = saveCalls[0]!;
    const sentInit = (init ?? {}) as RequestInit;
    expect(
      sentInit.method,
      'expected method: "POST" (AC 6.1 — submitSave POSTs /api/save). A GET would not carry the content / baseSha fields.',
    ).toBe('POST');
  });

  it('the POST /api/save body carries the live editor content from getViewerMarkdown(host)', async () => {
    // Pin: the click handler reads from the LIVE editor (via
    // `getViewerMarkdown(host)`), not from a stale closure. Without
    // this pin, an impl that captures `defaultValueCtx` at mount
    // time and sends THAT as content would silently round-trip the
    // pre-edit body and lose the user's actual edits.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const initialContent =
      '---\ntitle: Spec\n---\n# Hello\n\noriginal body\n';
    const btn = await mountAndEnterEditMode(initialContent, {
      baseSha: 'CAPTURED_BASE_SHA_abc123',
    });

    // Read what getViewerMarkdown reports — that's exactly what
    // the click handler must serialize. We don't dispatch an edit
    // here; the snapshot at this point is the canonical "what the
    // user has on screen". The frontmatter byte-equal contract
    // (AC 5.6) carries through.
    const { getViewerMarkdown } = (await import('../viewer')) as unknown as {
      getViewerMarkdown: (h: HTMLElement) => string | null;
    };
    const expectedContent = getViewerMarkdown(host);
    expect(
      expectedContent,
      'precondition: getViewerMarkdown must return a string for a mounted host (AC 5.6 cross-pin).',
    ).not.toBeNull();

    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const saveCalls = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === '/api/save',
    );
    expect(saveCalls.length, 'precondition: a save POST must have fired').toBe(1);
    const init = (saveCalls[0]![1] ?? {}) as RequestInit;
    expect(typeof init.body).toBe('string');
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(
      parsed.content,
      `expected the POST body's "content" field to equal getViewerMarkdown(host) verbatim (AC 6.1 — the click handler must read the LIVE editor, not a stale closure; AC 5.6 byte-equal frontmatter rides through). Expected: ${JSON.stringify(expectedContent)}. Got: ${JSON.stringify(parsed.content)}.`,
    ).toBe(expectedContent);
  });

  it('the POST /api/save body carries repo/path/ref parsed from document.URL', async () => {
    // Pin: the click handler reads URL coords via parseSpecUrl, not
    // from a hardcoded constant or from the viewer-header DOM. The
    // representative URL from beforeEach has repo=foo/bar,
    // path=specs/v0.3-web-pivot/spec.md (URL-encoded slashes
    // preserved), ref=main. All three must round-trip into the
    // POST body verbatim.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode('# Spec', {
      baseSha: 'CAPTURED_BASE_SHA_abc123',
    });
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const saveCalls = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === '/api/save',
    );
    expect(saveCalls.length, 'precondition: a save POST must have fired').toBe(1);
    const init = (saveCalls[0]![1] ?? {}) as RequestInit;
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(
      parsed.repo,
      `expected body.repo to be "foo/bar" (parsed from ?repo=foo/bar in document.URL). Got: ${JSON.stringify(parsed.repo)}.`,
    ).toBe('foo/bar');
    expect(
      parsed.path,
      `expected body.path to be "specs/v0.3-web-pivot/spec.md" (parsed from ?path=... in document.URL). Got: ${JSON.stringify(parsed.path)}.`,
    ).toBe('specs/v0.3-web-pivot/spec.md');
    expect(
      parsed.ref,
      `expected body.ref to be "main" (parsed from ?ref=main in document.URL). Got: ${JSON.stringify(parsed.ref)}.`,
    ).toBe('main');
  });

  it('when enterEditMode receives `{baseSha}`, the POST body carries that baseSha verbatim', async () => {
    // The seam pin: AC 6.1 wires the second `opts.baseSha` argument
    // to enterEditMode through to the click handler. The bootstrap
    // (or AC 6.4 wiring) is responsible for capturing the SHA and
    // calling enterEditMode with it; this test pins the in-between
    // pipeline. Without baseSha plumbing, AC 6.4 stale-SHA detection
    // would have nothing to compare against.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode('# Spec', {
      baseSha: 'CAPTURED_BASE_SHA_abc123',
    });
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const saveCalls = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === '/api/save',
    );
    expect(saveCalls.length, 'precondition: a save POST must have fired').toBe(1);
    const init = (saveCalls[0]![1] ?? {}) as RequestInit;
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(
      parsed.baseSha,
      `expected body.baseSha to equal the value passed to enterEditMode(host, {baseSha}) (AC 6.1 + AC 6.4 cross-pin — the seam between SHA capture and stale-SHA detection). Got: ${JSON.stringify(parsed.baseSha)}.`,
    ).toBe('CAPTURED_BASE_SHA_abc123');
  });

  it('when enterEditMode is called WITHOUT baseSha, click does NOT fire a POST (safe default — refuses to save without a stale-SHA anchor)', async () => {
    // Defensive default: AC 6.4 stale-SHA detection fundamentally
    // depends on the frontend's claim "I started from this SHA".
    // Sending an empty / undefined baseSha would either crash the
    // worker or silently disable conflict detection — both bad.
    // The safest behavior when baseSha is unknown: refuse to save.
    //
    // This pin forces the bootstrap (AC 6.1's calling code) to
    // ACTUALLY capture and forward a baseSha before the user can
    // save. Without this pin, an impl that "just sends whatever's
    // there" would silently let users overwrite upstream changes
    // they never saw.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode('# Spec'); // no baseSha
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const saveCalls = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === '/api/save',
    );
    expect(
      saveCalls.length,
      `expected ZERO POST /api/save calls when no baseSha was supplied to enterEditMode (AC 6.1 + AC 6.4 safe default — without a stale-SHA anchor the worker can't detect upstream conflicts; refusing to save protects the user from silently overwriting changes they never saw). Got ${saveCalls.length}.`,
    ).toBe(0);
  });

  it('clicking the save button twice in rapid succession fires exactly ONE POST (in-flight lock)', async () => {
    // Defensive: a user who double-taps must not fire two
    // duplicate PR-creating saves. Pattern matches the AC 5.2
    // sync-race lock in attemptEditAction (module-local pending
    // promise). Without this, the worker would receive two saves,
    // create two branches, and open two PRs from a single user
    // intent.
    let resolveFirst: ((response: Response) => void) | null = null;
    fetchSpy.mockImplementation(() => {
      // First call returns a slow promise we can resolve later;
      // any subsequent call returns a fast 200 (which we use to
      // detect a regression: if we see >1 actual call, the lock
      // was bypassed).
      return new Promise<Response>((resolve) => {
        if (!resolveFirst) {
          resolveFirst = resolve;
        } else {
          resolve(
            new Response(
              JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/2' }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
      });
    });

    const btn = await mountAndEnterEditMode('# Spec', {
      baseSha: 'CAPTURED_BASE_SHA_abc123',
    });
    // Two synchronous clicks — first fires submitSave; the lock
    // must reject the second.
    btn.click();
    btn.click();
    // Yield a few microtasks; the second click should NOT have
    // produced a second fetch by now.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    const saveCallsBeforeFirstResolves = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === '/api/save',
    );
    expect(
      saveCallsBeforeFirstResolves.length,
      `expected exactly ONE POST /api/save from two synchronous clicks while the first is in-flight (AC 6.1 in-flight lock). Without this guard, a double-tap creates duplicate PRs. Got ${saveCallsBeforeFirstResolves.length}.`,
    ).toBe(1);

    // Now resolve the first fetch and confirm we still see only one call.
    resolveFirst!(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await new Promise((r) => setTimeout(r, 30));

    const saveCallsAfter = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === '/api/save',
    );
    expect(
      saveCallsAfter.length,
      `expected the POST count to remain 1 even after the first save resolves (AC 6.1 — the second click was dropped, not queued). Got ${saveCallsAfter.length}.`,
    ).toBe(1);
  });

  it('clicking the save button when no edit mode is active is a no-op (no fetch)', async () => {
    // Defensive: the placeholder Save button only renders inside
    // the edit-toolbar (Issue #91 AC 5.1), so this case shouldn't
    // arise in production. But synthesizing a click on a manually-
    // injected button (or a button that survives an exitEditMode
    // race) must NOT fire a save. Pin the safe floor.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    // Manually inject a save-shaped button without enterEditMode.
    const stray = document.createElement('button');
    stray.setAttribute('data-testid', SAVE_BTN_TESTID);
    document.body.appendChild(stray);

    stray.click();
    await new Promise((r) => setTimeout(r, 30));

    const saveCalls = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === '/api/save',
    );
    expect(
      saveCalls.length,
      `expected ZERO fetches from a click on a manually-injected save-testid button (AC 6.1 — the click handler must scope to the edit-mode toolbar's button, not all save-testid buttons globally). Got ${saveCalls.length}.`,
    ).toBe(0);
  });
});
