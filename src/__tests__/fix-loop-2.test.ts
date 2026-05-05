import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Issue #91 fix-loop iteration 2 — 3 critical findings from review
// round 2.
//
// Iter-1 closed the integration gaps (wiring + CSS + back-button)
// but introduced two new failures of its own (beforeinput trigger
// broken in real browsers + listener leaks across the edit-mode
// flip) and missed two layout / state-machine bugs (banner
// contradictions, toolbar overlap). This file pins the iter-2 fixes.
//
// Strict red-green: every assertion must fail because the
// production code doesn't yet implement the fix, not because the
// test setup is wrong. Builder verified the iter-1 commits with
// `--no-file-parallelism`; we follow the same convention here.

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
  assignSpy: ReturnType<typeof vi.fn>;
  hrefSpy: ReturnType<typeof vi.fn>;
  redirectCalls: () => string[];
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
    return Promise.resolve(new Response(spec, { status: 200 }));
  });
}

// ============================================================================
// Iter-2 fix #1 — keydown listener self-removes after enterEditMode
// ============================================================================
//
// Reviewer finding (round 2): even after switching from beforeinput
// to keydown (which actually fires on contenteditable=false), the
// listener leaks across the edit-mode flip.
//
// Sequence today (post round-1):
//   1. mountViewer → host has read-only .ProseMirror inside it.
//   2. host.addEventListener('keydown', handler) — listener attached.
//   3. User types 'a' → handler fires → preventDefault →
//      attemptEditAction(host) → session-status 200 + perms push:true →
//      enterEditMode → host.replaceChildren() destroys the read-only
//      .ProseMirror and mounts an editable one.
//   4. User types 'b' → keydown event bubbles to host → handler is
//      STILL attached → preventDefault blocks ProseMirror's edit →
//      no character lands. AND attemptEditAction fires another fetch
//      pair (session-status + perms). Per keystroke. 10 chars typed
//      = 20 worker hits.
//
// Fix shape: the keydown listener self-removes after attemptEditAction
// successfully reaches enterEditMode. Builder picks the mechanism
// (boolean flag, removeEventListener call, AbortController.signal,
// etc.). Test pins the OUTCOME: post-flip keydown does NOT trigger
// another fetch AND does NOT preventDefault.

describe('Issue #91 fix-loop-2 / fix #1 — keydown listener self-removes after enterEditMode succeeds', () => {
  let env: ReturnType<typeof setupWebBootstrapEnv>;

  beforeEach(() => {
    env = setupWebBootstrapEnv();
  });

  afterEach(() => env.cleanup());

  it('after enterEditMode succeeds, dispatching another keydown does NOT fire a second session-status fetch', async () => {
    // The "20 fetches per 10 keystrokes" bug. After the first
    // keydown triggers attemptEditAction → enterEditMode, the
    // listener must NOT remain attached to fire on subsequent
    // keystrokes.
    mockSessionAndPerms(env.fetchSpy, {
      sessionUser: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
    });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 300));

    const editorHost = document.getElementById('editor')!;

    // First keydown: triggers attemptEditAction → enterEditMode.
    editorHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 200));

    // Verify enterEditMode actually fired (precondition; if it
    // didn't, the rest of this test is meaningless).
    const pmAfterFirst = document.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pmAfterFirst?.getAttribute('contenteditable'),
      'precondition: first keydown must have flipped the editor into edit mode (otherwise the listener-removal regression isn\'t exercised).',
    ).toBe('true');

    const fetchesAfterFlip = env.fetchSpy.mock.calls.length;

    // Second keydown: should NOT trigger another fetch.
    editorHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));

    const newFetches = env.fetchSpy.mock.calls.slice(fetchesAfterFlip);
    const sessionFetches = newFetches.filter(([u]) => String(u) === '/api/session-status');
    const permsFetches = newFetches.filter(([u]) => String(u).startsWith('/api/github/repos/'));
    expect(
      sessionFetches.length,
      `expected NO new /api/session-status fetch after the editor flips into edit mode (iter-2 fix #1 — the keydown listener must self-remove after enterEditMode succeeds; otherwise every subsequent keystroke fires a redundant session check + perms check; 10 chars typed → 20 worker hits). Got ${sessionFetches.length} new session-status fetches.`,
    ).toBe(0);
    expect(
      permsFetches.length,
      `expected NO new perms fetch either (same reasoning).`,
    ).toBe(0);
  });

  it('after enterEditMode succeeds, a subsequent keydown is NOT preventDefault\'d (ProseMirror gets to handle the input)', async () => {
    // The data-loss half of the same bug. If the listener still
    // calls preventDefault after the flip, the user types but
    // ProseMirror doesn't see the keystroke. The doc never
    // updates.
    mockSessionAndPerms(env.fetchSpy);

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 300));

    const editorHost = document.getElementById('editor')!;

    // First keydown: trigger flip.
    editorHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 200));

    expect(
      document.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: first keydown must flip into edit mode',
    ).toBe('true');

    // Second keydown: must NOT be preventDefault'd.
    const ev = new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true });
    const dispatched = editorHost.dispatchEvent(ev);
    expect(
      dispatched,
      `expected keydown.dispatchEvent to return TRUE after the flip (i.e., preventDefault was NOT called) so ProseMirror's input handling proceeds in edit mode. If preventDefault is called the user's keystrokes never reach the editor and the doc doesn't update — silent data loss. Iter-2 fix #1.`,
    ).toBe(true);
  });

  it('first-time keydown DOES preventDefault (iter-1 fix #2 contract preserved before flip)', async () => {
    // Non-regression: the listener-removal happens AFTER
    // enterEditMode, not before. The pre-flip preventDefault is
    // still required (defensive belt-and-suspenders against the
    // v0.2 #33 write-handle-bypass class of bug).
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 250));

    const editorHost = document.getElementById('editor')!;
    const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    const dispatched = editorHost.dispatchEvent(ev);
    expect(
      dispatched,
      `expected keydown.dispatchEvent to return FALSE on the first-time read-only-state keydown (preventDefault is the iter-1 fix #2 contract; preserved here because the editor is STILL read-only at this point — flip hasn't happened yet, AC 5.2 redirect is firing). Iter-2 fix #1 only removes the listener AFTER enterEditMode succeeds.`,
    ).toBe(false);
  });
});

// ============================================================================
// Iter-2 fix #2 — banner contradictions on restore failure paths
// ============================================================================
//
// Reviewer finding: `renderPostAuthPrompt(host)` is called
// UNCONDITIONALLY after `attemptEditAction(host, {isRestore: true})`.
// attemptEditAction has three terminal states:
//   - 200 + push:true → enterEditMode (success)
//   - 200 + push:false → renderViewOnlyLock (locked)
//   - 401 → renderAuthCancelledBanner (cancelled)
//
// In the locked + cancelled paths, the user sees "You're signed in.
// Please redo your edit" stacked above the lock/cancel banner.
// Direct contradiction.
//
// Fix shape: attemptEditAction returns its terminal state. Bootstrap's
// restore branch only renders the post-auth prompt when state is
// `'success'`. Builder picks the exact return type ('success' |
// 'locked' | 'cancelled' | 'error', or boolean, or symbol — test
// pins the OBSERVABLE banner state).

describe('Issue #91 fix-loop-2 / fix #2 — banner contradictions on restore failure paths', () => {
  let env: ReturnType<typeof setupWebBootstrapEnv>;

  beforeEach(() => {
    env = setupWebBootstrapEnv();
    sessionStorage.setItem(PENDING_EDIT_KEY, '1');
  });

  afterEach(() => env.cleanup());

  it('restore + 200 + push:true → only post-auth-prompt is rendered (success path; existing iter-1 contract)', async () => {
    // Non-regression: the success path STILL renders the post-auth
    // prompt because the user genuinely just signed in and we want
    // to tell them "please redo your edit". This pin keeps the
    // iter-1 fix #5 success path intact.
    mockSessionAndPerms(env.fetchSpy);

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 300));

    expect(
      document.querySelector('[data-testid="post-auth-prompt"]'),
      'expected the post-auth-prompt to render on the SUCCESS restore path (iter-1 fix #5 contract — user signed in successfully; remind them to redo their edit).',
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="auth-cancelled"]'),
      'expected NO auth-cancelled banner on the success path.',
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="view-only-lock"]'),
      'expected NO view-only-lock on the success path.',
    ).toBeNull();
  });

  it('restore + 200 + push:false → only view-only-lock is rendered (NO post-auth-prompt — they were not granted edit access)', async () => {
    // The contradiction case: user comes back from auth, has a
    // session, but is read-only on this repo. Showing "please redo
    // your edit" is a lie because they CAN'T edit. The view-only
    // lock is the correct surface; the post-auth prompt must not
    // stack above it.
    mockSessionAndPerms(env.fetchSpy, { permsPush: false });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 300));

    expect(
      document.querySelector('[data-testid="view-only-lock"]'),
      'precondition: the view-only-lock must render on the read-only-repo restore path.',
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="post-auth-prompt"]'),
      `expected NO post-auth-prompt when the restore lands in the view-only-lock path (Iter-2 fix #2 — "please redo your edit" contradicts "you don't have write access"; the lock is the only correct surface).`,
    ).toBeNull();
  });

  it('restore + 401 → only auth-cancelled banner is rendered (NO post-auth-prompt — they did not actually sign in)', async () => {
    // The back-button-cancel case: user hit back from GitHub
    // without auth'ing, so the session-status returns 401. The
    // auth-cancelled banner is correct; "you're signed in" is
    // a flat-out lie.
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });

    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 300));

    expect(
      document.querySelector('[data-testid="auth-cancelled"]'),
      'precondition: the auth-cancelled banner must render on the 401 restore path (iter-1 fix #5).',
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="post-auth-prompt"]'),
      `expected NO post-auth-prompt when the restore lands in the auth-cancelled path (Iter-2 fix #2 — "you're signed in" contradicts "auth was cancelled"; the cancel banner is the only correct surface).`,
    ).toBeNull();
  });

  it('attemptEditAction returns a terminal-state value the bootstrap can branch on (success vs locked vs cancelled)', async () => {
    // Pin the seam: attemptEditAction's return type encodes the
    // terminal state. Builder picks string ('success' / 'locked' /
    // 'cancelled' / 'error') OR enum OR boolean union — the test
    // accepts ANY non-undefined return value distinguishing the
    // success path from the others.
    //
    // We exercise three paths and assert each returns a DIFFERENT
    // (or differently-shaped) value. The observable contract: the
    // success-path return value is distinguishable from the
    // failure-path return values by some property — exact shape is
    // builder discretion.
    mockSessionAndPerms(env.fetchSpy);
    const { attemptEditAction } = (await import('../edit-mode')) as unknown as {
      attemptEditAction: (host: HTMLElement, opts?: { isRestore?: boolean }) => Promise<unknown>;
    };
    const host = document.getElementById('editor')!;

    // Need a viewer mounted for enterEditMode to have something to
    // flip. Mount one explicitly (bootstrap chain is exercised in
    // the other 3 tests).
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n');

    // Path 1: success
    const successResult = await attemptEditAction(host, { isRestore: true });

    // Reset for path 2: locked
    env.cleanup();
    env = setupWebBootstrapEnv();
    mockSessionAndPerms(env.fetchSpy, { permsPush: false });
    const host2 = document.getElementById('editor')!;
    await (await import('../viewer')).mountViewer(host2, '# Spec\n');
    const lockedResult = await (await import('../edit-mode')).attemptEditAction(host2, {
      isRestore: true,
    } as never);

    // Reset for path 3: cancelled
    env.cleanup();
    env = setupWebBootstrapEnv();
    mockSessionAndPerms(env.fetchSpy, { sessionStatus: 401 });
    const host3 = document.getElementById('editor')!;
    await (await import('../viewer')).mountViewer(host3, '# Spec\n');
    const cancelledResult = await (await import('../edit-mode')).attemptEditAction(host3, {
      isRestore: true,
    } as never);

    // Pin: the three results MUST be distinguishable. The simplest
    // shape: distinct truthy vs falsy / string vs string. We assert
    // success !== locked AND success !== cancelled.
    expect(
      successResult === lockedResult,
      `expected attemptEditAction to return DIFFERENT values for success vs locked paths (iter-2 fix #2 — bootstrap needs to branch on the terminal state to gate the post-auth prompt). Got success: ${JSON.stringify(successResult)}, locked: ${JSON.stringify(lockedResult)}.`,
    ).toBe(false);
    expect(
      successResult === cancelledResult,
      `expected attemptEditAction to return DIFFERENT values for success vs cancelled paths. Got success: ${JSON.stringify(successResult)}, cancelled: ${JSON.stringify(cancelledResult)}.`,
    ).toBe(false);
  });
});

// ============================================================================
// Iter-2 fix #3 — edit-toolbar does not overlap viewer-header
// ============================================================================
//
// Reviewer finding: `.edit-toolbar` is `position: fixed; top:
// 0.75rem; left: 50%; transform: translateX(-50%);`. The header is
// in normal flow at top, height ~36px. The toolbar at top:0.75rem
// (12px) starts within the header and overlaps the
// `.viewer-header__coords` element — the user loses sight of WHICH
// spec they're editing the moment they enter edit mode.
//
// Fix shape: anchor the toolbar below the header. The test pins
// the form factor (toolbar's `top` is below the header's bottom)
// rather than a specific value — builder picks the exact CSS
// (var, calc, sticky positioning, dedicated parent) so long as
// the layout doesn't overlap.
//
// Static contract test: read style.css, find the .edit-toolbar
// rule, verify its `top` value is NOT `0.75rem` (or any small
// fixed value < ~40px) when paired with `position: fixed`. We
// accept any of:
//   - top: calc(<something with header height>)
//   - top: var(...) where the var resolves > 40px
//   - position: sticky (no fixed top required)
//   - The toolbar is parented inside the header (no fixed top required)
//
// Pinning the negative ("top is not 0.75rem when fixed") is the
// least-prescriptive contract that catches the exact bug while
// leaving builder freedom.

describe('Issue #91 fix-loop-2 / fix #3 — edit-toolbar does not overlap viewer-header', () => {
  const STYLE_CSS_PATH = resolve(__dirname, '..', 'style.css');
  const readStyleCss = (): string => readFileSync(STYLE_CSS_PATH, 'utf-8');
  const stripCssComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const findRuleBody = (css: string, selector: string): string | null => {
    const norm = css.replace(/\s+/g, '');
    const target = `${selector}{`;
    const idx = norm.indexOf(target);
    if (idx < 0) return null;
    const end = norm.indexOf('}', idx);
    if (end < 0) return null;
    return norm.slice(idx + target.length, end);
  };

  it('.edit-toolbar rule does NOT pair `position: fixed` with a small absolute `top` value (< 40px)', () => {
    // The exact bug pinned: `position: fixed; top: 0.75rem` (= 12px)
    // overlaps the ~36px header. We reject any small fixed top
    // value paired with position:fixed. Acceptable patterns:
    //   - position: sticky (no overlap because sticky respects flow)
    //   - position: fixed + top: calc(...header height...) >> small
    //   - position: fixed + top using a CSS variable
    //   - .edit-toolbar parented inside .viewer-header (no top
    //     needed)
    const css = stripCssComments(readStyleCss());
    const body = findRuleBody(css, '.edit-toolbar');
    expect(body, 'precondition: .edit-toolbar rule must exist (iter-1 fix #3)').not.toBeNull();

    const isFixed = /position:fixed(?:;|$)/.test(body!);

    if (isFixed) {
      // Extract the top value, if any.
      const topMatch = /top:([^;]+)/.exec(body!);
      const topVal = (topMatch?.[1] ?? '').trim();

      // Reject small absolute pixel/rem values that would overlap a
      // ~36px header. A header height of 36-56px is typical, so
      // reject anything that's a literal value parsing to less than
      // ~40px.
      const isSmallAbsolute =
        /^(\d+(?:\.\d+)?)(px|rem)$/.test(topVal) &&
        (() => {
          const m = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(topVal)!;
          const n = parseFloat(m[1]!);
          const unit = m[2]!;
          // 1rem ≈ 16px; convert to px-equivalent.
          const px = unit === 'rem' ? n * 16 : n;
          return px < 40;
        })();

      expect(
        isSmallAbsolute,
        `expected .edit-toolbar's \`top\` value to NOT be a small absolute (< 40px) when paired with position:fixed (iter-2 fix #3 — the header is ~36px tall; top:0.75rem (12px) overlaps it). Acceptable patterns: position:sticky, position:fixed + top:calc(...header height...), top:var(--*), or parenting the toolbar INSIDE .viewer-header. Got: position:fixed; top:${topVal}. Full body: ${body}`,
      ).toBe(false);
    }
  });

  it('alternative — toolbar uses position:sticky OR is parented inside the viewer header (acceptable)', () => {
    // Companion documentation pin: confirm the chosen alternative
    // pattern is valid. We don't enforce ONE specific pattern;
    // we just check that ONE of the three valid patterns is in
    // play. Combined with the previous test's negative pin, this
    // gives builder freedom while ensuring the bug is fixed.
    const css = stripCssComments(readStyleCss());
    const body = findRuleBody(css, '.edit-toolbar');
    expect(body, 'precondition: .edit-toolbar rule must exist').not.toBeNull();

    const positionMatch = /position:(\w+)/.exec(body!);
    const position = positionMatch?.[1] ?? 'static';
    const topMatch = /top:([^;]+)/.exec(body!);
    const topVal = (topMatch?.[1] ?? '').trim();

    // Valid patterns:
    // (A) position:sticky — respects flow, won't overlap.
    // (B) position:fixed + top is a calc() / var() / large value.
    // (C) position:absolute or relative — relies on parenting.
    // (D) any other shape that doesn't pair fixed with small top
    //     (covered by the previous test).

    const usesCalcOrVar = /top:(?:calc|var)/.test(body!);
    const isSticky = position === 'sticky';
    const isLargeFixed =
      position === 'fixed' &&
      /^(\d+(?:\.\d+)?)(px|rem)$/.test(topVal) &&
      (() => {
        const m = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(topVal)!;
        const n = parseFloat(m[1]!);
        const unit = m[2]!;
        const px = unit === 'rem' ? n * 16 : n;
        return px >= 40;
      })();
    const isNonFixed = position !== 'fixed';

    expect(
      isSticky || usesCalcOrVar || isLargeFixed || isNonFixed,
      `expected .edit-toolbar to use one of the valid layout patterns (sticky / fixed+calc / fixed+var / fixed+top>=40px / non-fixed). Got position:${position}, top:${topVal}. Full body: ${body}`,
    ).toBe(true);
  });

  it('integration — when the bootstrap mounts the toolbar after enterEditMode, getBoundingClientRect places it below the header', async () => {
    // Live-DOM pin (jsdom layout is approximate but enough for a
    // sanity check). After flipping into edit mode:
    //   - .viewer-header has a non-zero height
    //   - .edit-toolbar's top edge is >= .viewer-header's bottom
    //
    // jsdom returns 0 for layout dimensions when no styles apply;
    // we therefore SKIP this check if the header / toolbar reports
    // a zero rect (jsdom can't simulate full CSS layout). The
    // static-CSS test above is the load-bearing pin; this is a
    // belt-and-suspenders integration check that runs only when
    // jsdom layout produces non-zero rects.
    const env = setupWebBootstrapEnv();
    try {
      mockSessionAndPerms(env.fetchSpy);

      const { bootstrap } = await import('../main');
      bootstrap();
      await new Promise((r) => setTimeout(r, 300));

      // Trigger flip via keydown (iter-2 fix #1's mechanism).
      const editorHost = document.getElementById('editor')!;
      editorHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 200));

      const header = document.querySelector<HTMLElement>('.viewer-header');
      const toolbar = document.querySelector<HTMLElement>('[data-testid="edit-toolbar"]');
      expect(header, 'precondition: header must be in DOM').not.toBeNull();
      expect(toolbar, 'precondition: toolbar must be in DOM after flip').not.toBeNull();

      const headerRect = header!.getBoundingClientRect();
      const toolbarRect = toolbar!.getBoundingClientRect();

      // Skip the layout-dependent assertion in jsdom's degenerate
      // case where neither element reports a non-zero rect (jsdom
      // doesn't run a full layout engine; it just returns zeros).
      const layoutAvailable = headerRect.bottom > 0 && toolbarRect.top > 0;

      if (layoutAvailable) {
        expect(
          toolbarRect.top,
          `expected the toolbar's top edge to be >= the header's bottom edge so they don't overlap (iter-2 fix #3 layout integration). Header bottom: ${headerRect.bottom}, toolbar top: ${toolbarRect.top}.`,
        ).toBeGreaterThanOrEqual(headerRect.bottom);
      }
      // If layout is unavailable (jsdom default), the static CSS
      // test in the previous it-block carries the load.
    } finally {
      env.cleanup();
    }
  });
});
