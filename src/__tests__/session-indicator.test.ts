import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Editor } from '@milkdown/core';

// Issue #91 / AC 5.4 — Session indicator + sign-out.
//
// "When a session is active, show the signed-in user's GitHub
// avatar in the persistent header. Add a `Sign out` action that
// calls `POST /auth/logout` and reverts the UI to anonymous viewer
// state."
//
// Pinned testable seam:
//
//   mountSessionIndicator(host: HTMLElement): Promise<void>
//
// Exported from `src/session-indicator.ts`. Behavior:
//
//   1. Fetches `/api/session-status` with credentials: 'same-origin'.
//   2. On 200 with `{user: {login, avatar_url}}`:
//      - Appends an `<img>` with the avatar URL to the persistent
//        header (or wherever AC 4.5's header lives).
//      - Appends a `[data-testid="sign-out"]` button.
//      - Clicking sign-out calls `POST /auth/logout`, then on 200
//        unmounts the indicator AND reverts the editor to read-only
//        if it was in edit mode.
//   3. On 401: no-op (anonymous viewer state — no avatar, no
//      sign-out button).
//
// The bootstrap calls `mountSessionIndicator` after mountViewer
// succeeds. Tests opt out of vitest.setup.ts's Tauri-default flag
// (web-mode-only flow).
//
// Cross-AC: AC 5.4's sign-out flow needs a way to revert the editor
// from edit-mode back to read-only. AC 5.1 was explicitly one-way
// (no exitEditMode); 5.4 introduces the reverse mechanism via a
// new `exitEditMode(host)` named export from src/edit-mode.ts. The
// tests pin its existence + behavior.

const TEST_LOGIN = 'octocat';
const TEST_AVATAR_URL = 'https://avatars.githubusercontent.com/u/583231?v=4';

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

describe('Issue #91 / AC 5.4 — mountSessionIndicator (avatar render)', () => {
  let host: HTMLDivElement;
  let headerHost: HTMLElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML =
      '<header id="viewer-header"></header><div id="editor"></div>';
    host = document.getElementById('editor') as HTMLDivElement;
    headerHost = document.getElementById('viewer-header') as HTMLElement;

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Sandbox window.location so click handlers that navigate (e.g.
    // a sign-out impl that does `window.location.assign('/')` after
    // logout) don't actually navigate jsdom.
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

    // Pre-render the AC 4.5 viewer header so the indicator has a
    // surface to mount into.
    const { renderViewerHeader } = await import('../viewer-header');
    renderViewerHeader(headerHost, {
      repo: 'foo/bar',
      path: 'spec.md',
      ref: 'main',
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

  it('exports `mountSessionIndicator` as a named function from src/session-indicator.ts', async () => {
    const mod = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator?: unknown;
    };
    expect(
      typeof mod.mountSessionIndicator,
      'expected `mountSessionIndicator` to be exported as a function from src/session-indicator.ts (Issue #91 AC 5.4 — the named-export floor for the avatar + sign-out surface).',
    ).toBe('function');
  });

  it('with a 200 + user info, renders an <img> with the user\'s avatar_url', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { login: TEST_LOGIN, avatar_url: TEST_AVATAR_URL },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (host: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    const avatarImg = document.querySelector<HTMLImageElement>(
      `img[src="${TEST_AVATAR_URL}"]`,
    );
    expect(
      avatarImg,
      `expected an <img src="${TEST_AVATAR_URL}"> in the DOM after mountSessionIndicator (AC 5.4 — the signed-in user's GitHub avatar must surface in the persistent header).`,
    ).not.toBeNull();
  });

  it('with a 200 + user info, renders a [data-testid="sign-out"] button', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { login: TEST_LOGIN, avatar_url: TEST_AVATAR_URL },
        }),
        { status: 200 },
      ),
    );

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (host: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    const signOut = document.querySelector<HTMLButtonElement>('[data-testid="sign-out"]');
    expect(
      signOut,
      'expected a [data-testid="sign-out"] button in the DOM after mountSessionIndicator (AC 5.4 — the sign-out action lives alongside the avatar so signed-in users have a one-click escape hatch).',
    ).not.toBeNull();
    expect(
      signOut!.tagName,
      'expected sign-out to be a <button> so click + Enter/Space activation work natively.',
    ).toBe('BUTTON');
  });

  it('on a 401, does NOT render an avatar OR a sign-out button (anonymous state)', async () => {
    // Negative pin: the indicator is exclusively for authenticated
    // sessions. An over-eager impl that renders a placeholder avatar
    // even for anonymous users would mislead the UI.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (host: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    expect(
      document.querySelector('img[src*="githubusercontent"]'),
      'expected NO avatar img on the 401 path (AC 5.4 — anonymous viewer state must not surface a user identity).',
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="sign-out"]'),
      'expected NO sign-out button on the 401 path.',
    ).toBeNull();
  });

  it('rejects a non-https avatar_url (defensive: GitHub avatars are always https; reject anything else as a defense-in-depth)', async () => {
    // Defensive pin: the avatar URL flows from KV → session-status
    // → frontend → DOM <img src=...>. If somehow a malicious value
    // landed in KV (e.g., via a future feature that lets users
    // override their avatar locally), an `img src="javascript:..."`
    // wouldn't fire JS in modern browsers BUT a `data:image/svg+xml,
    // ...` carrying SVG with embedded JS could. Reject any non-
    // https scheme — github.com avatars are always https; nothing
    // legitimate uses anything else.
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { login: TEST_LOGIN, avatar_url: 'javascript:alert(1)' },
        }),
        { status: 200 },
      ),
    );

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (host: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    const dangerousImg = Array.from(
      document.querySelectorAll<HTMLImageElement>('img[src]'),
    ).filter((img) => /^\s*(javascript|data|vbscript)\s*:/i.test(img.getAttribute('src') ?? ''));
    expect(
      dangerousImg,
      'expected NO <img> with a dangerous-scheme src (Issue #91 AC 5.4 + Issue #90 fix #1 carry-over — defensive scheme allowlist on the avatar src).',
    ).toEqual([]);
  });

  it('does NOT call fetch with a bad URL (uses /api/session-status with credentials: same-origin)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (host: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('/api/session-status');
    expect((init as RequestInit | undefined)?.credentials).toBe('same-origin');
  });
});

describe('Issue #91 / AC 5.4 — sign-out flow', () => {
  let host: HTMLDivElement;
  let headerHost: HTMLElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML =
      '<header id="viewer-header"></header><div id="editor"></div>';
    host = document.getElementById('editor') as HTMLDivElement;
    headerHost = document.getElementById('viewer-header') as HTMLElement;

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

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

    const { renderViewerHeader } = await import('../viewer-header');
    renderViewerHeader(headerHost, { repo: 'foo/bar', path: 'spec.md', ref: 'main' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('clicking sign-out calls POST /auth/logout with credentials: same-origin', async () => {
    // Pin the request shape: method=POST (the worker route is
    // POST-only per AC 3.7), credentials so the session cookie
    // rides along, URL exact.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            user: { login: TEST_LOGIN, avatar_url: TEST_AVATAR_URL },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (host: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    const signOut = document.querySelector<HTMLButtonElement>('[data-testid="sign-out"]')!;
    signOut.click();
    // Allow the click handler's fetch + post-200 unmount to settle.
    await new Promise((r) => setTimeout(r, 80));

    expect(
      fetchSpy.mock.calls.length,
      'expected exactly TWO fetches: 1 for session-status (mount) + 1 for /auth/logout (click).',
    ).toBe(2);

    const [logoutUrl, logoutInit] = fetchSpy.mock.calls[1]!;
    expect(
      String(logoutUrl),
      'expected the second fetch to be /auth/logout (AC 5.4 — sign-out action calls the existing AC 3.7 endpoint).',
    ).toBe('/auth/logout');
    const init = (logoutInit ?? {}) as RequestInit;
    expect(
      init.method?.toUpperCase(),
      'expected the logout fetch to use POST (AC 3.7 — endpoint is POST-only as a CSRF defense; GET would not invalidate the session).',
    ).toBe('POST');
    expect(
      init.credentials,
      'expected credentials: "same-origin" so the session cookie is included (without it the worker can\'t identify the session to invalidate).',
    ).toBe('same-origin');
  });

  it('on logout 200, the avatar img and sign-out button are removed from the DOM', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            user: { login: TEST_LOGIN, avatar_url: TEST_AVATAR_URL },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (host: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    expect(
      document.querySelector(`img[src="${TEST_AVATAR_URL}"]`),
      'precondition: avatar must be rendered before sign-out',
    ).not.toBeNull();

    const signOut = document.querySelector<HTMLButtonElement>('[data-testid="sign-out"]')!;
    signOut.click();
    await new Promise((r) => setTimeout(r, 80));

    expect(
      document.querySelector(`img[src="${TEST_AVATAR_URL}"]`),
      'expected the avatar img to be removed after sign-out 200 (AC 5.4 — UI reverts to anonymous state).',
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="sign-out"]'),
      'expected the sign-out button to be removed after sign-out 200.',
    ).toBeNull();
  });

  it('on logout non-2xx (e.g. 500), the indicator stays in the DOM (UI does not lie about being signed out)', async () => {
    // Defensive pin: a transient backend failure must NOT trick the
    // user into thinking they're signed out when they're not. The
    // session is still live server-side; the UI must reflect that.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            user: { login: TEST_LOGIN, avatar_url: TEST_AVATAR_URL },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (host: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    const signOut = document.querySelector<HTMLButtonElement>('[data-testid="sign-out"]')!;
    signOut.click();
    await new Promise((r) => setTimeout(r, 80));

    expect(
      document.querySelector('[data-testid="sign-out"]'),
      'expected the sign-out button to STAY when logout returns non-2xx (AC 5.4 defensive — the UI must not falsely claim sign-out succeeded).',
    ).not.toBeNull();
    expect(
      document.querySelector(`img[src="${TEST_AVATAR_URL}"]`),
      'expected the avatar to STAY when logout returns non-2xx.',
    ).not.toBeNull();
  });

  it('on logout 200 from edit mode, the editor reverts to read-only', async () => {
    // Cross-AC pin: AC 5.1 was explicitly one-way (no exitEditMode
    // out-of-the-box). AC 5.4's sign-out forces the reverse: a
    // signed-in user in edit mode hits sign-out → editor must
    // revert to read-only because the user no longer has a live
    // session to authorize edits. Without this, the editor would
    // stay editable post-logout and any save attempt would fail.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            user: { login: TEST_LOGIN, avatar_url: TEST_AVATAR_URL },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (host: HTMLElement) => Promise<void>;
    };

    // Mount a viewer + flip into edit mode first.
    const { mountViewer } = await import('../viewer');
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (h: HTMLElement) => Promise<void>;
    };
    await mountViewer(host, '# Spec\n');
    await enterEditMode(host);

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: editor must be in edit mode before sign-out is exercised',
    ).toBe('true');

    await mountSessionIndicator(headerHost);
    const signOut = document.querySelector<HTMLButtonElement>('[data-testid="sign-out"]')!;
    signOut.click();
    await new Promise((r) => setTimeout(r, 150));

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'expected the editor to revert to contenteditable="false" after sign-out (AC 5.4 — UI reverts to anonymous viewer state, which is read-only by definition).',
    ).toBe('false');
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('aria-readonly'),
      'expected aria-readonly="true" alongside the contenteditable revert (a11y consistency).',
    ).toBe('true');
    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'expected the edit-toolbar surface to be removed after sign-out (no signed-in user → no formatting affordances).',
    ).toBeNull();
  });
});

describe('Issue #91 / AC 5.4 — exitEditMode named export (sign-out reverse mechanism)', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('exports `exitEditMode` as a named function from src/edit-mode.ts (cross-AC: needed by sign-out)', async () => {
    // AC 5.1 explicitly didn't include exitEditMode (web JIT was
    // one-way per session). AC 5.4's sign-out flow needs the
    // reverse mechanism — without it, the sign-out test above
    // can't revert from edit to read.
    const mod = (await import('../edit-mode')) as unknown as {
      exitEditMode?: unknown;
    };
    expect(
      typeof mod.exitEditMode,
      'expected `exitEditMode` to be a named function export of src/edit-mode.ts (Issue #91 AC 5.4 — the sign-out flow needs to revert the editor; AC 5.1 was one-way, AC 5.4 introduces the reverse).',
    ).toBe('function');
  });

  it('flips contenteditable="true" → "false" and removes the edit-toolbar', async () => {
    const { mountViewer } = await import('../viewer');
    const { enterEditMode, exitEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (h: HTMLElement) => Promise<void>;
      exitEditMode: (h: HTMLElement) => Promise<void>;
    };

    await mountViewer(host, '# Spec\n');
    await enterEditMode(host);

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: edit mode',
    ).toBe('true');
    expect(document.querySelector('[data-testid="edit-toolbar"]')).not.toBeNull();

    await exitEditMode(host);

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'expected contenteditable="false" after exitEditMode (AC 5.4 — reverse of AC 5.1).',
    ).toBe('false');
    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'expected the edit-toolbar to be removed after exitEditMode (the toolbar is exclusive to edit mode).',
    ).toBeNull();
  });

  it('is a safe no-op when the host has no edit-mode editor (defensive floor)', async () => {
    const { exitEditMode } = (await import('../edit-mode')) as unknown as {
      exitEditMode: (h: HTMLElement) => Promise<void>;
    };

    await expect(
      exitEditMode(host),
      'expected exitEditMode to NOT reject when no edit-mode editor is mounted (defensive floor: a stray sign-out from anonymous state must not throw).',
    ).resolves.toBeUndefined();
  });

  it('preserves byte-equal frontmatter across the exit flip (AC 5.6 cross-pin)', async () => {
    // The reverse mechanism must preserve the captured frontmatter
    // the same way enterEditMode does (AC 5.6 cross-pin). A regression
    // that re-mounts without forwarding the captured frontmatter
    // would silently break the round-trip.
    const { mountViewer, getViewerMarkdown } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };
    const { enterEditMode, exitEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (h: HTMLElement) => Promise<void>;
      exitEditMode: (h: HTMLElement) => Promise<void>;
    };

    const fm = '---\ntitle: Spec\n---\n';
    const original = fm + '# Body\n';
    await mountViewer(host, original);
    await enterEditMode(host);
    await exitEditMode(host);

    const out = getViewerMarkdown(host);
    expect(
      out,
      'expected non-null round-trip after exitEditMode',
    ).not.toBeNull();
    expect(
      out!.startsWith(fm),
      `expected captured frontmatter to survive exitEditMode byte-equal (AC 5.4 + AC 5.6 cross-pin). Got: ${JSON.stringify(out)}`,
    ).toBe(true);
  });
});
