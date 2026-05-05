import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #92 fix-loop iter-1 — wire all error kinds + prUrl scheme +
// clearSaveBanners synchronous (fixes #2, #13, #14).
//
// AC for adversarial-reviewer's bundle:
//
//   #2 (AC 6.7 closure at the UI layer) — today the click handler
//   only branches on `result.ok` and `result.kind === 'conflict'`.
//   The `no-write`, `network`, `other` cases fall through to
//   nothing. `renderSaveError` exists but has zero production
//   callers. AC 6.7 (no-write must show literal phrase to the user)
//   is unfulfilled at the UI layer. Fix: extend the switch to
//   render `renderSaveError` for `no-write` / `network` / `other`,
//   plus a special-cased 401-session-expired path with a recovery
//   hint.
//
//   #13 (prUrl scheme validation) — `link.setAttribute('href',
//   prUrl)` with no scheme check. Empty string + target="_blank"
//   destroys unsaved edits on click; `javascript:` URI would
//   execute attacker code with the user's session. Defense-in-
//   depth: validate `^https://github\.com/` before rendering.
//
//   #14 (clear stale banners synchronously) — today
//   `clearSaveBanners` only fires from inside renderers AFTER
//   fetch resolves. A user retrying after a conflict / error
//   sees the stale banner persist during the network round-trip,
//   suggesting the retry is doing nothing. Fix: clear stale
//   banners synchronously at the top of `onSaveClick`, BEFORE
//   the fetch.
//
// Each fix is pinned by behavior: post-condition DOM state +
// banner-render outcomes. We don't pin the impl shape (whether
// submitSave returns a new `unauth` kind for 401 OR the click
// handler reads response status separately — either is
// acceptable, just pin the user-visible banner copy).

const SAVE_BTN_TESTID = 'edit-toolbar-save';
const SAVE_ERROR_TESTID = 'save-error';
const SAVE_SUCCESS_TESTID = 'save-success';

// AC 6.7 verbatim phrase — cross-pinned with the worker's no-write
// message and the existing save-flow-no-write.test.ts.
const NO_WRITE_PHRASE =
  'ask the dev to add you as a collaborator (or install the Hashly GitHub App on the repo)';

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

describe('Issue #92 fix #2 — click handler wires all error kinds to renderSaveError', () => {
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

  async function mountAndEnterEditMode(): Promise<HTMLButtonElement> {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n\nbody\n');
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (
        h: HTMLElement,
        opts?: { baseSha?: string },
      ) => Promise<void>;
    };
    await enterEditMode(host, { baseSha: 'CAPTURED_BASE_SHA_abc123' });
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-testid="${SAVE_BTN_TESTID}"]`,
    );
    if (!btn) throw new Error('precondition: save button must exist');
    return btn;
  }

  it('on a kind:"no-write" response, the click handler renders the save-error banner with the AC 6.7 literal phrase', async () => {
    // The central fix #2 pin — closes the AC 6.7 UI-layer gap.
    // Today the worker correctly returns kind:'no-write' with the
    // literal phrase, but the click handler discards the message
    // entirely (no banner). User sees "Saving…" → "Save" with
    // no signal that the save was rejected for permission reasons.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'no-write',
          message: `You don't have write access to this repository — ${NO_WRITE_PHRASE}.`,
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode();
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_ERROR_TESTID}"]`,
    );
    expect(
      banner,
      'expected a [data-testid="save-error"] banner after a kind:"no-write" response (#2 — AC 6.7 closure at the UI layer; without this the message never reaches the user).',
    ).not.toBeNull();
    expect(
      banner!.textContent ?? '',
      `expected the rendered banner to carry the AC 6.7 literal phrase verbatim ${JSON.stringify(NO_WRITE_PHRASE)}. Got: ${JSON.stringify(banner!.textContent)}.`,
    ).toContain(NO_WRITE_PHRASE);
  });

  it('on a kind:"network" response (fetch threw), the click handler renders the save-error banner with network-related copy', async () => {
    // Per the team-lead's brief: network errors get "your network
    // seems to be offline; please try again". We pin recognizable
    // anchor words ("network" / "offline" / "try again" — at
    // least one) so the impl can paraphrase but a generic "save
    // failed" with no diagnostic clue is rejected.
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const btn = await mountAndEnterEditMode();
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_ERROR_TESTID}"]`,
    );
    expect(
      banner,
      'expected a save-error banner on kind:"network" (#2 — defense floor; without this the offline user gets no banner and no signal).',
    ).not.toBeNull();
    const text = (banner!.textContent ?? '').toLowerCase();
    const hasAnchor =
      text.includes('network') ||
      text.includes('offline') ||
      text.includes('try again') ||
      text.includes('connection');
    expect(
      hasAnchor,
      `expected the network-error banner to contain "network" / "offline" / "try again" / "connection" so the user understands the failure category. Got: ${JSON.stringify(banner!.textContent)}.`,
    ).toBe(true);
  });

  it('on a kind:"other" response, the click handler renders the save-error banner with the worker\'s message', async () => {
    // The catch-all path. The worker's "GitHub <step> failed:
    // HTTP <status>" message is more useful than silence, even
    // if not pretty.
    const otherMessage = 'GitHub PR open failed: HTTP 502';
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, kind: 'other', message: otherMessage }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode();
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_ERROR_TESTID}"]`,
    );
    expect(
      banner,
      'expected a save-error banner on kind:"other" (#2 — catch-all; the worker\'s diagnostic message must surface).',
    ).not.toBeNull();
    expect(
      banner!.textContent ?? '',
      `expected the banner to contain the worker's message verbatim ${JSON.stringify(otherMessage)}. Got: ${JSON.stringify(banner!.textContent)}.`,
    ).toContain(otherMessage);
  });

  it('on a 401 response (session expired mid-edit), the click handler renders the save-error banner with session-expired copy', async () => {
    // Per team-lead: "your session expired — please sign back in"
    // with a recovery hint. We pin recognizable anchors:
    // "session" AND ("sign" OR "expired") — distinguishes it
    // from generic "save failed" copy and ensures the user knows
    // the remedy (sign in again).
    fetchSpy.mockResolvedValue(
      new Response('unauthorized', {
        status: 401,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const btn = await mountAndEnterEditMode();
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_ERROR_TESTID}"]`,
    );
    expect(
      banner,
      'expected a save-error banner on a 401 response (#2 — session-expired path; without this the user just sees "Save" → "Save" with no hint they need to re-auth).',
    ).not.toBeNull();
    const text = (banner!.textContent ?? '').toLowerCase();
    const hasSession = text.includes('session') || text.includes('sign');
    expect(
      hasSession,
      `expected the 401 banner to contain "session" / "sign" anchor (recovery hint). Got: ${JSON.stringify(banner!.textContent)}.`,
    ).toBe(true);
  });
});

describe('Issue #92 fix #13 — renderSaveSuccess validates prUrl scheme', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('renderSaveSuccess with a valid `https://github.com/...` URL renders the link (positive control)', async () => {
    // Cross-pin: don't accidentally regress the AC 6.3 happy path.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    const goodUrl = 'https://github.com/foo/bar/pull/42';
    renderSaveSuccess(host, goodUrl);

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"]`,
    );
    const link = banner?.querySelector<HTMLAnchorElement>('a[href]');
    expect(link, 'precondition: link must render for valid github URL').not.toBeNull();
    expect(link!.getAttribute('href')).toBe(goodUrl);
  });

  it('renderSaveSuccess with a `javascript:` URL does NOT render an active link (XSS defense)', async () => {
    // Defense-in-depth: even though the prUrl flows from the
    // worker (server-side trusted), any future regression in the
    // server response shape (or a MITM rewriting the response)
    // could land a `javascript:alert(...)` URL in this seam. The
    // banner has target="_blank" so the link executes immediately
    // on click (no extra confirmation). Validate at render time.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    renderSaveSuccess(host, 'javascript:alert("xss")');

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"]`,
    );
    expect(
      banner,
      'expected the success banner to STILL render (the user did save successfully) — but without the malicious link.',
    ).not.toBeNull();

    const link = banner!.querySelector<HTMLAnchorElement>('a[href]');
    if (link !== null) {
      const href = link.getAttribute('href') ?? '';
      expect(
        href.toLowerCase().startsWith('javascript:'),
        `expected NO javascript: link in the rendered banner (#13 XSS defense). If a link is rendered, its href must NOT start with "javascript:". Got: ${JSON.stringify(href)}.`,
      ).toBe(false);
    }
    // Either no link at all OR a fallback link (no href / different
    // href) — both are acceptable. The pin is "no javascript: href".
  });

  it('renderSaveSuccess with an empty prUrl does NOT render a clickable link', async () => {
    // The silent-data-loss guard: if a malformed worker response
    // somehow produced ok:true with empty prUrl (the slice-2 #3
    // cascade fix should now prevent this, but defense in depth),
    // the success banner must NOT have a clickable link with
    // empty href. Clicking an empty-href `target="_blank"` link
    // can land on `about:blank` or destroy unsaved edits depending
    // on browser behavior.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    renderSaveSuccess(host, '');

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"]`,
    );
    expect(banner, 'banner must still render').not.toBeNull();

    const link = banner!.querySelector<HTMLAnchorElement>('a[href]');
    if (link !== null) {
      const href = link.getAttribute('href') ?? '';
      expect(
        href.length > 0,
        `expected NO empty-href link (#13 silent-data-loss guard). If a link is rendered it must carry a non-empty href. Got: ${JSON.stringify(href)}.`,
      ).toBe(true);
    }
  });

  it('renderSaveSuccess with a non-github URL (e.g., https://evil.com/foo) does NOT render that link', async () => {
    // Belt for the scheme check: even an `https://` URL pointing
    // away from github.com is suspicious. The prUrl seam
    // canonically flows from the GitHub PR API; a non-github
    // host indicates either a worker bug or response tampering.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    renderSaveSuccess(host, 'https://evil.com/foo/bar/pull/1');

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"]`,
    );
    expect(banner, 'banner must still render').not.toBeNull();

    const link = banner!.querySelector<HTMLAnchorElement>('a[href]');
    if (link !== null) {
      const href = link.getAttribute('href') ?? '';
      expect(
        href.startsWith('https://github.com/'),
        `expected the rendered link href (if any) to be on github.com (#13 — prUrl seam canonically flows from GitHub PR API; non-github host is a tampering signal). Got: ${JSON.stringify(href)}.`,
      ).toBe(true);
    }
  });
});

describe('Issue #92 fix #14 — clearSaveBanners runs synchronously at the top of onSaveClick', () => {
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
    // Never-resolving fetch so the test can inspect state mid-flight.
    fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
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

  it('clicking save with a stale save-error banner present clears the banner BEFORE the fetch resolves', async () => {
    // The central UX pin: a user retrying after a failed save
    // expects immediate visual confirmation that "we heard you,
    // we're working on it". Today, the stale banner stays in
    // the DOM during the entire round-trip and only gets cleared
    // when the next renderSave* fires. Fix: clearSaveBanners
    // runs synchronously at the top of onSaveClick, before the
    // network call.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n\nbody\n');
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (
        h: HTMLElement,
        opts?: { baseSha?: string },
      ) => Promise<void>;
    };
    await enterEditMode(host, { baseSha: 'CAPTURED_BASE_SHA_abc123' });

    // Pre-seed a stale error banner (as if a prior save failed).
    const { renderSaveError } = (await import('../save-result')) as unknown as {
      renderSaveError: (h: HTMLElement, m: string) => void;
    };
    renderSaveError(host, 'previous failure');
    expect(
      host.querySelector(`[data-testid="${SAVE_ERROR_TESTID}"]`),
      'precondition: stale save-error banner must be in the DOM',
    ).not.toBeNull();

    const btn = document.querySelector<HTMLButtonElement>(
      `[data-testid="${SAVE_BTN_TESTID}"]`,
    );
    btn!.click();

    // Yield ONE microtask cycle for the synchronous IIFE
    // setup (button-state mutation + clearSaveBanners) to
    // execute before the awaited fetch starts. The fetch
    // never resolves, so any post-fetch banner-clear cannot
    // be the cause of any change here.
    await Promise.resolve();
    await Promise.resolve();

    expect(
      host.querySelector(`[data-testid="${SAVE_ERROR_TESTID}"]`),
      'expected the stale save-error banner to be REMOVED synchronously at the top of onSaveClick (#14 — UX: user retry needs immediate visual confirmation; without this, the stale banner persists through the entire fetch round-trip).',
    ).toBeNull();
  });
});
