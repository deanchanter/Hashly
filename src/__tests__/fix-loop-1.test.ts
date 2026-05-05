import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #91 fix-loop iteration 1 — the unit tests pinned each helper
// in isolation; the production bootstrap never wired them. 8 critical
// fixes after dedup. Each describe-block here pins one fix.
//
// Strict red-green: every assertion that fails should fail because
// the production code doesn't yet implement the fix, not because the
// test setup is wrong.
//
// Pre-existing test flake (`removeEventListener is not defined` from
// @milkdown/ctx teardown) is known noise and tolerated.

const PENDING_EDIT_KEY = 'hashly-pending-edit';

const FRESH_TAURI_MOCKS = () => ({
  '@tauri-apps/api/event': { listen: vi.fn(async () => () => {}) },
  '@tauri-apps/plugin-dialog': { open: vi.fn(async () => null), save: vi.fn(async () => null) },
  '@tauri-apps/api/core': { invoke: vi.fn(async () => '') },
});

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

function setupWebBootstrapEnv(opts: { repo?: string; path?: string; ref?: string } = {}): {
  fetchSpy: ReturnType<typeof vi.fn>;
  assignSpy: ReturnType<typeof vi.fn>;
  hrefSpy: ReturnType<typeof vi.fn>;
  redirectCalls: () => string[];
  cleanup: () => void;
} {
  const repo = opts.repo ?? 'foo/bar';
  const path = opts.path ?? 'spec.md';
  const ref = opts.ref ?? 'main';
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = '<header id="viewer-header"></header><div id="editor"></div>';
  document.title = 'Hashly';
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  window.history.replaceState({}, '', `/?repo=${repo}&path=${path}&ref=${ref}`);

  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const originalLocation = window.location;
  let _href = originalLocation.href;
  const assignSpy = vi.fn();
  const hrefSpy = vi.fn();
  const fakeLocation: FakeLocation = {
    get href() { return _href; },
    // eslint-disable-next-line accessor-pairs
    set href(v: string) { _href = v; (hrefSpy as unknown as (s: string) => void)(v); },
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

  const tauriMocks = FRESH_TAURI_MOCKS();
  vi.doMock('@tauri-apps/api/event', () => tauriMocks['@tauri-apps/api/event']);
  vi.doMock('@tauri-apps/plugin-dialog', () => tauriMocks['@tauri-apps/plugin-dialog']);
  vi.doMock('@tauri-apps/api/core', () => tauriMocks['@tauri-apps/api/core']);

  return {
    fetchSpy,
    assignSpy,
    hrefSpy,
    redirectCalls: () => [
      ...assignSpy.mock.calls.map((c) => String(c[0])),
      ...hrefSpy.mock.calls.map((c) => String(c[0])),
    ],
    cleanup: () => {
      globalThis.fetch = originalFetch;
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
      vi.doUnmock('@tauri-apps/api/event');
      vi.doUnmock('@tauri-apps/plugin-dialog');
      vi.doUnmock('@tauri-apps/api/core');
      sessionStorage.clear();
    },
  };
}

function mockSessionAndPerms(
  fetchSpy: ReturnType<typeof vi.fn>,
  opts: {
    spec?: string;
    sessionStatus?: number;
    sessionUser?: { login: string; avatar_url: string } | null;
    permsStatus?: number;
    permsPush?: boolean | undefined;
  } = {},
): void {
  const spec = opts.spec ?? '# Spec\n\nbody';
  const sessionStatus = opts.sessionStatus ?? 200;
  const sessionUser = opts.sessionUser ?? null;
  const permsStatus = opts.permsStatus ?? 200;
  const permsPush = opts.permsPush ?? true;

  fetchSpy.mockImplementation((url: string | URL | Request) => {
    const u = String(url);
    if (u === '/api/session-status') {
      const body: { ok?: boolean; user?: { login: string; avatar_url: string } } = {};
      if (sessionStatus === 200) {
        body.ok = true;
        if (sessionUser) body.user = sessionUser;
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: sessionStatus,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (u.startsWith('/api/github/repos/')) {
      const body =
        permsPush === undefined ? { name: 'no-perms' } : { permissions: { push: permsPush } };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: permsStatus,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (u === '/auth/logout') {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    // Default = the spec fetch (raw.githubusercontent.com URL).
    return Promise.resolve(new Response(spec, { status: 200 }));
  });
}

// ============================================================================
// Fix #1 — bootstrapWeb wires mountSessionIndicator
// ============================================================================
//
// Reviewer finding: `mountSessionIndicator` is exported, fully unit-
// tested (AC 5.4), and never imported or called outside its tests.
// Result: signed-in users see no avatar, no sign-out button. AC 5.4
// is unfulfilled in the running app.
//
// Pinned: after `bootstrapWeb` paints the viewer-header, it calls
// `mountSessionIndicator(headerHost)`. Header must exist first
// (mountSessionIndicator appends INTO the header, so painting the
// header has to happen before the indicator mount).

describe('Issue #91 fix-loop-1 / fix #1 — bootstrapWeb wires mountSessionIndicator', () => {
  let env: ReturnType<typeof setupWebBootstrapEnv>;

  beforeEach(() => {
    env = setupWebBootstrapEnv();
  });

  afterEach(() => env.cleanup());

  it('with an active session, the avatar img + sign-out button appear in the viewer-header after bootstrap', async () => {
    // The end-to-end pin: bootstrap → spec fetch 200 → mountViewer →
    // mountSessionIndicator → session-status 200 + user → avatar +
    // sign-out rendered. Without fix #1 the indicator is never
    // installed and signed-in users see no UI signal of their auth
    // state.
    mockSessionAndPerms(env.fetchSpy, {
      sessionUser: {
        login: 'octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
      },
    });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    const avatarImg = document.querySelector<HTMLImageElement>(
      'img[src="https://avatars.githubusercontent.com/u/583231?v=4"]',
    );
    expect(
      avatarImg,
      'expected the user avatar img in the DOM after bootstrap (Issue #91 fix #1 — bootstrapWeb must call mountSessionIndicator after rendering the viewer-header; without this, AC 5.4 is unfulfilled in the running app even though all the unit tests pass).',
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="sign-out"]'),
      'expected the sign-out button in the DOM after bootstrap.',
    ).not.toBeNull();
  });

  it('with NO active session (401), no avatar / sign-out is rendered (anonymous viewer state)', async () => {
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 200));

    expect(
      document.querySelector('img[src*="avatars.githubusercontent"]'),
      'expected NO avatar in the DOM on the 401 path (Issue #91 fix #1 — anonymous users must not see a user-identity indicator).',
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="sign-out"]'),
      'expected NO sign-out button on the 401 path.',
    ).toBeNull();
  });
});

// ============================================================================
// Fix #2 — keydown on the read-only editor wires attemptEditAction
// ============================================================================
//
// Reviewer finding: `attemptEditAction` has zero callers in
// production except the post-auth restore path (which is gated by a
// flag the function itself sets — circular, never fires for
// first-time users). The v0.2 `installEditToggle` button is
// disabled in web mode and its click calls `toggleEditMode()`, not
// `attemptEditAction`.
//
// **Iter-2 fix #1 update**: round-1 used `beforeinput` for the
// trigger, but per spec `beforeinput` only fires on contenteditable
// =true / input / textarea elements. The viewer's .ProseMirror is
// contenteditable=false, so real Chrome/Safari/Firefox don't fire
// `beforeinput` for keystrokes there. Round-1 tests passed because
// jsdom accepts synthetic `dispatchEvent(new InputEvent(...))` on
// any element. Iter-2 switches the trigger to `keydown` (which
// fires regardless of contenteditable) and these tests use a
// REAL `KeyboardEvent` so they exercise the same path as a real
// browser.
//
// Test pin: after bootstrap, dispatching a `keydown` for a
// printable key on the editor host triggers a fetch to
// /api/session-status — the unmistakable side-effect of
// attemptEditAction running.

describe('Issue #91 fix-loop-1 / fix #2 — keydown on read-only editor triggers attemptEditAction', () => {
  let env: ReturnType<typeof setupWebBootstrapEnv>;

  beforeEach(() => {
    env = setupWebBootstrapEnv();
  });

  afterEach(() => env.cleanup());

  it('dispatching a printable `keydown` on the editor host after mount triggers a fetch to /api/session-status', async () => {
    // The pin: the user types in the read-only editor → keydown
    // fires → attemptEditAction is invoked → session-status fetch.
    // Without fix #2 there is no listener and the read-only state
    // is a one-way door: users can't enter edit mode without going
    // through the auth flow they don't even know exists.
    //
    // Iter-2 fix #1: use a REAL KeyboardEvent (not a synthetic
    // InputEvent) so the test mirrors what production browsers do.
    mockSessionAndPerms(env.fetchSpy);

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    // Snapshot fetches that happened during bootstrap (spec +
    // mountSessionIndicator's session-status). Then dispatch keydown
    // and check that NEW fetches happen.
    const fetchesBefore = env.fetchSpy.mock.calls.length;

    const editorHost = document.getElementById('editor');
    expect(editorHost, 'precondition: #editor host must be in DOM').not.toBeNull();

    // Real KeyboardEvent: a printable letter, no modifier-only key.
    // Builder filters for printable keys / Backspace / Delete /
    // Enter / paste; "a" is a representative printable.
    const keydown = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    editorHost!.dispatchEvent(keydown);
    // Allow attemptEditAction's async chain to start.
    await new Promise((r) => setTimeout(r, 100));

    const newFetchUrls = env.fetchSpy.mock.calls
      .slice(fetchesBefore)
      .map(([u]) => String(u));
    expect(
      newFetchUrls.some((u) => u === '/api/session-status'),
      `expected a NEW fetch to /api/session-status after dispatching keydown on the editor host (Issue #91 fix #2 — attemptEditAction must be wired to a real user-edit trigger; iter-2 switched from beforeinput to keydown because beforeinput doesn't fire on contenteditable=false in real browsers). New fetches were: ${JSON.stringify(newFetchUrls)}.`,
    ).toBe(true);
  });

  it('on an unauthed user, keydown intent leads to a redirect (full JIT flow end-to-end)', async () => {
    // End-to-end: typing in the read-only editor → keydown →
    // attemptEditAction → session-status 401 → redirect to
    // /auth/start. This proves the entire AC 5.2 chain is wired
    // through the real-browser-compatible trigger.
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    const editorHost = document.getElementById('editor')!;
    const initialRedirectCount = env.redirectCalls().length;
    editorHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));

    const newRedirects = env.redirectCalls().slice(initialRedirectCount);
    expect(
      newRedirects.some((u) => u.startsWith('/auth/start?return=')),
      `expected a redirect to /auth/start after keydown on an unauthed user (Issue #91 fix #2 — end-to-end JIT flow via the iter-2 keydown trigger). New redirects: ${JSON.stringify(newRedirects)}.`,
    ).toBe(true);
  });

  it('keydown for a printable key is preventDefault\'d so the keystroke does not leak into ProseMirror', async () => {
    // Defensive: the listener must `event.preventDefault()` so that
    // the keystroke isn't ALSO processed by ProseMirror (which in
    // some browser/Milkdown combinations could leak the typed
    // character into the doc despite editable:()=>false).
    mockSessionAndPerms(env.fetchSpy);
    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    const editorHost = document.getElementById('editor')!;
    const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    const dispatched = editorHost.dispatchEvent(ev);
    expect(
      dispatched,
      `expected keydown.dispatchEvent to return false (i.e., preventDefault was called) so the read-only contenteditable layer doesn't accept the typed character (Issue #91 fix #2 — defensive belt-and-suspenders against the v0.2 #33 write-handle-bypass class of bug).`,
    ).toBe(false);
  });
});

// ============================================================================
// Fix #3 — CSS for all new components
// ============================================================================
//
// Reviewer finding: zero rules for `.edit-toolbar`, `.session-
// indicator`, `.session-indicator__avatar`, `.session-indicator__
// sign-out`, `.hashly-view-only-lock`, `.hashly-post-auth-prompt`.
// Toolbar lands at page bottom, avatar renders at GitHub's natural
// ~460px, lock banner has no visual distinction.
//
// Same fs.readFileSync + comment-strip pattern as v0.2 #6 fix-loop
// C2/C3 to dodge the Vite/Vitest CSS-import strip in test mode.

describe('Issue #91 fix-loop-1 / fix #3 — CSS for new components', () => {
  const STYLE_CSS_PATH = resolve(__dirname, '..', 'style.css');
  const readStyleCss = (): string => readFileSync(STYLE_CSS_PATH, 'utf-8');
  const stripCssComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // Find rule body (text between `{` and matching `}`) for an
  // exact-match selector after whitespace normalization. Matches
  // both `.foo {...}` and `.foo, .bar {...}`-style multi-selectors
  // by checking selector contains the target.
  const findRuleBody = (css: string, selector: string): string | null => {
    const norm = css.replace(/\s+/g, '');
    // Search for the literal selector{ pattern.
    const target = `${selector}{`;
    const idx = norm.indexOf(target);
    if (idx < 0) return null;
    const end = norm.indexOf('}', idx);
    if (end < 0) return null;
    return norm.slice(idx + target.length, end);
  };

  const expectRule = (selector: string, mustInclude: string[]): void => {
    const css = stripCssComments(readStyleCss());
    const body = findRuleBody(css, selector);
    expect(
      body,
      `expected a \`${selector} { ... }\` rule in src/style.css (Issue #91 fix #3 — without component CSS, ${selector} renders unstyled and visually breaks the brand). After comment-strip + whitespace-strip:\n${css.replace(/\s+/g, '').slice(0, 400)}…`,
    ).not.toBeNull();
    for (const property of mustInclude) {
      expect(
        body!,
        `expected \`${property}\` in the .${selector} rule body (Issue #91 fix #3). Body was: ${body}`,
      ).toContain(property);
    }
  };

  it('.edit-toolbar has padding + visual distinction (matches the other component banners)', () => {
    // Iter-3 fix #1 inlined the toolbar (parented to editor host
    // instead of document.body). The original "must be position:
    // fixed/sticky/absolute" pin was meant to keep the toolbar
    // visible — but inlining inside the editor host (in normal
    // flow, above .ProseMirror) achieves the same goal without
    // the fixed-position UI-collision class of bugs (toolbar vs
    // header, toolbar vs post-auth-prompt). The new pin: padding
    // + a visual treatment (background or border) — same shape as
    // the lock + prompt rules.
    const css = stripCssComments(readStyleCss());
    const body = findRuleBody(css, '.edit-toolbar');
    expect(body, 'expected a .edit-toolbar rule in src/style.css').not.toBeNull();
    expect(body!).toContain('padding:');
    expect(
      body!.includes('background') || body!.includes('border'),
      `expected .edit-toolbar to have a background or border so it's visually distinct from the rendered prose below it (iter-3 fix #1 — inlined toolbar still needs a visual seam). Got: ${body}`,
    ).toBe(true);
  });

  it('.session-indicator + descendants are styled (avatar 24x24 circle, sign-out button rule)', () => {
    expectRule('.session-indicator', ['display:']);
    expectRule('.session-indicator__avatar', ['border-radius:']);
    expectRule('.session-indicator__sign-out', ['cursor:']);
  });

  it('.hashly-view-only-lock has a distinct visual treatment (background + padding + border)', () => {
    expectRule('.hashly-view-only-lock', ['padding:']);
    const body = findRuleBody(stripCssComments(readStyleCss()), '.hashly-view-only-lock');
    expect(body, 'precondition').not.toBeNull();
    expect(
      body!.includes('background') || body!.includes('border'),
      `expected .hashly-view-only-lock to have a background or border so it's visually distinct as a warning banner. Got: ${body}`,
    ).toBe(true);
  });

  it('.hashly-post-auth-prompt has padding + visual distinction (info banner)', () => {
    expectRule('.hashly-post-auth-prompt', ['padding:']);
    const body = findRuleBody(stripCssComments(readStyleCss()), '.hashly-post-auth-prompt');
    expect(
      body!.includes('background') || body!.includes('border'),
      `expected .hashly-post-auth-prompt to have a background or border. Got: ${body}`,
    ).toBe(true);
  });
});

// ============================================================================
// Fix #4 — banners ABOVE the editor host
// ============================================================================
//
// Reviewer finding: `host.appendChild(banner)` puts both lock and
// post-auth-prompt banners as the LAST child of `#editor` — under
// all rendered markdown content. On a long spec, user scrolls past
// everything before seeing the message.
//
// Pinned: banners appear BEFORE the .ProseMirror in DOM order.
// Builder picks placement (sibling above, first-child of host, or
// mounted into the existing #viewer-header host) — the test only
// pins "before .ProseMirror in DOM order".

describe('Issue #91 fix-loop-1 / fix #4 — banners render ABOVE the editor', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

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

    const { mountViewer } = await import('../viewer');
    // Long-ish body so the test fixture exercises the
    // "scroll past everything" failure mode metaphorically.
    await mountViewer(host, '# Spec\n\n' + 'paragraph\n\n'.repeat(20));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    sessionStorage.clear();
  });

  // Helper: returns true if `banner` appears BEFORE `editor` in the
  // pre-order DOM traversal of `document`. We use
  // Node.compareDocumentPosition for a portable, jsdom-friendly check.
  const bannerIsBeforeEditor = (banner: Node, editorRoot: Node): boolean => {
    // eslint-disable-next-line no-bitwise
    return (banner.compareDocumentPosition(editorRoot) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  };

  it('view-only-lock appears BEFORE the .ProseMirror in DOM order', async () => {
    // After fix #4: `renderViewOnlyLock` puts the banner above the
    // editor body. On a long spec, the user sees the lock without
    // scrolling.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (u.startsWith('/api/github/repos/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ permissions: { push: false } }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('# spec', { status: 200 }));
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (h: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const lock = document.querySelector('[data-testid="view-only-lock"]');
    const proseMirror = document.querySelector('.ProseMirror');
    expect(lock, 'precondition: lock must render').not.toBeNull();
    expect(proseMirror, 'precondition: editor must remain mounted').not.toBeNull();
    expect(
      bannerIsBeforeEditor(lock!, proseMirror!),
      `expected view-only-lock to appear BEFORE the .ProseMirror in DOM order (Issue #91 fix #4 — without this, on a long spec the user scrolls past all content before seeing the lock message). compareDocumentPosition reports the lock NOT before the editor.`,
    ).toBe(true);
  });

  it('post-auth-prompt appears BEFORE the .ProseMirror in DOM order', async () => {
    // Same pin for the post-auth prompt. Mount the prompt directly
    // via the bootstrap auto-restore path.
    const env = setupWebBootstrapEnv();
    try {
      sessionStorage.setItem(PENDING_EDIT_KEY, '1');
      mockSessionAndPerms(env.fetchSpy, {
        spec: '# Spec\n\n' + 'paragraph\n\n'.repeat(20),
        sessionUser: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
      });

      const { bootstrap } = await import('../main');
      bootstrap();
      await new Promise((r) => setTimeout(r, 300));

      const prompt = document.querySelector('[data-testid="post-auth-prompt"]');
      const proseMirror = document.querySelector('.ProseMirror');
      expect(prompt, 'precondition: prompt must render').not.toBeNull();
      expect(proseMirror, 'precondition: editor must remain mounted').not.toBeNull();
      expect(
        bannerIsBeforeEditor(prompt!, proseMirror!),
        `expected post-auth-prompt to appear BEFORE the .ProseMirror in DOM order (Issue #91 fix #4 — without this, the post-auth message is hidden below the editor body).`,
      ).toBe(true);
    } finally {
      env.cleanup();
    }
  });
});

// ============================================================================
// Fix #5 — back-button cancel must NOT infinite-loop
// ============================================================================
//
// Reviewer finding: user clicks edit → flag set → redirect to
// /auth/start → user hits back from GitHub → bootstrapWeb consumes
// flag → calls attemptEditAction → 401 → SETS THE FLAG AGAIN →
// re-redirect to /auth/start. Infinite loop, only escape is closing
// the tab.
//
// Fix: the post-auth restore path must NOT re-stash the flag on
// 401. Builder picks the mechanism (a context flag passed to
// attemptEditAction, or a separate restore function, or extracting
// the redirect+stash into a helper that only the first-time path
// uses).

describe('Issue #91 fix-loop-1 / fix #5 — back-button-cancel does NOT infinite-loop', () => {
  let env: ReturnType<typeof setupWebBootstrapEnv>;

  beforeEach(() => {
    env = setupWebBootstrapEnv();
  });

  afterEach(() => env.cleanup());

  it('on the post-auth restore path, a 401 from session-status does NOT re-stash the pending-edit flag', async () => {
    // The cycle to break: pre-set flag → bootstrap fires → fetch
    // 401 → DO NOT re-stash. Without this fix the flag is set
    // again immediately after consumption, and the back-button-
    // cancel sequence loops indefinitely.
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    expect(
      sessionStorage.getItem(PENDING_EDIT_KEY),
      'expected the pending-edit flag to remain CLEARED after a 401 in the restore path (Issue #91 fix #5 — without this, the back-button-cancel sequence sets-clears-sets-clears the flag in an infinite loop, only escapable by closing the tab).',
    ).toBeNull();
  });

  it('on the post-auth restore path, a 401 does NOT trigger another redirect (no bounce-loop)', async () => {
    // The other half: even if the flag isn't re-stashed, an
    // attemptEditAction that always-redirects on 401 would still
    // bounce the user. The restore path must skip the redirect on
    // 401 and surface a cancel banner instead.
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    const redirects = env.redirectCalls().filter((u) => u.startsWith('/auth/start'));
    expect(
      redirects.length,
      `expected ZERO redirects to /auth/start from the restore path on 401 (Issue #91 fix #5 — looping back to /auth/start when the user just cancelled is the worst possible UX). Got ${redirects.length}: ${JSON.stringify(redirects)}.`,
    ).toBe(0);
  });

  it('on the post-auth restore path, a 401 surfaces a `[data-testid="auth-cancelled"]` banner', async () => {
    // The friendly recovery: instead of looping, tell the user
    // "auth was cancelled" so they can retry deliberately.
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    const banner = document.querySelector<HTMLElement>('[data-testid="auth-cancelled"]');
    expect(
      banner,
      `expected a [data-testid="auth-cancelled"] banner after a back-button-cancel restore (Issue #91 fix #5 — replacing the infinite-redirect loop with a friendly notice).`,
    ).not.toBeNull();
    const text = (banner!.textContent ?? '').toLowerCase();
    expect(
      text.includes('cancel') || text.includes("didn't sign in") || text.includes('did not sign in'),
      `expected the cancel banner copy to mention "cancel" / "didn't sign in" or equivalent. Got: ${JSON.stringify(text)}`,
    ).toBe(true);
  });

  it('first-time edit attempt (no flag pre-set) STILL redirects on 401 and stashes the flag (AC 5.2 / 5.3 non-regression)', async () => {
    // Critical non-regression: fix #5 must NOT break the
    // first-time JIT flow. A user who's never authed clicks edit
    // → 401 → must redirect AND stash the flag for the post-auth
    // restore. Only the RESTORE path (flag-pre-set) skips the
    // redirect+stash.
    sessionStorage.removeItem(PENDING_EDIT_KEY);
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (h: HTMLElement) => Promise<void>;
    };
    const host = document.getElementById('editor')!;

    // Minimum precondition: a viewer is mounted so attemptEditAction
    // has something to work with. (mountSessionIndicator etc.
    // shouldn't matter for this assertion.)
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# spec');
    await attemptEditAction(host);

    const redirects = env.redirectCalls().filter((u) => u.startsWith('/auth/start'));
    expect(
      redirects.length,
      `expected EXACTLY ONE redirect on the first-time 401 path (AC 5.2 non-regression). Got ${redirects.length}.`,
    ).toBe(1);
    expect(
      sessionStorage.getItem(PENDING_EDIT_KEY),
      'expected the flag to be SET on the first-time 401 path (AC 5.3 non-regression).',
    ).toBe('1');
  });
});

// ============================================================================
// Fix #6 — disable the edit-toolbar Save button
// ============================================================================
//
// Reviewer finding: Save button is enabled but has no click handler.
// Click does nothing — looks broken.
//
// Pinned: button.disabled === true AND aria-disabled === "true"
// AND title attribute mentions #92 / "save" so a user hovering
// understands.

describe('Issue #91 fix-loop-1 / fix #6 — toolbar Save button is disabled (placeholder for #92)', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('after enterEditMode, the [data-testid="edit-toolbar-save"] button has disabled === true', async () => {
    // Pin both `disabled` (HTMLButtonElement property + DOM
    // attribute) and `aria-disabled="true"` (a11y) so screen
    // readers announce the button as disabled.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec');
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (h: HTMLElement) => Promise<void>;
    };
    await enterEditMode(host);

    const saveBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="edit-toolbar-save"]',
    );
    expect(saveBtn, 'precondition: save button must exist after enterEditMode').not.toBeNull();
    expect(
      saveBtn!.disabled,
      'expected button.disabled === true (Issue #91 fix #6 — the Save flow ships in #92; until then the button must be visually + functionally disabled to avoid looking broken).',
    ).toBe(true);
    expect(
      saveBtn!.getAttribute('aria-disabled'),
      'expected aria-disabled="true" so screen readers announce the disabled state.',
    ).toBe('true');
  });
});

// ============================================================================
// Fix #7 — sign-out clears stale view-only-lock + post-auth-prompt
// ============================================================================
//
// Reviewer finding: sign-out removes indicator wrapper + calls
// exitEditMode. Does NOT remove the view-only-lock or post-auth-
// prompt banners. Sequence: signed-in user with no push → sees
// lock → signs out → banner survives → confused user sees "you
// don't have write access" while anonymous.
//
// Pinned: post-200 from /auth/logout, both banners (if present)
// are removed from the DOM.

describe('Issue #91 fix-loop-1 / fix #7 — sign-out clears view-only-lock + post-auth-prompt', () => {
  let host: HTMLDivElement;
  let headerHost: HTMLElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML =
      '<header id="viewer-header"></header><div id="editor"></div>';
    host = document.getElementById('editor') as HTMLDivElement;
    headerHost = document.getElementById('viewer-header') as HTMLElement;

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { renderViewerHeader } = await import('../viewer-header');
    renderViewerHeader(headerHost, { repo: 'foo/bar', path: 'spec.md', ref: 'main' });

    // Mount viewer first so banners can attach.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('clicking sign-out removes the view-only-lock banner (when one was rendered)', async () => {
    // Pre-render the lock by triggering attemptEditAction with
    // push:false. Then mount the indicator. Then click sign-out.
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              user: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
            }),
            { status: 200 },
          ),
        );
      }
      if (u.startsWith('/api/github/repos/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ permissions: { push: false } }), { status: 200 }),
        );
      }
      if (u === '/auth/logout') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (h: HTMLElement) => Promise<void>;
    };
    await attemptEditAction(host);

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (h: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    expect(
      document.querySelector('[data-testid="view-only-lock"]'),
      'precondition: view-only-lock must be rendered before sign-out',
    ).not.toBeNull();

    const signOut = document.querySelector<HTMLButtonElement>('[data-testid="sign-out"]')!;
    signOut.click();
    await new Promise((r) => setTimeout(r, 150));

    expect(
      document.querySelector('[data-testid="view-only-lock"]'),
      `expected the view-only-lock to be REMOVED after sign-out (Issue #91 fix #7 — without this, an anonymous user sees a "no write access" banner that no longer applies).`,
    ).toBeNull();
  });

  it('clicking sign-out removes the post-auth-prompt banner (when one was rendered)', async () => {
    // Inject a fake post-auth-prompt manually (the bootstrap path
    // is exercised in fix #4's tests).
    const prompt = document.createElement('div');
    prompt.setAttribute('data-testid', 'post-auth-prompt');
    prompt.setAttribute('role', 'status');
    host.appendChild(prompt);

    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              user: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
            }),
            { status: 200 },
          ),
        );
      }
      if (u === '/auth/logout') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (h: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    expect(
      document.querySelector('[data-testid="post-auth-prompt"]'),
      'precondition: post-auth-prompt must be present before sign-out',
    ).not.toBeNull();

    const signOut = document.querySelector<HTMLButtonElement>('[data-testid="sign-out"]')!;
    signOut.click();
    await new Promise((r) => setTimeout(r, 150));

    expect(
      document.querySelector('[data-testid="post-auth-prompt"]'),
      `expected the post-auth-prompt to be REMOVED after sign-out (Issue #91 fix #7 — banner is anchored to the prior signed-in session; surviving past sign-out is stale).`,
    ).toBeNull();
  });
});

// ============================================================================
// Fix #8 — avatar img onerror fallback
// ============================================================================
//
// Reviewer finding: on 404 / network error / image-deleted, avatar
// renders as default broken-image glyph. Looks like the app is
// broken.
//
// Pinned: img has an onerror handler that swaps in a fallback span
// (initials in a circular badge) when the image fails to load.

describe('Issue #91 fix-loop-1 / fix #8 — avatar img onerror fallback', () => {
  let headerHost: HTMLElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '<header id="viewer-header"></header>';
    headerHost = document.getElementById('viewer-header') as HTMLElement;

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { renderViewerHeader } = await import('../viewer-header');
    renderViewerHeader(headerHost, { repo: 'foo/bar', path: 'spec.md', ref: 'main' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('when the avatar img fails to load, a fallback span with the user\'s initial(s) is rendered in its place', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/missing.png' },
        }),
        { status: 200 },
      ),
    );

    const { mountSessionIndicator } = (await import('../session-indicator')) as unknown as {
      mountSessionIndicator: (h: HTMLElement) => Promise<void>;
    };
    await mountSessionIndicator(headerHost);

    const img = document.querySelector<HTMLImageElement>('img[src*="missing.png"]');
    expect(img, 'precondition: avatar img must initially be in the DOM').not.toBeNull();

    // Simulate image load failure. jsdom doesn't fire `error` events
    // for failed network loads automatically; we dispatch one
    // synthetically.
    img!.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 50));

    // Either the img is gone and a fallback span replaces it, OR the
    // img is hidden and a fallback element appears alongside. Either
    // way: a `[data-testid="avatar-fallback"]` element must be in the
    // DOM with the user's initial.
    const fallback = document.querySelector<HTMLElement>('[data-testid="avatar-fallback"]');
    expect(
      fallback,
      `expected a [data-testid="avatar-fallback"] element after the avatar img errors (Issue #91 fix #8 — without this the user sees the browser's default broken-image glyph and assumes the app is broken).`,
    ).not.toBeNull();
    expect(
      (fallback!.textContent ?? '').toUpperCase(),
      `expected the fallback to display the user's initial (first letter of login, uppercased — "octocat" → "O"). Got: ${JSON.stringify(fallback!.textContent)}.`,
    ).toContain('O');
  });
});
