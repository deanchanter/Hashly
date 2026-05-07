import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #158 / AC 4.8, 4.9 — Viewer error/loading on banner primitive.
//
// AC 4.8: viewer fail branch (in `src/main.ts#bootstrapWeb`) renders a
//         banner with:
//           - the existing per-kind error message
//           - a "retry" affordance that re-runs the fetch
//           - a "back to landing" affordance that returns to the
//             landing surface
//           - document.title updated to reflect the failure (#108)
//
// AC 4.9: a loading indicator is visible in the DOM during the fetch
//         (between fetch dispatch and resolution).
//
// We pin OUTCOMES — content + role + click effect + document.title —
// not specific testids, so the builder can use the banner primitive
// or any equivalent surface.

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

const SETTLE_MS = 150;
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, SETTLE_MS));
}

describe('Issue #158 / AC 4.9 — viewer loading indicator during fetch', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let resolveFetch: ((response: Response) => void) | null;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<header id="viewer-header"></header><div id="editor"></div>';
    document.title = 'Hashly';
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=specs/spec.md&ref=main');

    originalFetch = globalThis.fetch;
    resolveFetch = null;
    fetchSpy = vi.fn(() => {
      // Hold the spec fetch open so the test can inspect mid-flight.
      return new Promise<Response>((resolve) => {
        if (!resolveFetch) {
          resolveFetch = resolve;
        } else {
          resolve(new Response('{}', { status: 200 }));
        }
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    applyTauriMocks(FRESH_TAURI_MOCKS());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/core');
  });

  it('shows a visible loading indicator while the spec fetch is in flight', async () => {
    // The central AC 4.9 pin. Today the bootstrap fires fetch and
    // shows nothing in the editor host until either mountViewer
    // resolves or renderViewerError fires. On a slow connection
    // that's a confusingly blank surface.
    const { bootstrap } = await import('../main');
    bootstrap();
    // Yield long enough for the synchronous pre-fetch render
    // (loading indicator) to land in the DOM, but NOT long
    // enough for the fetch to resolve (it never will).
    await new Promise((r) => setTimeout(r, 30));

    const text = (document.body.textContent ?? '').toLowerCase();
    expect(
      text.includes('loading') || text.includes('fetching') || text.includes('one moment'),
      `expected a loading indicator visible in the DOM during the fetch (AC 4.9). Body text: ${JSON.stringify(text.slice(0, 200))}.`,
    ).toBe(true);
  });

  it('the loading indicator carries role="status" so screen readers announce it', async () => {
    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 30));

    const candidates = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="status"]'),
    );
    const announced = candidates.some((el) => {
      const t = (el.textContent ?? '').toLowerCase();
      return t.includes('loading') || t.includes('fetching') || t.includes('one moment');
    });
    expect(
      announced,
      'expected the loading indicator to carry role="status" for SR announcement (AC 4.9 a11y)',
    ).toBe(true);
  });

  it('the loading indicator is removed once the fetch resolves successfully', async () => {
    // Belt: we don't want a stale "Loading…" sitting next to the
    // mounted viewer body.
    const { bootstrap } = await import('../main');
    bootstrap();
    await new Promise((r) => setTimeout(r, 30));

    expect(resolveFetch, 'precondition: fetch in flight').not.toBeNull();
    resolveFetch!(
      new Response('# spec\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    await settle();

    const text = (document.body.textContent ?? '').toLowerCase();
    expect(
      text.includes('loading') || text.includes('fetching'),
      `expected the loading indicator to be REMOVED after the fetch resolves successfully (AC 4.9). Body text: ${JSON.stringify(text.slice(0, 200))}.`,
    ).toBe(false);
  });
});

describe('Issue #158 / AC 4.8 — viewer error banner: retry + back-to-landing + document.title', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<header id="viewer-header"></header><div id="editor"></div>';
    document.title = 'Hashly';
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=specs/spec.md&ref=main');

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
  });

  function findButtonByText(root: ParentNode, fragment: string): HTMLElement | null {
    const buttons = Array.from(
      root.querySelectorAll<HTMLElement>('button, a'),
    );
    return (
      buttons.find((b) =>
        (b.textContent ?? '').toLowerCase().includes(fragment.toLowerCase()),
      ) ?? null
    );
  }

  it('on a 404 fetch, the viewer error surface includes a retry affordance', async () => {
    fetchSpy.mockResolvedValue(new Response('not found', { status: 404 }));
    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    const editor = document.getElementById('editor')!;
    const retry = findButtonByText(editor, 'retry') ?? findButtonByText(editor, 'try again');
    expect(
      retry,
      `expected a "retry" / "try again" affordance on the viewer error surface (AC 4.8). HTML: ${editor.innerHTML.slice(0, 300)}`,
    ).not.toBeNull();
  });

  it('on a 404 fetch, the viewer error surface includes a back-to-landing affordance', async () => {
    fetchSpy.mockResolvedValue(new Response('not found', { status: 404 }));
    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    const editor = document.getElementById('editor')!;
    const back =
      findButtonByText(editor, 'landing') ??
      findButtonByText(editor, 'home') ??
      findButtonByText(editor, 'start over');
    expect(
      back,
      `expected a "back to landing" / "home" / "start over" affordance on viewer error (AC 4.8). HTML: ${editor.innerHTML.slice(0, 300)}`,
    ).not.toBeNull();
  });

  it('on a fetch failure, document.title is updated to reflect the failure (#108)', async () => {
    // #108: the tab title should signal the failure so a user
    // with multiple tabs can locate the broken one without
    // clicking. Today the title is the static fallback or
    // unchanged from "Hashly".
    fetchSpy.mockResolvedValue(new Response('not found', { status: 404 }));
    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    const t = document.title.toLowerCase();
    expect(
      t.includes('error') || t.includes("couldn't") || t.includes('not found') || t.includes('failed'),
      `expected document.title to indicate failure on viewer error (#108). Got: ${JSON.stringify(document.title)}.`,
    ).toBe(true);
  });

  it('clicking retry re-runs the fetch (and on success, mounts the viewer)', async () => {
    // The behavioral half of the retry affordance. Without this,
    // a "Retry" button that does nothing is a UX lie. We simulate
    // a transient failure: first call returns 404, second call
    // returns 200.
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(new Response('nope', { status: 404 }));
      }
      return Promise.resolve(
        new Response('# spec\n\nbody\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
      );
    });

    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();
    expect(callCount, 'precondition: first fetch happened').toBe(1);

    const editor = document.getElementById('editor')!;
    const retry = findButtonByText(editor, 'retry') ?? findButtonByText(editor, 'try again');
    expect(retry, 'precondition: retry must exist').not.toBeNull();
    retry!.click();
    await settle();

    expect(
      callCount,
      `expected clicking retry to re-run the fetch. Got callCount=${callCount}.`,
    ).toBeGreaterThanOrEqual(2);
  });

  it('clicking back-to-landing renders the landing surface', async () => {
    // The behavioral half of the back affordance. After click,
    // the editor host shows landing-shaped content (parseSpecUrl
    // error path).
    fetchSpy.mockResolvedValue(new Response('nope', { status: 404 }));
    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    const editor = document.getElementById('editor')!;
    const back =
      findButtonByText(editor, 'landing') ??
      findButtonByText(editor, 'home') ??
      findButtonByText(editor, 'start over');
    expect(back, 'precondition: back affordance must exist').not.toBeNull();
    back!.click();
    await new Promise((r) => setTimeout(r, 30));

    // Landing surface contains a paste-spec affordance — pin a
    // loose anchor: an <input> or text mentioning "spec" /
    // "paste" / "url" or `data-testid="landing"`.
    const editorAfter = document.getElementById('editor')!;
    const landing = editorAfter.querySelector('[data-testid="landing"]');
    const text = (editorAfter.textContent ?? '').toLowerCase();
    const hasLandingShape =
      landing !== null ||
      text.includes('paste') ||
      text.includes('spec url') ||
      text.includes('github');
    expect(
      hasLandingShape,
      `expected the landing surface to render after back click (AC 4.8). Editor HTML: ${editorAfter.innerHTML.slice(0, 300)}`,
    ).toBe(true);
  });

  it('on a network failure (fetch threw), the viewer error surface still includes retry + back affordances', async () => {
    // Belt: error semantics span all FetchSpecResult kinds. A
    // network failure must surface the same recovery affordances
    // as a 404, not a degenerate "no buttons" surface.
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    const { bootstrap } = await import('../main');
    bootstrap();
    await settle();

    const editor = document.getElementById('editor')!;
    const retry = findButtonByText(editor, 'retry') ?? findButtonByText(editor, 'try again');
    const back =
      findButtonByText(editor, 'landing') ??
      findButtonByText(editor, 'home') ??
      findButtonByText(editor, 'start over');
    expect(retry, 'retry on network failure (AC 4.8)').not.toBeNull();
    expect(back, 'back on network failure (AC 4.8)').not.toBeNull();
  });
});
