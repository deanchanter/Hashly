import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #90 / Critical fix #3 — Wire the web bootstrap so the viewer
// actually runs on page load.
//
// Before this fix, `bootstrap()` mounted the v0.2 `showcase` fixture
// regardless of URL. None of the AC-4.1–4.7 modules
// (`parseSpecUrl` / `fetchSpec` / `mountViewer` / `renderLanding` /
// `renderViewerHeader` / `renderViewerError`) was reachable from
// production code. The viewer surface existed only as 248 unit tests.
//
// The fix: branch on environment.
//   - Tauri context (`window.__TAURI_INTERNALS__` defined): keep the
//     existing v0.2 `mountEditor(showcase)` path unchanged.
//   - Web context (no Tauri global): parseSpecUrl(window.location.href).
//       - error  → renderLanding(host, error)
//       - ok     → renderViewerHeader(headerHost, info), then
//                   await fetchSpec(...) →
//                     ok          → mountViewer(host, content); set document.title
//                     not-found / forbidden / network / other → renderViewerError(host, failure)
//
// The tests pin OUTCOMES (DOM state, fetch called once with the right
// URL, document.title set) rather than the precise call sequence,
// so the builder is free to choose how to factor the orchestration.
//
// Mocking strategy:
//   - `vi.resetModules()` per test so the module-level closure state
//     in `src/main.ts` (`closeGuardInstalled`, etc.) doesn't leak.
//   - `vi.doMock('@tauri-apps/...')` so the top-level imports in
//     `src/main.ts` resolve to no-ops in jsdom.
//   - `globalThis.fetch` stubbed per test for the AC 4.3 `fetchSpec`
//     call.
//   - `window.history.replaceState` to control `window.location.href`
//     (jsdom honors history mutation as a location change).
//   - `(window as any).__TAURI_INTERNALS__` set/deleted to flip the
//     env branch. Cast through `any` because the global is jsdom-
//     untyped and the precise shape is irrelevant to the bootstrap
//     test.

const FRESH_TAURI_MOCKS = () => ({
  '@tauri-apps/api/event': { listen: vi.fn(async () => () => {}) },
  '@tauri-apps/plugin-dialog': { open: vi.fn(async () => null), save: vi.fn(async () => null) },
  '@tauri-apps/api/core': { invoke: vi.fn(async () => '') },
});

function applyTauriMocks(mocks: ReturnType<typeof FRESH_TAURI_MOCKS>): void {
  vi.doMock('@tauri-apps/api/event', () => mocks['@tauri-apps/api/event']);
  vi.doMock('@tauri-apps/plugin-dialog', () => mocks['@tauri-apps/plugin-dialog']);
  vi.doMock('@tauri-apps/api/core', () => mocks['@tauri-apps/api/core']);
}

// Wait long enough for the bootstrap's async chains (parseSpecUrl is
// sync; fetchSpec → mountViewer is two awaits + a Milkdown create()
// pass) to settle. 100ms matches the existing `bootstrap.test.ts`
// pattern; Milkdown's plugin loader resolves within ~50ms in jsdom.
const SETTLE_MS = 150;

function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, SETTLE_MS));
}

describe('Issue #90 / Critical fix #3 — bootstrap web-mode wiring', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML =
      '<header id="viewer-header"></header><div id="editor"></div>';
    document.title = 'Hashly';
    // Default: web mode (no Tauri global).
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    // Reset URL to root.
    window.history.replaceState({}, '', '/');

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    applyTauriMocks(FRESH_TAURI_MOCKS());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/core');
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('Tauri regression: when `__TAURI_INTERNALS__` is defined, the v0.2 `mountEditor(showcase)` path runs and the web fetch is NOT called', async () => {
    // The existing v0.2 codepath must keep working unchanged. If
    // someone swaps the env-detection check, this catches it.
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    // Even with a query string, Tauri mode ignores it and mounts
    // the showcase. Pin that explicitly.
    window.history.replaceState({}, '', '/?repo=should/be-ignored&path=README.md');

    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    expect(
      fetchSpy,
      'expected NO fetch call in Tauri mode (the desktop path serves local files via IPC, not the GitHub raw endpoint).',
    ).not.toHaveBeenCalled();

    const editorHost = document.getElementById('editor');
    expect(
      editorHost?.querySelector('.ProseMirror'),
      'expected a .ProseMirror node inside #editor in Tauri mode (mountEditor mounts the showcase fixture).',
    ).not.toBeNull();
  });

  it('Web cold landing: bare URL `/` → renderLanding is called (no [role="alert"], no fetch)', async () => {
    // No query params → parseSpecUrl errors → renderLanding(host)
    // with the error string. The current bootstrap unconditionally
    // mounts showcase; this test pins that web mode follows the
    // landing-page branch instead.
    window.history.replaceState({}, '', '/');

    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    expect(
      fetchSpy,
      'expected NO fetch call when the URL has no params (the parser short-circuits before the fetch).',
    ).not.toHaveBeenCalled();

    expect(
      document.querySelector('.viewer-landing'),
      'expected a .viewer-landing element rendered into the host (Issue #90 fix #3 — web mode without params shows the landing page, not the showcase).',
    ).not.toBeNull();

    expect(
      document.querySelector('.ProseMirror'),
      'expected NO .ProseMirror in cold-landing web mode (the showcase must NOT mount; the landing page is the surface).',
    ).toBeNull();
  });

  it('Web invalid params: `?repo=foo/bar` (no path) → renderLanding with [role="alert"] containing the error', async () => {
    // Invalid params → parseSpecUrl error mentioning `path` →
    // renderLanding(host, error). The alert MUST surface so the
    // user can see why the landing rendered.
    window.history.replaceState({}, '', '/?repo=foo/bar');

    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();

    const landing = document.querySelector('.viewer-landing');
    expect(
      landing,
      'expected a .viewer-landing rendered when the URL params are invalid.',
    ).not.toBeNull();

    const alert = landing?.querySelector('[role="alert"]');
    expect(
      alert,
      'expected a [role="alert"] inside the landing when parseSpecUrl returns an error string (Issue #90 fix #3 — error path of bootstrap → renderLanding(host, error)).',
    ).not.toBeNull();
    expect((alert?.textContent ?? '').toLowerCase()).toContain('path');
  });

  it('Web success: valid params + 200 fetch → header rendered, viewer mounted with content, document.title set to `<path> — Hashly`', async () => {
    // The whole-pipe happy path. parseSpecUrl → fetchSpec → mountViewer.
    // AC 5.4 / fix-loop-1 #1 added a `mountSessionIndicator` call that
    // fires `/api/session-status` regardless of session state — so the
    // bootstrap now does AT LEAST 2 fetches on the success path. We
    // pin the spec fetch via URL filter (the load-bearing AC 4.3
    // contract) and stop coupling to total fetch count.
    window.history.replaceState({}, '', '/?repo=foo/bar&path=README.md&ref=main');
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      if (u === 'https://raw.githubusercontent.com/foo/bar/main/README.md') {
        return Promise.resolve(new Response('# Hello world\n\nbody', { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    // The AC 4.3 contract: fetchSpec called exactly once against the
    // right raw.githubusercontent.com URL. Filter rather than count
    // so AC 5.4's session-status fetch doesn't tip the assertion.
    const specFetches = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === 'https://raw.githubusercontent.com/foo/bar/main/README.md',
    );
    expect(
      specFetches.length,
      `expected exactly ONE fetch against the spec URL (AC 4.3 fetchSpec invocation). Got ${specFetches.length}. All fetches: ${JSON.stringify(fetchSpy.mock.calls.map(([u]) => String(u)))}.`,
    ).toBe(1);

    // Viewer header rendered with the parsed coordinates and a
    // github.com out-link.
    const header = document.querySelector('.viewer-header');
    expect(
      header,
      'expected a .viewer-header element after a successful fetch (Issue #90 fix #3 — header is rendered alongside the viewer mount).',
    ).not.toBeNull();
    expect(header?.textContent ?? '').toContain('foo/bar');
    expect(header?.textContent ?? '').toContain('README.md');
    expect(
      header?.querySelector<HTMLAnchorElement>('a[href]')?.getAttribute('href'),
      'expected the github.com out-link href to match the parsed coordinates.',
    ).toBe('https://github.com/foo/bar/blob/main/README.md');

    // Viewer mounted with the fetched content.
    const proseMirror = document.querySelector('.ProseMirror');
    expect(
      proseMirror,
      'expected a .ProseMirror node inside the viewer host (Issue #90 fix #3 — mountViewer was invoked with the fetched markdown).',
    ).not.toBeNull();
    expect(
      proseMirror?.querySelector('h1')?.textContent ?? '',
      'expected the rendered viewer to contain the fetched markdown\'s <h1>.',
    ).toContain('Hello world');

    // document.title set to the path.
    expect(
      document.title,
      `expected document.title to include the path so the user / browser-tab signal reflects which spec is rendered. Got: ${JSON.stringify(document.title)}`,
    ).toContain('README.md');
  });

  it('Web 404: valid params + fetch returns 404 → renderViewerError with not-found alert (no viewer mount)', async () => {
    // After the header renders, a 404 from raw.githubusercontent.com
    // means the spec doesn't exist (or the repo is private). The
    // viewer-error surface replaces the viewer mount.
    //
    // AC 5.4 / fix-loop-1 #1 also fires a session-status fetch from
    // mountSessionIndicator (after the header paints, before
    // fetchSpec resolves). Switch to URL-aware mocks so neither
    // fetch starves the other; pin the spec fetch via URL filter.
    window.history.replaceState({}, '', '/?repo=foo/bar&path=missing.md&ref=main');
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/session-status') {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      if (u === 'https://raw.githubusercontent.com/foo/bar/main/missing.md') {
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    const specFetches = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === 'https://raw.githubusercontent.com/foo/bar/main/missing.md',
    );
    expect(
      specFetches.length,
      `expected exactly ONE fetch against the spec URL (AC 4.3 fetchSpec invocation). Got ${specFetches.length}.`,
    ).toBe(1);

    const alert = document.querySelector('[role="alert"]');
    expect(
      alert,
      'expected a [role="alert"] from renderViewerError after a 404 (Issue #90 fix #3 + AC 4.7).',
    ).not.toBeNull();
    expect((alert?.textContent ?? '').toLowerCase()).toMatch(
      /(not found|private|couldn't find|cannot find|can't find)/,
    );

    // No viewer mounted in the failure path.
    expect(
      document.querySelector('.ProseMirror'),
      'expected NO .ProseMirror after a 404 — the viewer must not mount on failed fetch.',
    ).toBeNull();
  });

  it('Web network error: fetch rejects → renderViewerError with network alert', async () => {
    // The offline / DNS-failure path. fetchSpec catches and
    // returns `{ ok: false, kind: 'network' }`; the bootstrap
    // routes to renderViewerError.
    window.history.replaceState({}, '', '/?repo=foo/bar&path=README.md&ref=main');
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    const alert = document.querySelector('[role="alert"]');
    expect(
      alert,
      'expected a [role="alert"] from renderViewerError after a network failure.',
    ).not.toBeNull();
    expect((alert?.textContent ?? '').toLowerCase()).toMatch(
      /(network|connection|offline|reach|connect)/,
    );

    expect(
      document.querySelector('.ProseMirror'),
      'expected NO .ProseMirror after a network failure.',
    ).toBeNull();
  });
});
