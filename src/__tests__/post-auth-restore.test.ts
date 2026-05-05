import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Editor } from '@milkdown/core';

// Issue #91 / AC 5.3 — post-auth restore.
//
// "On post-auth return, restore the edit context. Browser arrives
// back at the spec URL (with session cookie set). Detect 'we just
// returned from auth' (e.g., a query param like ?auth=ok set by
// backend or sniff the session cookie's existence client-side via a
// session-status endpoint) and re-enter edit mode. If the user's
// pending action can't be safely re-applied (e.g., it was a
// transient text input with no captured payload), prompt them to
// re-do it."
//
// Mechanism (per QA-tdd / team-lead consultation):
//   - **Pre-redirect**: AC 5.2's attemptEditAction stashes a
//     one-shot sessionStorage flag (`hashly-pending-edit=1`) before
//     calling window.location.assign. sessionStorage is per-tab,
//     persists across the auth round-trip in the same tab, and is
//     bounded scope (a different tab won't auto-flip).
//   - **Post-auth detection**: bootstrapWeb (the web-mode entry
//     point) reads the flag AFTER mountViewer succeeds. If set:
//     consume the flag (one-shot), call enterEditMode, render the
//     "your edit was paused, please retry" prompt.
//   - **Worker-side coordination**: separate slice — the worker's
//     /auth/callback must thread the `return` URL from /auth/start
//     so the browser lands back on the spec URL (not "/"). That's
//     pinned in `worker/test/auth-return-url.test.ts`.
//
// Pinned key: `'hashly-pending-edit'` with value `'1'` (a truthy
// presence sentinel; the test treats any non-null value as "flag
// is set"). Builder follows this convention so the bootstrap reader
// + the attemptEditAction writer agree.

const PENDING_EDIT_KEY = 'hashly-pending-edit';
const POST_AUTH_PROMPT_TESTID = 'post-auth-prompt';

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

describe('Issue #91 / AC 5.3 — pre-redirect: attemptEditAction stashes pending-edit flag', () => {
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

    window.history.replaceState({}, '', '/?repo=foo/bar&path=spec.md&ref=main');

    // Replace window.location so the redirect doesn't actually navigate.
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
    sessionStorage.clear();
  });

  it('on the 401 redirect path, sessionStorage["hashly-pending-edit"] is set BEFORE the redirect lands', async () => {
    // Critical ordering: the flag must be stashed before
    // window.location.assign fires, otherwise the redirect happens
    // first and the flag is lost. We assert the flag is present
    // immediately after attemptEditAction resolves.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };

    expect(
      sessionStorage.getItem(PENDING_EDIT_KEY),
      'precondition: sessionStorage must be empty before attemptEditAction',
    ).toBeNull();

    await attemptEditAction(host);

    expect(
      sessionStorage.getItem(PENDING_EDIT_KEY),
      `expected sessionStorage[${JSON.stringify(PENDING_EDIT_KEY)}] to be set after the 401 redirect path (AC 5.3 — the post-auth restore depends on this flag persisting across the auth round-trip in the same tab; without it, bootstrapWeb has no way to detect "we just authed" vs "we already had a session"). Got null.`,
    ).not.toBeNull();
  });

  it('on the 200 happy path, NO sessionStorage flag is set (no redirect → no need to restore on return)', async () => {
    // Negative pin: an over-eager impl that always sets the flag
    // would cause spurious "edit was paused" prompts after a normal
    // edit-mode entry. The flag is exclusively a marker for the
    // redirect path.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };

    await attemptEditAction(host);

    expect(
      sessionStorage.getItem(PENDING_EDIT_KEY),
      'expected NO sessionStorage flag on the 200 happy path (AC 5.3 — the flag is exclusively a redirect-path marker; setting it on 200 would cause spurious post-auth prompts after a normal flow).',
    ).toBeNull();
  });

  it('on a network error, NO sessionStorage flag is set (no redirect happens; AC 5.2 defensive floor)', async () => {
    // Belt-and-suspenders: the AC 5.2 defensive floor catches
    // network errors silently. We verify the flag isn't accidentally
    // set on that path either (would cause the next page load to
    // auto-flip without an actual auth round-trip).
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement) => Promise<void>;
    };

    await attemptEditAction(host);

    expect(
      sessionStorage.getItem(PENDING_EDIT_KEY),
      'expected NO sessionStorage flag on the network-error path (AC 5.3 + AC 5.2 defensive floor — the flag is exclusively a "we just redirected for auth" marker).',
    ).toBeNull();
  });
});

describe('Issue #91 / AC 5.3 — post-auth detection: bootstrapWeb auto-enters edit mode when flag is present', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  const FRESH_TAURI_MOCKS = () => ({
    '@tauri-apps/api/event': { listen: vi.fn(async () => () => {}) },
    '@tauri-apps/plugin-dialog': { open: vi.fn(async () => null), save: vi.fn(async () => null) },
    '@tauri-apps/api/core': { invoke: vi.fn(async () => '') },
  });

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    document.body.innerHTML =
      '<header id="viewer-header"></header><div id="editor"></div>';
    document.title = 'Hashly';
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=README.md&ref=main');

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const tauriMocks = FRESH_TAURI_MOCKS();
    vi.doMock('@tauri-apps/api/event', () => tauriMocks['@tauri-apps/api/event']);
    vi.doMock('@tauri-apps/plugin-dialog', () => tauriMocks['@tauri-apps/plugin-dialog']);
    vi.doMock('@tauri-apps/api/core', () => tauriMocks['@tauri-apps/api/core']);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/core');
    sessionStorage.clear();
  });

  it('with sessionStorage flag set, bootstrap auto-enters edit mode after mountViewer succeeds', async () => {
    // The end-to-end pin: user comes back from auth → bootstrap
    // mounts the spec → flag is detected → auto-flip to edit mode.
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');

    // First fetch is the spec content (AC 4.3 fetchSpec); subsequent
    // fetches are the session-status check (AC 5.2 attemptEditAction).
    fetchSpy
      .mockResolvedValueOnce(new Response('# Hello world\n\nbody', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { bootstrap } = await import('../main');
    bootstrap();
    // Generous settle window: mountViewer + session-status fetch +
    // enterEditMode's destroy + remount all need to complete.
    await new Promise((r) => setTimeout(r, 250));

    const pm = document.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pm,
      'precondition: mountViewer must succeed (a .ProseMirror is expected after the spec fetch resolves 200).',
    ).not.toBeNull();
    expect(
      pm!.getAttribute('contenteditable'),
      'expected contenteditable="true" after auto-restore (AC 5.3 — bootstrap detects the post-auth flag and re-enters edit mode automatically; without this, the user has to click Edit again after authing).',
    ).toBe('true');
    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'expected the edit-toolbar surface to appear after auto-restore (AC 5.1 + AC 5.3 cross-pin).',
    ).not.toBeNull();
  });

  it('flag is cleared after auto-restore (one-shot semantics)', async () => {
    // Reload-after-auto-restore must NOT auto-flip again. Without
    // the clear, every subsequent reload of the same tab would
    // re-enter edit mode (and prompt) until sessionStorage clears
    // organically, which is annoying.
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');
    fetchSpy
      .mockResolvedValueOnce(new Response('# Spec', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    expect(
      sessionStorage.getItem(PENDING_EDIT_KEY),
      'expected the flag to be cleared after auto-restore (AC 5.3 — one-shot semantics; otherwise every page reload in the same tab would re-trigger auto-edit-mode).',
    ).toBeNull();
  });

  it('without the flag, bootstrap does NOT auto-enter edit mode (read-only stays read-only)', async () => {
    // Negative pin: a regression that auto-flips on every web-mode
    // page load (without the flag gate) would silently turn every
    // viewer load into a (potentially-unauthed) edit attempt. The
    // flag is the explicit signal "we just authed".
    fetchSpy.mockResolvedValueOnce(new Response('# Spec', { status: 200 }));

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 200));

    const pm = document.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pm,
      'precondition: mountViewer must succeed',
    ).not.toBeNull();
    expect(
      pm!.getAttribute('contenteditable'),
      'expected contenteditable="false" without the flag (AC 5.3 — auto-edit-mode must be gated by the explicit post-auth marker; otherwise the read-only viewer is broken for non-authed users).',
    ).toBe('false');
    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'expected NO edit-toolbar without the flag.',
    ).toBeNull();

    // AND only one fetch (the spec; no session-status check).
    expect(
      fetchSpy.mock.calls.length,
      'expected NO session-status fetch when the flag is absent (AC 5.3 — gating means "no flag → don\'t even check session"; otherwise we make a redundant fetch on every page load).',
    ).toBe(1);
  });

  it('if mountViewer fails (renderViewerError path), the flag is NOT consumed (user can retry)', async () => {
    // Adversarial pin: the auto-restore path must be robust to a
    // failed initial mount. If the spec fetch returns 404 / 5xx,
    // bootstrap falls through to renderViewerError and the user
    // is left with no editor. Consuming the flag at that point
    // would lose the "you wanted to edit" signal — when the user
    // retries (via reload after fixing whatever was wrong), they'd
    // start from cold instead of resuming the edit context.
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');
    fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 200));

    expect(
      document.querySelector('[role="alert"]'),
      'precondition: a 404 spec must surface a renderViewerError alert.',
    ).not.toBeNull();
    expect(
      sessionStorage.getItem(PENDING_EDIT_KEY),
      'expected the flag to PERSIST when mountViewer fails (AC 5.3 — consuming the flag on a failed mount would silently drop the user\'s edit intent; preserving it lets them retry on next load).',
    ).toBe('1');
  });
});

describe('Issue #91 / AC 5.3 — visible prompt: "your edit was paused" surface', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  const FRESH_TAURI_MOCKS = () => ({
    '@tauri-apps/api/event': { listen: vi.fn(async () => () => {}) },
    '@tauri-apps/plugin-dialog': { open: vi.fn(async () => null), save: vi.fn(async () => null) },
    '@tauri-apps/api/core': { invoke: vi.fn(async () => '') },
  });

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    document.body.innerHTML =
      '<header id="viewer-header"></header><div id="editor"></div>';
    document.title = 'Hashly';
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=README.md&ref=main');

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const tauriMocks = FRESH_TAURI_MOCKS();
    vi.doMock('@tauri-apps/api/event', () => tauriMocks['@tauri-apps/api/event']);
    vi.doMock('@tauri-apps/plugin-dialog', () => tauriMocks['@tauri-apps/plugin-dialog']);
    vi.doMock('@tauri-apps/api/core', () => tauriMocks['@tauri-apps/api/core']);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/core');
    sessionStorage.clear();
  });

  it('after auto-restore, a [data-testid="post-auth-prompt"] element appears in the DOM', async () => {
    // Per AC 5.3 wording: "If the user's pending action can't be
    // safely re-applied (e.g., it was a transient text input with
    // no captured payload), prompt them to re-do it." For MVP we
    // don't capture the payload — every restore shows the prompt.
    // The form factor (data-testid hook + visible) is what's pinned;
    // the exact copy / styling / role is builder discretion.
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');
    fetchSpy
      .mockResolvedValueOnce(new Response('# Spec', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    const prompt = document.querySelector<HTMLElement>(
      `[data-testid="${POST_AUTH_PROMPT_TESTID}"]`,
    );
    expect(
      prompt,
      `expected a [data-testid="${POST_AUTH_PROMPT_TESTID}"] element after auto-restore (AC 5.3 — "prompt them to re-do it"; the user just got bounced through GitHub auth and their original action was lost; without a prompt, they don't know they need to retry).`,
    ).not.toBeNull();
  });

  it('without the flag (no auto-restore), the prompt is NOT shown', async () => {
    // Symmetric negative pin: the prompt is exclusively tied to
    // the auto-restore path.
    fetchSpy.mockResolvedValueOnce(new Response('# Spec', { status: 200 }));

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 200));

    expect(
      document.querySelector(`[data-testid="${POST_AUTH_PROMPT_TESTID}"]`),
      'expected NO post-auth prompt for non-restore loads (AC 5.3 — the prompt is exclusively a "your edit was paused" notice; surfacing it on every load would mislead users).',
    ).toBeNull();
  });
});

describe('Issue #91 / AC 5.3 cross-pin — byte-equal frontmatter survives auto-restore', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  const FRESH_TAURI_MOCKS = () => ({
    '@tauri-apps/api/event': { listen: vi.fn(async () => () => {}) },
    '@tauri-apps/plugin-dialog': { open: vi.fn(async () => null), save: vi.fn(async () => null) },
    '@tauri-apps/api/core': { invoke: vi.fn(async () => '') },
  });

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    document.body.innerHTML =
      '<header id="viewer-header"></header><div id="editor"></div>';
    document.title = 'Hashly';
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=spec.md&ref=main');

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const tauriMocks = FRESH_TAURI_MOCKS();
    vi.doMock('@tauri-apps/api/event', () => tauriMocks['@tauri-apps/api/event']);
    vi.doMock('@tauri-apps/plugin-dialog', () => tauriMocks['@tauri-apps/plugin-dialog']);
    vi.doMock('@tauri-apps/api/core', () => tauriMocks['@tauri-apps/api/core']);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/core');
    sessionStorage.clear();
  });

  it('after auto-restore on a frontmatter doc, getViewerMarkdown re-emits byte-equal frontmatter', async () => {
    // The chain: fetchSpec → mountViewer (captures FM) →
    // attemptEditAction (200) → enterEditMode (re-mount preserving
    // FM via _remountAsEditable) → getViewerMarkdown round-trips
    // byte-equal. Any link in this chain that drops FM breaks the
    // #92 save flow; pin it end-to-end here.
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');

    const original = '---\ntitle: Spec\nauthor: dean\n---\n# Body\n\nprose\n';
    fetchSpy
      .mockResolvedValueOnce(new Response(original, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    const editorHost = document.getElementById('editor')!;
    const { getViewerMarkdown } = (await import('../viewer')) as unknown as {
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };

    const out = getViewerMarkdown(editorHost);
    expect(
      out,
      'expected getViewerMarkdown to return non-null after the auto-restore flip.',
    ).not.toBeNull();
    expect(
      out!.startsWith('---\ntitle: Spec\nauthor: dean\n---\n'),
      `expected the captured frontmatter to survive auto-restore byte-equal (AC 5.3 cross-pinned with AC 5.6 — the post-auth flip routes through enterEditMode; if the chain drops the captured FM at any link, the #92 save flow breaks before it ships). Output: ${JSON.stringify(out)}`,
    ).toBe(true);
    expect(
      out!,
      'expected the rendered body to be present in the round-trip.',
    ).toContain('Body');
  });
});
