import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #91 fix-loop iteration 3 — 2 critical findings from review
// round 3. THIS IS THE LAST FIX-LOOP ITERATION per the skill cap
// (3 iterations max).
//
// Fix #1 inlines the toolbar inside the editor host so it stops
// colliding with above-fold UI (header in iter-2 fix #3, post-auth-
// prompt in iter-3 fix #1). Same root-cause class of bug — the
// inlining removes the entire fixed-position UI-collision surface.
//
// Fix #2 closes the keystroke-storm vulnerability: in the locked
// state (200 + push:false), every keystroke fires a fresh
// session-status + perms fetch chain because the listener wasn't
// removed on the locked terminal. Held key at OS autorepeat
// exhausts GitHub's 5000/hr install rate limit in ~85 seconds.

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

function setupWebBootstrapEnv(): {
  fetchSpy: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = '<header id="viewer-header"></header><div id="editor"></div>';
  document.title = 'Hashly';
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  window.history.replaceState({}, '', '/?repo=foo/bar&path=spec.md&ref=main');

  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const originalLocation = window.location;
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

  const tauriMocks = FRESH_TAURI_MOCKS();
  vi.doMock('@tauri-apps/api/event', () => tauriMocks['@tauri-apps/api/event']);
  vi.doMock('@tauri-apps/plugin-dialog', () => tauriMocks['@tauri-apps/plugin-dialog']);
  vi.doMock('@tauri-apps/api/core', () => tauriMocks['@tauri-apps/api/core']);

  return {
    fetchSpy,
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
    return Promise.resolve(new Response(spec, { status: 200 }));
  });
}

// ============================================================================
// Iter-3 fix #1 — edit-toolbar inlined inside editor host (no more fixed-pos)
// ============================================================================
//
// Reviewer finding (round 3): iter-2 fix #3 moved the toolbar from
// `top: 0.75rem` to `top: 4rem` to dodge the header. But the
// success-restore path (the most common AC 5.3 codepath) prepends a
// post-auth-prompt to #editor, which sits at y≈87-131px — squarely
// where the toolbar at y=64-109px lives. ~70% of "You're signed in"
// is hidden behind the toolbar.
//
// Same root-cause class as iter-2 fix #3. The fix MOVED the
// collision rather than ELIMINATING it. Iter-3 inlines the toolbar
// (parents it to the editor host, drops position:fixed) so it lives
// in normal flow and can't overlap any sibling.
//
// Bonus: closes the carry-over "toolbar parented to document.body
// has decoupled lifecycle" non-critical for free.

describe('Issue #91 fix-loop-3 / fix #1 — edit-toolbar is inlined inside the editor host', () => {
  let env: ReturnType<typeof setupWebBootstrapEnv>;

  beforeEach(() => {
    env = setupWebBootstrapEnv();
  });

  afterEach(() => env.cleanup());

  it('after enterEditMode, the [data-testid="edit-toolbar"] lives INSIDE the editor host (not in <body>)', async () => {
    // The load-bearing pin. Inlining means parented to the host
    // (#editor); document.body would mean the legacy fixed-pos
    // shape that caused both iter-2 fix #3 and this iter-3 fix.
    mockSessionAndPerms(env.fetchSpy);

    const { mountViewer } = await import('../viewer');
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (h: HTMLElement) => Promise<void>;
    };

    const host = document.getElementById('editor')!;
    await mountViewer(host, '# Spec\n');
    await enterEditMode(host);

    const toolbar = document.querySelector<HTMLElement>('[data-testid="edit-toolbar"]');
    expect(toolbar, 'precondition: toolbar must be in DOM after enterEditMode').not.toBeNull();
    expect(
      host.contains(toolbar),
      `expected the edit-toolbar to be a descendant of the editor host (#editor) (Iter-3 fix #1 — inlining the toolbar prevents the fixed-position UI-collision class of bugs that hit twice in iter-2 + iter-3). Toolbar's actual parent: ${toolbar?.parentElement?.tagName.toLowerCase()}#${toolbar?.parentElement?.id ?? ''}.`,
    ).toBe(true);
    expect(
      toolbar!.parentElement === document.body,
      'expected the edit-toolbar to NOT be a direct child of <body> (the legacy parent that produced the fixed-position collision). Inlined toolbars live inside the editor host.',
    ).toBe(false);
  });

  it('on the success-restore path, post-auth-prompt + edit-toolbar both render WITHOUT overlap (both inline children of host)', async () => {
    // The exact bug pinned: success-restore renders both prompt
    // AND toolbar. Pre-fix, toolbar was fixed-position over the
    // prompt. Post-fix, both are inline children of #editor and
    // can't overlap (no position:fixed on either).
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');
    mockSessionAndPerms(env.fetchSpy, {
      sessionUser: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
    });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 300));

    const host = document.getElementById('editor')!;
    const toolbar = document.querySelector<HTMLElement>('[data-testid="edit-toolbar"]');
    const prompt = document.querySelector<HTMLElement>('[data-testid="post-auth-prompt"]');

    expect(toolbar, 'precondition: toolbar must render on success-restore').not.toBeNull();
    expect(prompt, 'precondition: post-auth-prompt must render on success-restore').not.toBeNull();

    expect(
      host.contains(toolbar),
      'expected toolbar to live inside the editor host on the success-restore path (iter-3 fix #1).',
    ).toBe(true);
    expect(
      host.contains(prompt),
      'expected post-auth-prompt to live inside the editor host (iter-1 fix #4).',
    ).toBe(true);

    // Layout-overlap check: in jsdom layout is degenerate (returns
    // zeros), but if both elements are in normal flow inside the
    // same parent and neither has position:fixed/absolute, they
    // can't overlap. We verify this via getComputedStyle's
    // `position` value as a proxy for "is it taken out of flow".
    const toolbarPosition = getComputedStyle(toolbar!).position;
    expect(
      toolbarPosition === 'fixed' || toolbarPosition === 'absolute',
      `expected toolbar's computed position to NOT be fixed/absolute on the success-restore path (iter-3 fix #1 — inlining means the toolbar is in normal flow and can't overlap the prompt). Got: ${toolbarPosition}.`,
    ).toBe(false);
  });

  it('static CSS — `.edit-toolbar` rule does NOT contain `position: fixed`', () => {
    // The static contract: post-iter-3, the toolbar's CSS no
    // longer uses position:fixed. This catches a regression where
    // a future contributor re-adds fixed positioning to "fix" a
    // styling concern and re-introduces the collision class.
    const STYLE_CSS_PATH = resolve(__dirname, '..', 'style.css');
    const css = readFileSync(STYLE_CSS_PATH, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const norm = css.replace(/\s+/g, '');
    const target = '.edit-toolbar{';
    const idx = norm.indexOf(target);
    expect(idx, 'precondition: .edit-toolbar rule must exist').toBeGreaterThanOrEqual(0);
    const end = norm.indexOf('}', idx);
    const body = norm.slice(idx + target.length, end);

    expect(
      /position:fixed(?:;|$)/.test(body),
      `expected .edit-toolbar to NOT use position:fixed (iter-3 fix #1 — inlining the toolbar removes the entire fixed-position UI-collision class of bugs that we hit in iter-2 fix #3 AND iter-3 fix #1). Got body: ${body}`,
    ).toBe(false);
  });
});

// ============================================================================
// Iter-3 fix #2 — listener self-removes on locked terminal too
// ============================================================================
//
// Reviewer finding (round 3): iter-2 fix #1 self-removes the
// keydown listener only when `attemptEditAction` returns 'success'.
// The locked terminal (200 + push:false) currently returns
// `undefined` (per builder's iter-2 simpler 'success' | undefined
// shape). Listener stays attached.
//
// Effect: every subsequent keystroke fires the FULL JIT chain
// again. session-status (200) + /api/github/repos (200, push:false)
// + renderViewOnlyLock (idempotent). Two HTTP round-trips per
// keystroke for no user benefit. Held key at OS autorepeat (~30/s)
// = ~60 worker requests/sec per user. ~85 seconds of held-down
// typing exhausts the GitHub 5000/hr install rate limit.
//
// Fix shape: extend `attemptEditAction` return shape so locked is
// distinguishable. Listener removes on success OR locked. Cancelled
// (401) and error paths KEEP the listener (user might want to
// retry). Builder picks the exact discriminant — test pins
// observable behavior (post-locked keydowns make zero new fetches;
// post-cancelled keydowns DO fire another fetch).

describe('Issue #91 fix-loop-3 / fix #2 — listener self-removes on locked terminal', () => {
  let env: ReturnType<typeof setupWebBootstrapEnv>;

  beforeEach(() => {
    env = setupWebBootstrapEnv();
  });

  afterEach(() => env.cleanup());

  it('after a locked terminal (200 + push:false), 5 keydowns fire ZERO additional fetches', async () => {
    // The keystroke-storm pin. After the first keydown reaches the
    // locked terminal, the listener must self-remove so subsequent
    // keystrokes don't multiply the fetch count.
    mockSessionAndPerms(env.fetchSpy, { permsPush: false });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 300));

    const editorHost = document.getElementById('editor')!;

    // First keydown: triggers attemptEditAction → 200+push:false →
    // renderViewOnlyLock. Listener should self-remove on this
    // 'locked' terminal (after fix #2).
    editorHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 200));

    // Verify lock rendered (precondition; if no lock, the test
    // isn't exercising the locked path).
    expect(
      document.querySelector('[data-testid="view-only-lock"]'),
      'precondition: first keydown must reach the view-only-lock terminal (otherwise fix #2 isn\'t exercised).',
    ).not.toBeNull();

    const fetchesAfterLocked = env.fetchSpy.mock.calls.length;

    // Five subsequent keydowns. Without fix #2 each would fire
    // another session-status + perms pair (10 new fetches total).
    for (const key of ['b', 'c', 'd', 'e', 'f']) {
      editorHost.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    await new Promise((r) => setTimeout(r, 150));

    const newFetches = env.fetchSpy.mock.calls.slice(fetchesAfterLocked);
    const sessionFetches = newFetches.filter(([u]) => String(u) === '/api/session-status');
    const permsFetches = newFetches.filter(([u]) => String(u).startsWith('/api/github/repos/'));
    expect(
      sessionFetches.length,
      `expected ZERO new /api/session-status fetches after the editor enters locked state (Iter-3 fix #2 — without listener removal on the locked terminal, every keystroke fires the JIT chain; 5 keystrokes = 10 worker requests; held key at OS autorepeat exhausts the 5000/hr install rate limit in ~85 seconds). Got ${sessionFetches.length} new session-status fetches.`,
    ).toBe(0);
    expect(
      permsFetches.length,
      `expected ZERO new perms fetches after locked state (same reasoning).`,
    ).toBe(0);
  });

  it('after a success terminal, keydowns fire ZERO additional fetches (iter-2 fix #1 regression pin)', async () => {
    // Non-regression: iter-2 fix #1's "listener removes on success"
    // contract MUST keep working alongside fix #2's locked-removal.
    mockSessionAndPerms(env.fetchSpy);

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 300));

    const editorHost = document.getElementById('editor')!;
    editorHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 200));

    expect(
      document.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: first keydown must flip into edit mode',
    ).toBe('true');

    const fetchesAfterFlip = env.fetchSpy.mock.calls.length;

    editorHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));

    expect(
      env.fetchSpy.mock.calls.length - fetchesAfterFlip,
      `expected ZERO new fetches after success-flip (Iter-2 fix #1 regression pin). Got ${env.fetchSpy.mock.calls.length - fetchesAfterFlip}.`,
    ).toBe(0);
  });

  it('after a cancelled terminal (401), the listener IS still attached (existing behavior preserved per team-lead)', async () => {
    // Cancelled is the back-button-cancel path: user landed on
    // /auth/start, hit back, returned to spec without auth'ing.
    // Per team-lead's iter-3 brief, the listener KEEPS attached so
    // the user can retry by typing again — the auth-cancelled
    // banner copy explicitly says "try editing again to retry".
    // Don't fix the "accidentally re-redirect" UX gripe here; that's
    // filed as a non-critical follow-up.
    //
    // NOTE: this test exercises the FIRST-TIME 401 path (no flag
    // pre-set), not the restore path. The restore path's 401
    // (iter-1 fix #5) doesn't redirect — but we're testing the
    // FIRST-TIME path here, where 401 redirects normally. After
    // the first keydown the user is bounced; we verify the
    // listener was still active for that bounce.
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 300));

    const editorHost = document.getElementById('editor')!;
    const fetchesBefore = env.fetchSpy.mock.calls.length;

    editorHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 200));

    const newFetches = env.fetchSpy.mock.calls.slice(fetchesBefore);
    const sessionFetches = newFetches.filter(([u]) => String(u) === '/api/session-status');
    expect(
      sessionFetches.length,
      `expected the keydown listener to still be active on the first-time-401 path (the JIT redirect IS the desired behavior here; cancelled terminal is reached only after a back-button-cancel restore, not a first-time auth attempt). Got ${sessionFetches.length} session-status fetches; expected at least 1.`,
    ).toBeGreaterThanOrEqual(1);
  });

  it('attemptEditAction returns a value distinguishing locked from success AND from cancelled (so the keydown handler can branch)', async () => {
    // Direct seam: pin that the impl extended the return shape.
    // After iter-2, the shape was 'success' | undefined (locked &
    // cancelled both undefined). Iter-3 fix #2 needs locked to be
    // distinguishable so the keydown handler can detect the locked
    // terminal and remove the listener.
    //
    // We don't pin a specific string — builder picks 'locked' or
    // any other discriminant — only that the locked return value
    // is DISTINCT from both success and cancelled (so the handler
    // can branch).
    const { mountViewer } = await import('../viewer');
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (h: HTMLElement, opts?: { isRestore?: boolean }) => Promise<unknown>;
    };

    // Path 1: success
    mockSessionAndPerms(env.fetchSpy);
    const host = document.getElementById('editor')!;
    await mountViewer(host, '# Spec\n');
    const successResult = await attemptEditAction(host);

    // Reset for path 2: locked
    env.cleanup();
    env = setupWebBootstrapEnv();
    mockSessionAndPerms(env.fetchSpy, { permsPush: false });
    const host2 = document.getElementById('editor')!;
    await (await import('../viewer')).mountViewer(host2, '# Spec\n');
    const lockedResult = await (await import('../edit-mode')).attemptEditAction(host2);

    // Reset for path 3: cancelled (restore-path 401)
    env.cleanup();
    env = setupWebBootstrapEnv();
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });
    const host3 = document.getElementById('editor')!;
    await (await import('../viewer')).mountViewer(host3, '# Spec\n');
    const cancelledResult = await (await import('../edit-mode')).attemptEditAction(host3, {
      isRestore: true,
    } as never);

    expect(
      lockedResult === successResult,
      `expected locked to differ from success (Iter-2 fix #2 contract). Got success=${JSON.stringify(successResult)}, locked=${JSON.stringify(lockedResult)}.`,
    ).toBe(false);
    expect(
      lockedResult === cancelledResult,
      `expected locked to differ from cancelled (Iter-3 fix #2 — the keydown handler needs to distinguish "user is told they can't edit; stop firing" from "user cancelled auth; let them retry by typing"). Got locked=${JSON.stringify(lockedResult)}, cancelled=${JSON.stringify(cancelledResult)}.`,
    ).toBe(false);
  });
});
