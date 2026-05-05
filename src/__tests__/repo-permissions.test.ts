import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #91 / AC 5.5 — Detect no-write-access right after auth.
//
// "If user is read-only on the target repo, lock the editor with a
// 'view-only — no write access; ask the dev to add you' message."
//
// Mechanism (per QA-tdd / team-lead consultation):
//   - The check happens after `attemptEditAction` confirms a live
//     session (200 from /api/session-status). Before unlocking edit
//     mode, the frontend hits GET /api/github/repos/{owner}/{repo}
//     and inspects `permissions.push`.
//   - On `push: true` → enterEditMode (existing AC 5.1 mechanism)
//   - On `push: false` OR perms-fetch failure → render
//     `[data-testid="view-only-lock"]` element with locking copy
//     and DO NOT flip.
//
// Pinned testable seam — `attemptEditAction` is extended (NOT
// replaced) to layer the perms check on top of the session check.
// This means the existing AC 5.2 (jit-auth) and AC 5.3
// (post-auth-restore) tests need one more `.mockResolvedValueOnce`
// for the perms response on the 200 paths — those are updated in
// the same commit that adds these new tests.
//
// New file (this one) pins the AC 5.5-specific behavior:
//   - perms fetch URL shape (/api/github/repos/{owner}/{repo})
//   - branch on `permissions.push`
//   - view-only-lock surface form factor
//   - graceful default on perms fetch failure

const VIEW_ONLY_LOCK_TESTID = 'view-only-lock';

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

describe('Issue #91 / AC 5.5 — attemptEditAction adds a perms check before flipping', () => {
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
    sessionStorage.clear();

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Sandbox window.location so any redirect spies don't navigate.
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

    window.history.replaceState({}, '', '/?repo=foo/bar&path=spec.md&ref=main');

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
    sessionStorage.clear();
  });

  it('after a session-status 200, fetches /api/github/repos/{owner}/{repo} with credentials: same-origin', async () => {
    // Pin the URL shape: the path is constructed from the parsed
    // `?repo=` query param (foo/bar in the test URL), expanded
    // verbatim into the GitHub repos endpoint via the worker proxy.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      if (u.startsWith('/api/github/repos/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ permissions: { push: true } }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const permsCalls = fetchSpy.mock.calls.filter(
      ([u]) => String(u).startsWith('/api/github/repos/'),
    );
    expect(
      permsCalls.length,
      `expected exactly one /api/github/repos/{owner}/{repo} fetch (AC 5.5 — perms check happens once after session is confirmed). Got ${permsCalls.length}.`,
    ).toBe(1);

    const [permsUrl, permsInit] = permsCalls[0]!;
    expect(
      String(permsUrl),
      `expected the perms URL to be /api/github/repos/foo/bar (constructed from ?repo=foo/bar). Got: ${JSON.stringify(permsUrl)}`,
    ).toBe('/api/github/repos/foo/bar');
    expect(
      (permsInit as RequestInit | undefined)?.credentials,
      'expected credentials: "same-origin" so the session cookie rides along (the worker proxy gates on the cookie).',
    ).toBe('same-origin');
  });

  it('on perms 200 with permissions.push: true, enters edit mode', async () => {
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ permissions: { push: true } }), {
          status: 200,
        }),
      );
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const pm = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pm?.getAttribute('contenteditable'),
      'expected contenteditable="true" on push:true (AC 5.5 happy path — write access confirmed → existing AC 5.1 flip).',
    ).toBe('true');
    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'expected the edit-toolbar to appear on push:true.',
    ).not.toBeNull();
    expect(
      document.querySelector(`[data-testid="${VIEW_ONLY_LOCK_TESTID}"]`),
      'expected NO view-only-lock on push:true (the user has write access).',
    ).toBeNull();
  });

  it('on perms 200 with permissions.push: false, does NOT enter edit mode and renders view-only-lock', async () => {
    // The core RED-path pin. User is signed in but read-only on
    // the repo. AC 5.5: lock the editor + show "no write access"
    // message. The editor stays read-only (no flip).
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ permissions: { push: false } }), {
          status: 200,
        }),
      );
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const pm = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pm?.getAttribute('contenteditable'),
      'expected contenteditable="false" on push:false (AC 5.5 — read-only repo locks the editor; no flip).',
    ).toBe('false');
    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'expected NO edit-toolbar on push:false (no edit mode, no formatting affordances).',
    ).toBeNull();

    const lock = document.querySelector<HTMLElement>(
      `[data-testid="${VIEW_ONLY_LOCK_TESTID}"]`,
    );
    expect(
      lock,
      `expected a [data-testid="${VIEW_ONLY_LOCK_TESTID}"] element after push:false (AC 5.5 — surface "view-only — no write access" so the user understands why their edit attempt didn't unlock).`,
    ).not.toBeNull();
  });

  it('view-only-lock contains copy mentioning "view-only" / "no write access" / "ask the dev"', async () => {
    // Pin the messaging contract: the AC quotes specific copy
    // ("view-only — no write access; ask the dev to add you"). We
    // accept paraphrasing but require at least one of the three
    // recognizable phrases so a future copy edit can't accidentally
    // ship something unrelated.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ permissions: { push: false } }), {
          status: 200,
        }),
      );
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const lock = document.querySelector<HTMLElement>(
      `[data-testid="${VIEW_ONLY_LOCK_TESTID}"]`,
    );
    expect(lock, 'precondition: lock element must be in the DOM').not.toBeNull();
    const text = (lock!.textContent ?? '').toLowerCase();
    const hasMatch =
      text.includes('view-only') ||
      text.includes('view only') ||
      text.includes('no write access') ||
      text.includes('read-only') ||
      text.includes('ask the dev') ||
      text.includes('ask the maintainer') ||
      text.includes("don't have access") ||
      text.includes('no access');
    expect(
      hasMatch,
      `expected the view-only-lock copy to mention "view-only" / "no write access" / "ask the dev" or equivalent (AC 5.5 — user must understand WHY the editor is locked). Got copy: ${JSON.stringify(text)}`,
    ).toBe(true);
  });

  it('on perms 200 with NO `permissions.push` field at all (e.g., GitHub returned a different shape), defaults to view-only', async () => {
    // Adversarial pin: a GitHub response that lacks the expected
    // shape (e.g., `permissions` is undefined, or it's an array, or
    // push is non-boolean) must NOT be interpreted as "yes can
    // write". Default to view-only — fail safe.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ name: 'repo-without-permissions' }), {
          status: 200,
        }),
      );
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'expected the editor to stay read-only when permissions.push is missing (AC 5.5 fail-safe — only an explicit `push: true` unlocks).',
    ).toBe('false');
    expect(
      document.querySelector(`[data-testid="${VIEW_ONLY_LOCK_TESTID}"]`),
      'expected the view-only-lock to render on missing-permissions response (graceful default).',
    ).not.toBeNull();
  });

  it('on perms 4xx/5xx (e.g., 404 / 500), defaults to view-only', async () => {
    // Defensive: a non-2xx perms response (repo not found, GitHub
    // outage, rate limit) must NOT unlock edit mode. Fail safe.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 500 }));
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'expected the editor to stay read-only when the perms fetch returns 5xx (AC 5.5 — graceful default; never unlock without a confirmed push:true).',
    ).toBe('false');
    expect(
      document.querySelector(`[data-testid="${VIEW_ONLY_LOCK_TESTID}"]`),
      'expected the view-only-lock to render on perms 5xx (graceful default; user sees the lock instead of a silent edit-mode failure).',
    ).not.toBeNull();
  });

  it('on perms-fetch network error (TypeError), defaults to view-only without throwing', async () => {
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.reject(new TypeError('Failed to fetch'));
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };

    await expect(
      attemptEditAction(host),
      'expected attemptEditAction to NOT reject on a perms-fetch network error.',
    ).resolves.toBeUndefined();

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'expected the editor to stay read-only on perms-fetch network error (graceful default).',
    ).toBe('false');
  });

  it('on session-status 401, redirects to /auth/start WITHOUT making the perms fetch (saves a roundtrip)', async () => {
    // Defensive: when the user has no session, there's no point
    // hitting the perms endpoint — it'd return 401 anyway. The
    // existing 401 redirect path must short-circuit BEFORE the
    // perms fetch. Pin: only one fetch (session-status) on 401.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    expect(
      fetchSpy.mock.calls.length,
      `expected exactly ONE fetch on the 401 path (AC 5.5 — short-circuit before the perms check; no point hitting /api/github/* without a session). Got ${fetchSpy.mock.calls.length}.`,
    ).toBe(1);

    expect(
      document.querySelector(`[data-testid="${VIEW_ONLY_LOCK_TESTID}"]`),
      'expected NO view-only-lock on 401 (the user is unauthed — they get redirected to auth, not locked into a view-only state).',
    ).toBeNull();
  });

  it('after entering view-only state, the rendered body is still readable (lock does NOT replace the editor)', async () => {
    // UX sanity: locking the editor must NOT remove the rendered
    // markdown. The user signed in to view the spec; even without
    // write access they should still be able to read it. The lock
    // is a banner, not a content replacement.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ permissions: { push: false } }), {
          status: 200,
        }),
      );
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    expect(
      host.querySelector('.ProseMirror'),
      'expected the .ProseMirror editor root to STILL be in the DOM after view-only-lock (AC 5.5 — read-only viewing must continue to work; the lock is a banner explaining why edit is disabled, not a content removal).',
    ).not.toBeNull();
    expect(
      host.querySelector('h1')?.textContent ?? '',
      'expected the rendered markdown body (e.g., "# Spec" → <h1>Spec</h1>) to still be visible after the lock surfaces.',
    ).toContain('Spec');
  });
});
