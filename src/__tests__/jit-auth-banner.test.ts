import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #158 / AC 4.6, 4.7 — JIT-auth UX polish on banner primitive.
//
// AC 4.6: when `attemptEditAction` is about to redirect to
//         /auth/start, surface a visible "Redirecting…" indicator
//         BEFORE `window.location.assign` fires. Prevents the
//         "click did nothing" perception during the brief window
//         between fetch resolution and navigation taking effect.
//
// AC 4.7: the view-only lock screen exposes a "back to read-only
//         view" affordance — a button that removes the lock banner
//         so the user can keep reading the rendered markdown
//         without the banner cluttering the surface.
//
// Implementation freedom: the indicator can be rendered via
// `showBanner` (recommended) or any DOM primitive that meets the
// observable contract. Tests query by content + role, not by
// specific testids.

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

describe('Issue #158 / AC 4.6 — visible "redirecting…" indicator before /auth/start navigation', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let assignSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;
  // Captured DOM snapshot at the moment location.assign is called.
  let domAtAssign: string | null;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    window.history.replaceState({}, '', '/?repo=foo/bar&path=specs/spec.md&ref=main');

    originalLocation = window.location;
    domAtAssign = null;
    assignSpy = vi.fn(() => {
      // Snapshot the entire body innerHTML at the exact moment
      // location.assign is invoked. The AC 4.6 contract is that
      // the indicator is rendered BEFORE assign — so the snapshot
      // must already contain the redirecting text.
      domAtAssign = document.body.innerHTML;
    });

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
      assign: assignSpy as unknown as (url: string) => void,
      replace: () => {},
      reload: () => {},
      toString() { return _href; },
    } as unknown as FakeLocation;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: fakeLocation,
    });

    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n\nbody\n');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('renders a visible "redirecting" indicator BEFORE window.location.assign fires (on 401)', async () => {
    // The central AC 4.6 pin. Today the user clicks Edit, the
    // session-status fetch returns 401, and the impl jumps
    // straight to location.assign — leaving the user to wonder
    // "did anything happen?" for the few hundred ms before the
    // GitHub auth screen paints. With this fix, an indicator is
    // visible in the DOM at the moment assign is called.
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (h: HTMLElement) => Promise<unknown>;
    };

    await attemptEditAction(host);

    expect(assignSpy, 'precondition: location.assign must have been called').toHaveBeenCalledTimes(1);
    expect(domAtAssign, 'expected DOM snapshot at assign time').not.toBeNull();
    const text = (domAtAssign ?? '').toLowerCase();
    expect(
      text.includes('redirect') || text.includes('signing in') || text.includes('taking you'),
      `expected the DOM at the moment of location.assign to include a "redirect"-style indicator (AC 4.6 — visible signal before navigation). Snapshot: ${JSON.stringify(domAtAssign)}.`,
    ).toBe(true);
  });

  it('the redirecting indicator carries a role attribute (status or alert) for SR announcement', async () => {
    // a11y belt: blind users should hear "Redirecting…" at the
    // moment of click → not silence followed by an unannounced
    // page navigation. A role="status" or role="alert" element
    // (typical of `showBanner`) makes AT announce the message.
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (h: HTMLElement) => Promise<unknown>;
    };
    await attemptEditAction(host);

    expect(domAtAssign, 'precondition').not.toBeNull();
    // Parse the snapshot and look for an element with role
    // status/alert containing "redirect" / "signing in".
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${domAtAssign}</body>`, 'text/html');
    const candidates = Array.from(
      doc.querySelectorAll('[role="status"], [role="alert"]'),
    );
    const announced = candidates.some((el) => {
      const t = (el.textContent ?? '').toLowerCase();
      return t.includes('redirect') || t.includes('signing in') || t.includes('taking you');
    });
    expect(
      announced,
      `expected the redirect indicator to carry role="status" or role="alert" so screen readers announce it (AC 4.6 a11y). DOM: ${JSON.stringify(domAtAssign)}.`,
    ).toBe(true);
  });

  it('does NOT render a redirect indicator when the session is valid (200 path, no redirect)', async () => {
    // Negative pin: the indicator is scoped to the redirect path.
    // A successful session-status response must not surface a
    // redirect message to the user.
    //
    // The 200 path also fetches /api/github/repos/<repo> for
    // the write-access check — return a non-pushable response
    // so the flow lands on the view-only lock (deterministic
    // 'denied'), not on enterEditMode (which involves Milkdown
    // remount that may flake in jsdom).
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (u.includes('/api/session-status')) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      if (u.includes('/api/github/repos/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ permissions: { push: false } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (h: HTMLElement) => Promise<unknown>;
    };
    await attemptEditAction(host);

    expect(
      assignSpy,
      'precondition: 200 path must NOT redirect',
    ).not.toHaveBeenCalled();
    const text = document.body.textContent?.toLowerCase() ?? '';
    expect(
      text.includes('redirecting') || text.includes('taking you'),
      `expected NO redirect indicator on the 200 (no-redirect) path. DOM text: ${JSON.stringify(text)}.`,
    ).toBe(false);
  });
});

describe('Issue #158 / AC 4.7 — view-only lock has a "back to read-only view" affordance', () => {
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

    window.history.replaceState({}, '', '/?repo=foo/bar&path=specs/spec.md&ref=main');

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

    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n\nbody\n');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  async function triggerViewOnlyLock(): Promise<void> {
    // session-status: 200 (signed in), repo perms: push:false →
    // attemptEditAction lands on renderViewOnlyLock.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (u.includes('/api/session-status')) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      if (u.includes('/api/github/repos/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ permissions: { push: false } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (h: HTMLElement) => Promise<unknown>;
    };
    await attemptEditAction(host);
  }

  it('the view-only lock banner exposes a "back to read-only view" button (or link)', async () => {
    // AC 4.7 verbatim — recovery affordance on the lock surface.
    // Without it, the user is stuck staring at "View-only" copy
    // covering the page header even though the markdown body
    // below is perfectly readable.
    await triggerViewOnlyLock();

    const lock = host.querySelector<HTMLElement>('[data-testid="view-only-lock"]');
    expect(lock, 'precondition: view-only lock must render').not.toBeNull();

    const buttons = Array.from(lock!.querySelectorAll<HTMLElement>('button, a'));
    const back = buttons.find((b) => {
      const t = (b.textContent ?? '').toLowerCase();
      return (
        (t.includes('back') && t.includes('read')) ||
        t.includes('keep reading') ||
        t.includes('continue reading') ||
        t.includes('dismiss')
      );
    });
    expect(
      back,
      `expected a "back to read-only view" affordance inside the view-only lock (AC 4.7). Buttons found: ${JSON.stringify(buttons.map((b) => b.textContent))}.`,
    ).toBeDefined();
  });

  it('clicking the "back to read-only view" affordance removes the lock banner from the DOM', async () => {
    // The behavioral half: the affordance actually does
    // something. The user clicks → the banner is gone → the
    // markdown body keeps rendering.
    await triggerViewOnlyLock();

    const lock = host.querySelector<HTMLElement>('[data-testid="view-only-lock"]');
    const buttons = Array.from(lock!.querySelectorAll<HTMLElement>('button, a'));
    const back = buttons.find((b) => {
      const t = (b.textContent ?? '').toLowerCase();
      return (
        (t.includes('back') && t.includes('read')) ||
        t.includes('keep reading') ||
        t.includes('continue reading') ||
        t.includes('dismiss')
      );
    })!;

    (back as HTMLElement).click();
    // Allow microtask for any focus-restore / DOM removal.
    await Promise.resolve();

    expect(
      host.querySelector('[data-testid="view-only-lock"]'),
      'expected the view-only lock to be removed from the DOM after the recovery affordance is clicked (AC 4.7).',
    ).toBeNull();
  });

  it('the rendered markdown body is still present after dismissing the lock', async () => {
    // Belt: the dismissal removes only the lock, not the
    // viewer body. The user must still be able to read the
    // markdown after clicking the affordance.
    await triggerViewOnlyLock();

    const lock = host.querySelector<HTMLElement>('[data-testid="view-only-lock"]');
    const buttons = Array.from(lock!.querySelectorAll<HTMLElement>('button, a'));
    const back = buttons.find((b) => {
      const t = (b.textContent ?? '').toLowerCase();
      return (
        (t.includes('back') && t.includes('read')) ||
        t.includes('keep reading') ||
        t.includes('continue reading') ||
        t.includes('dismiss')
      );
    })!;
    (back as HTMLElement).click();
    await Promise.resolve();

    const proseMirror = host.querySelector('.ProseMirror');
    expect(
      proseMirror,
      'expected the .ProseMirror viewer body to still be mounted after the lock is dismissed (AC 4.7 — affordance removes only the banner, not the read surface).',
    ).not.toBeNull();
  });
});
