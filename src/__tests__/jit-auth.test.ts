import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Editor } from '@milkdown/core';

// Issue #91 / AC 5.2 — JIT auth pause-and-redirect.
//
// "On first edit attempt by an unauthenticated user, pause the
// action, redirect to backend `/auth/start?return=${encodeURIComponent
// (window.location.href)}`."
//
// Pinned testable seam — `attemptEditAction(host: HTMLElement):
// Promise<void>`, exported from `src/edit-mode.ts`. Behavior:
//
//   1. fetch('/api/session-status', { credentials: 'same-origin' })
//   2a. 401 (or any non-2xx)  → redirect via window.location.assign
//       (or .replace) to `/auth/start?return=<encoded current href>`.
//       Do NOT enter edit mode (the read-only DOM stays read-only).
//   2b. 200                    → await enterEditMode(host).
//       Do NOT redirect.
//
// We pin OUTCOMES (fetch called once, redirect URL right, DOM
// flipped or not) so the builder is free to wire the trigger
// (button click, keydown listener, beforeinput handler, etc.) however.
//
// The tests opt out of vitest.setup.ts's Tauri-default flag because
// JIT auth is a web-mode-only flow.

// jsdom's window.location ships with non-configurable assign/replace.
// To spy them we have to replace the WHOLE `window.location` object via
// `Object.defineProperty(window, 'location', ...)`. The replacement is
// a snapshot — `href`, `pathname`, etc. are captured at mock-setup time
// (we call `replaceState` first so the snapshot reflects the
// representative test URL). After the test, we restore the original
// `window.location` reference.
//
// We also pin `href` as a settable property so an impl that does
// `window.location.href = url` (as opposed to `.assign(url)` /
// `.replace(url)`) is also captureable via the same hrefSpy. All three
// shapes are valid browser-redirect idioms; the test accepts whichever.

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

describe('Issue #91 / AC 5.2 — attemptEditAction (JIT auth + flip)', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let assignSpy: ReturnType<typeof vi.fn>;
  let replaceSpy: ReturnType<typeof vi.fn>;
  let hrefSetterSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;
  let initialHref: string;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);

    // Mock fetch globally so we can pin per-test the session-status
    // response without touching the network.
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Set the URL to a representative spec URL with query params so
    // the return-target encoding test has something meaningful to
    // round-trip. Done BEFORE the location mock so the snapshot
    // captures the right URL.
    window.history.replaceState({}, '', '/?repo=foo/bar&path=specs/v0.3-web-pivot/spec.md&ref=main');

    // Snapshot the live location, then replace `window.location` with
    // a spied-up fake. The fake mirrors the original's url-shaped
    // fields and pins `assign`, `replace`, AND `href` setter as spies.
    originalLocation = window.location;
    initialHref = originalLocation.href;
    assignSpy = vi.fn();
    replaceSpy = vi.fn();
    hrefSetterSpy = vi.fn();

    let _href = initialHref;
    const fakeLocation: FakeLocation = {
      get href() { return _href; },
      // eslint-disable-next-line accessor-pairs
      set href(v: string) {
        _href = v;
        (hrefSetterSpy as unknown as (s: string) => void)(v);
      },
      origin: originalLocation.origin,
      protocol: originalLocation.protocol,
      host: originalLocation.host,
      hostname: originalLocation.hostname,
      port: originalLocation.port,
      pathname: originalLocation.pathname,
      search: originalLocation.search,
      hash: originalLocation.hash,
      assign: assignSpy as unknown as (url: string) => void,
      replace: replaceSpy as unknown as (url: string) => void,
      reload: () => {},
      toString() { return _href; },
    } as unknown as FakeLocation;

    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: fakeLocation,
    });

    // Pre-mount a read-only viewer so attemptEditAction has a real
    // host with state to flip / leave alone.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n\nbody prose\n');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  // Helper: collect every captured redirect URL across all three
  // accepted idioms (assign / replace / href setter).
  const redirectCalls = (): string[] => [
    ...assignSpy.mock.calls.map((c) => String(c[0])),
    ...replaceSpy.mock.calls.map((c) => String(c[0])),
    ...hrefSetterSpy.mock.calls.map((c) => String(c[0])),
  ];

  it('exports `attemptEditAction` as a named function from src/edit-mode.ts', async () => {
    // RED until builder adds the export. The "is a function" floor
    // forbids a regression where `attemptEditAction` gets exported
    // as a literal value (e.g. `export const attemptEditAction =
    // async () => {}` is fine, but `export const attemptEditAction
    // = SomeUrl;` would silently typecheck against the cast).
    const mod = (await import('../edit-mode')) as unknown as {
      attemptEditAction?: unknown;
    };
    expect(
      typeof mod.attemptEditAction,
      'expected `attemptEditAction` to be exported as a function from src/edit-mode.ts (Issue #91 AC 5.2 — the JIT auth seam).',
    ).toBe('function');
  });

  it('calls fetch on `/api/session-status` exactly once with credentials: "same-origin"', async () => {
    // Pin the request URL AND the credentials option so the cookie
    // (HttpOnly, browser-attached) actually rides along — without
    // `same-origin`, fetch defaults to `same-origin` in modern
    // browsers but explicit-is-better-than-implicit, and a future
    // refactor that adds a base URL must keep credentials carrying.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    expect(
      fetchSpy,
      'expected exactly one fetch call (the session-status check; AC 5.2 must NOT make redundant requests).',
    ).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(
      String(url),
      'expected the fetch URL to be /api/session-status (AC 5.2 — the JIT auth check hits the worker endpoint).',
    ).toBe('/api/session-status');
    const sentInit = (init ?? {}) as RequestInit;
    expect(
      sentInit.credentials,
      'expected credentials: "same-origin" so the HttpOnly session cookie is included (AC 5.2 — without it the worker can\'t see the session and would return 401 even for authed users).',
    ).toBe('same-origin');
  });

  it('on 401, redirects to `/auth/start?return=<encoded current href>` (assign OR replace)', async () => {
    // The core RED-path pin. We accept either window.location.assign
    // or window.location.replace — `replace` is conventional for
    // auth bounces (no history entry for the redirect), `assign` is
    // simpler. Either is defensible.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const calls = redirectCalls();
    expect(
      calls.length,
      `expected exactly ONE redirect call (assign / replace / href setter) on the 401 path; got ${calls.length}. AC 5.2 — pause-and-redirect must be deterministic.`,
    ).toBe(1);

    const url = calls[0]!;
    expect(
      url.startsWith('/auth/start?return='),
      `expected the redirect URL to start with "/auth/start?return=" (AC 5.2 — the worker's /auth/start route is the JIT entry point). Got: ${JSON.stringify(url)}`,
    ).toBe(true);

    const expectedReturn = encodeURIComponent(window.location.href);
    expect(
      url.includes(`return=${expectedReturn}`),
      `expected the return parameter to be the URL-encoded current href so the post-auth callback can land back on the same spec. Expected: return=${expectedReturn}. Got: ${JSON.stringify(url)}.`,
    ).toBe(true);
  });

  it('on 401, does NOT enter edit mode — the read-only viewer stays read-only', async () => {
    // Pin the "pause" half: the ATTEMPTED action is paused; the
    // editor stays in its pre-attempt state. Without this, an impl
    // that flips to editable AND THEN ALSO redirects would briefly
    // expose an authed-looking edit surface to an unauthed user.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const pm = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pm?.getAttribute('contenteditable'),
      'expected contenteditable="false" after a 401 (AC 5.2 — pause means do NOT flip; the editor stays read-only).',
    ).toBe('false');
    expect(
      pm?.getAttribute('aria-readonly'),
      'expected aria-readonly="true" to survive the 401 path (a11y state must agree with the read-only flip).',
    ).toBe('true');
    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'expected NO edit-toolbar surface after a 401 (the toolbar implies edit-mode entry; surfacing it pre-auth would mislead the user).',
    ).toBeNull();
  });

  it('on 200, enters edit mode (contenteditable flips to true, toolbar appears)', async () => {
    // The GREEN path: authed user → flip without redirect. AC 5.5
    // adds a second fetch for the write-access check; we mock both
    // (session 200 + perms 200 with push:true) to keep this test
    // pinned on the AC 5.2 contract.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 }),
      );
    });
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const pm = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pm?.getAttribute('contenteditable'),
      'expected contenteditable="true" after a 200 (AC 5.2 — authed users flip immediately; AC 5.1 mechanism is the underlying enterEditMode call).',
    ).toBe('true');
    expect(
      pm?.getAttribute('aria-readonly'),
      'expected aria-readonly="false" alongside the contenteditable flip.',
    ).toBe('false');
    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'expected the edit-toolbar surface to appear after a 200 (AC 5.1 cross-pin).',
    ).not.toBeNull();
  });

  it('on 200, does NOT redirect', async () => {
    // The defensive other-half of the GREEN pin: an authed user
    // must NOT be bounced through the auth flow again. AC 5.5 adds
    // the perms fetch; mock both.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 }),
      );
    });
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    expect(
      redirectCalls(),
      'expected NO redirect (assign / replace / href setter) after a 200 (AC 5.2 — authed users stay on the spec page).',
    ).toEqual([]);
  });

  it('return URL preserves the FULL current URL — encoded path, query params, ref all survive round-trip', async () => {
    // The most regression-prone pin: a naïve impl using
    // window.location.pathname (no search) drops the spec
    // coordinates. After the auth round-trip the browser would land
    // on `/` (the landing page) instead of `/?repo=...&path=...`,
    // and the user would have to re-enter the URL. The test sets a
    // representative URL in beforeEach with all three params; this
    // assertion decodes the return param and verifies it round-trips
    // to the original full href.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const calls = redirectCalls();
    expect(calls.length, 'precondition: a redirect must have happened').toBe(1);
    const url = calls[0]!;
    const match = /return=([^&]+)/.exec(url);
    expect(
      match,
      `expected a "return=" query parameter in the redirect URL. Got: ${JSON.stringify(url)}`,
    ).not.toBeNull();
    const decoded = decodeURIComponent(match![1]!);
    expect(
      decoded,
      `expected the decoded return param to equal window.location.href verbatim (AC 5.2 — full URL preservation; without it the post-auth landing loses spec context). Decoded: ${JSON.stringify(decoded)}. window.location.href: ${JSON.stringify(window.location.href)}.`,
    ).toBe(window.location.href);
    // Belt-and-suspenders: explicit query-param presence pins.
    expect(decoded).toContain('repo=foo/bar');
    expect(decoded).toContain('path=specs/v0.3-web-pivot/spec.md');
    expect(decoded).toContain('ref=main');
  });

  it('on a non-2xx other than 401 (e.g. 500), still redirects to /auth/start (treats every non-2xx as unauthed)', async () => {
    // Defensive: a transient worker error shouldn't strand the user
    // in a half-state where the editor never flips. The simplest
    // safe behavior is "any non-2xx ⇒ treat as unauthed → redirect".
    // A future refinement could surface an error toast for 5xx, but
    // for AC 5.2 the redirect is the safe default.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    expect(
      redirectCalls().length,
      'expected a redirect on a 500 response (AC 5.2 — non-2xx treated as unauthed; user gets a chance to re-auth rather than stranding in a half-state).',
    ).toBe(1);
    const pm = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pm?.getAttribute('contenteditable'),
      'expected the editor to remain read-only on 500 (no flip on non-2xx).',
    ).toBe('false');
  });

  it('on a fetch network error (TypeError), the seam does NOT throw — user-facing surface stays stable', async () => {
    // Defensive floor: an offline / DNS-down state should NOT
    // surface as an unhandled rejection in the WebView console.
    // We don't pin the recovery shape (redirect vs toast vs silent
    // log); only that the promise resolves without rejecting.
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };

    await expect(
      attemptEditAction(host),
      'expected attemptEditAction to NOT reject on a network error (AC 5.2 defensive floor; impl picks the recovery shape).',
    ).resolves.toBeUndefined();
  });

  it('is idempotent against a sync race — two synchronous calls perform at most one session-status fetch + one perms fetch + one flip', async () => {
    // Per builder's AC 5.1 heads-up #3: WeakMap-based idempotency
    // breaks against synchronous re-entrancy because the first
    // call's await releases control before the WeakMap.set lands.
    // Pin the contract HERE in 5.2 because intent detection (5.2's
    // wiring) might fire multiple sync events (keydown +
    // beforeinput + click) — the JIT auth check must not fire twice.
    //
    // AC 5.5 added a perms fetch on the 200 path; the sync-race
    // dedup must apply to BOTH fetches (one of each, not two of
    // each). Same module-local pending lock from AC 5.2 covers
    // both.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 }),
      );
    });
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };

    // Two synchronous (non-awaited) invocations, then a single
    // await for both to settle.
    const p1 = attemptEditAction(host);
    const p2 = attemptEditAction(host);
    await Promise.all([p1, p2]);

    const sessionFetches = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === '/api/session-status',
    );
    const permsFetches = fetchSpy.mock.calls.filter(
      ([u]) => String(u).startsWith('/api/github/repos/'),
    );
    expect(
      sessionFetches.length,
      `expected exactly ONE /api/session-status fetch from two synchronous invocations (AC 5.2 sync-race guard; the dedup must cover the session check). Got ${sessionFetches.length}.`,
    ).toBe(1);
    expect(
      permsFetches.length,
      `expected exactly ONE perms fetch from two synchronous invocations (AC 5.5 added the perms check; the same pending lock dedups it). Got ${permsFetches.length}.`,
    ).toBe(1);
    expect(
      host.querySelectorAll('.ProseMirror').length,
      'expected exactly ONE .ProseMirror after the sync race (AC 5.2 sync-race + AC 5.1 idempotency cross-pin).',
    ).toBe(1);
  });
});

// Cross-AC pin: after a successful auth flip, the AC 5.6 byte-equal
// frontmatter contract MUST still hold. A regression that re-mounts
// without forwarding the captured frontmatter would silently break
// the eventual save flow before it ships.
describe('Issue #91 / AC 5.2 cross-pin — frontmatter survives the JIT 200 path byte-equal', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=spec.md&ref=main');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('after the 200 → enterEditMode flow, getViewerMarkdown(host) re-emits byte-equal frontmatter', async () => {
    // AC 5.5 cross-pin: the perms fetch lands on the 200 happy
    // path; mock it returning push:true so the flip happens.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 }),
      );
    });

    const { mountViewer, getViewerMarkdown } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };

    const frontmatter = '---\ntitle: Spec\nauthor: dean\n---\n';
    const original = frontmatter + '# Body\n\nprose\n';
    await mountViewer(host, original);
    expect(
      getViewerMarkdown(host),
      'precondition: AC 5.6 round-trip must hold pre-attempt',
    ).toBe(original);

    await attemptEditAction(host);

    const out = getViewerMarkdown(host);
    expect(
      out,
      'expected non-null round-trip output after the JIT 200 flip.',
    ).not.toBeNull();
    expect(
      out!.startsWith(frontmatter),
      `expected the captured frontmatter to survive the JIT 200 path byte-equal (Issue #91 AC 5.2 cross-pinned with AC 5.6 — the auth flow must NOT drop or reformat frontmatter when it routes through enterEditMode). Frontmatter: ${JSON.stringify(frontmatter)}. Output: ${JSON.stringify(out)}`,
    ).toBe(true);
  });
});
