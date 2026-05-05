import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #92 / AC 6.3 — Frontend save-success banner.
//
// "On save success, show a toast/banner with the PR URL and a 'view
// on GitHub' link. Position above the editor (mirror the lock/post-
// auth-prompt pattern)."
//
// Two surfaces to pin:
//
//   1. **Unit**: `renderSaveSuccess(host, prUrl)` exported from
//      `src/save-result.ts`. Creates a `[data-testid="save-success"]`
//      banner with a clickable link to `prUrl`. Idempotent (no
//      stacking). Above the editor body (mirrors AC 5.5 view-only-
//      lock and AC 5.3 post-auth-prompt).
//   2. **Integration**: click save → POST /api/save returns
//      `{ok: true, prUrl}` → save-success banner appears in the DOM
//      with `prUrl` round-tripped to the link's `href`. The click
//      handler from AC 6.1 is responsible for wiring this.
//
// Pinned testids:
//   - `save-success` (this slice)
//   - `save-error` (AC 6.7, already shipped)
//   - `save-conflict` (AC 6.5, ships next)
//
// Three distinct testids so each AC owns its surface and the
// banner-family discipline (only one save-* banner visible at a
// time — pinned by mutual-exclusion below) is enforced.
//
// Tests opt out of vitest.setup.ts's Tauri-default flag — save
// flow is web-mode only.

const SAVE_SUCCESS_TESTID = 'save-success';
const SAVE_ERROR_TESTID = 'save-error';
const SAVE_BTN_TESTID = 'edit-toolbar-save';

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

describe('Issue #92 / AC 6.3 — renderSaveSuccess form factor', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('exports `renderSaveSuccess` as a named function from src/save-result.ts', async () => {
    // RED until builder adds the export. Same floor pattern as
    // renderSaveError (AC 6.7) — keeps the save-banner family
    // co-located in `src/save-result.ts`.
    const mod = (await import('../save-result')) as unknown as {
      renderSaveSuccess?: unknown;
    };
    expect(
      typeof mod.renderSaveSuccess,
      'expected `renderSaveSuccess` to be exported as a function from src/save-result.ts (Issue #92 / AC 6.3 — the success-banner seam used by the AC 6.1 click handler).',
    ).toBe('function');
  });

  it('creates a [data-testid="save-success"] element prepended ABOVE the editor body', async () => {
    // The form-factor pin. Mirrors the renderSaveError /
    // renderViewOnlyLock / renderPostAuthPrompt patterns: a single
    // banner element prepended into the host so the message sits
    // above the editor (without prepend, the user has to scroll
    // past the editor to see "save succeeded").
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };

    // Pre-populate so the prepend-vs-append distinction is
    // observable.
    const editorBody = document.createElement('div');
    editorBody.className = 'ProseMirror';
    editorBody.textContent = 'editor body';
    host.appendChild(editorBody);

    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/42');

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"]`,
    );
    expect(
      banner,
      `expected a [data-testid="${SAVE_SUCCESS_TESTID}"] element after renderSaveSuccess (AC 6.3 — the dedicated success banner surface).`,
    ).not.toBeNull();
    expect(
      host.firstElementChild,
      'expected the save-success banner to be the FIRST child of the host so it sits ABOVE the editor body (AC 6.3 banner positioning — mirrors AC 6.7 renderSaveError).',
    ).toBe(banner);
  });

  it('the banner contains an <a> link whose href is the prUrl verbatim', async () => {
    // The central content pin. The AC says "show ... the PR URL
    // and a 'view on GitHub' link". The link's href MUST be the
    // exact prUrl from the worker's response — without this, an
    // impl that displays the URL as text but doesn't make it
    // clickable would defeat the AC.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    const prUrl = 'https://github.com/foo/bar/pull/42';
    renderSaveSuccess(host, prUrl);

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"]`,
    );
    expect(banner, 'precondition: banner must exist').not.toBeNull();

    const link = banner!.querySelector<HTMLAnchorElement>('a[href]');
    expect(
      link,
      `expected an <a href="..."> link inside the save-success banner (AC 6.3 — the link is the call-to-action that takes the user to their PR; without it the URL is just text).`,
    ).not.toBeNull();
    expect(
      link!.getAttribute('href'),
      `expected the link href to be the prUrl verbatim. Expected: ${JSON.stringify(prUrl)}. Got: ${JSON.stringify(link!.getAttribute('href'))}.`,
    ).toBe(prUrl);
  });

  it('the link textContent mentions "GitHub" (AC 6.3 — the literal "view on GitHub" copy)', async () => {
    // The AC quotes specific copy ("'view on GitHub' link"). We
    // accept paraphrasing — what matters is the user knows where
    // the link goes. Pin "GitHub" as the recognizable phrase so a
    // future copy edit can't ship "click here" or other vague
    // copy.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/42');

    const link = host.querySelector<HTMLAnchorElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"] a[href]`,
    );
    expect(link, 'precondition: link must exist').not.toBeNull();
    const text = (link!.textContent ?? '').toLowerCase();
    expect(
      text.includes('github'),
      `expected the link textContent to mention "GitHub" (AC 6.3 — the AC literal is "view on GitHub"; "GitHub" is the recognizable anchor phrase). Got: ${JSON.stringify(link!.textContent)}.`,
    ).toBe(true);
  });

  it('the link opens in a new tab — target="_blank" + rel="noopener noreferrer"', async () => {
    // a11y / security pin. target="_blank" preserves the user's
    // edit context (they can come back to Hashly without losing
    // state). rel="noopener noreferrer" prevents the opened tab
    // from accessing window.opener (target="_blank" without
    // noopener is a tabnabbing vector). Matches the
    // viewer-header__github-link pattern (Issue #90 AC 4.5).
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/42');

    const link = host.querySelector<HTMLAnchorElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"] a[href]`,
    );
    expect(link, 'precondition: link must exist').not.toBeNull();
    expect(
      link!.getAttribute('target'),
      'expected target="_blank" so the PR opens in a new tab and the user keeps their edit context (AC 6.3 — UX symmetry with viewer-header__github-link).',
    ).toBe('_blank');
    const rel = link!.getAttribute('rel') ?? '';
    expect(
      rel.includes('noopener'),
      `expected rel to include "noopener" so the opened PR can't access window.opener (target="_blank" without noopener is a tabnabbing vector). Got rel: ${JSON.stringify(rel)}.`,
    ).toBe(true);
  });

  it('idempotent — a second renderSaveSuccess call replaces the existing banner instead of stacking', async () => {
    // Same idempotency contract as renderSaveError (AC 6.7).
    // Without this pin, retries would stack banners and the user
    // would see stale prUrls hiding the live one.
    const { renderSaveSuccess } = (await import('../save-result')) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
    };
    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/1');
    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/2');

    const banners = host.querySelectorAll(
      `[data-testid="${SAVE_SUCCESS_TESTID}"]`,
    );
    expect(
      banners.length,
      `expected exactly ONE [data-testid="${SAVE_SUCCESS_TESTID}"] element after two calls (AC 6.3 idempotency — stacking would let stale PR URLs hide the live one).`,
    ).toBe(1);
  });

  it('renderSaveSuccess clears any existing save-error banner (mutual exclusion within the save-* family)', async () => {
    // The save-banner family is mutually exclusive: a successful
    // save must NOT leave a stale error banner from a prior failed
    // attempt. Without this, the user retries after a 'no-write'
    // error, succeeds, and sees BOTH the old "no-write" copy AND
    // the new success banner — contradictory state.
    const { renderSaveSuccess, renderSaveError } = (await import(
      '../save-result'
    )) as unknown as {
      renderSaveSuccess: (host: HTMLElement, prUrl: string) => void;
      renderSaveError: (host: HTMLElement, message: string) => void;
    };

    // Stale error banner from an earlier failed save.
    renderSaveError(host, 'previous failure');
    expect(
      host.querySelector(`[data-testid="${SAVE_ERROR_TESTID}"]`),
      'precondition: error banner must exist before the success call',
    ).not.toBeNull();

    renderSaveSuccess(host, 'https://github.com/foo/bar/pull/1');

    expect(
      host.querySelector(`[data-testid="${SAVE_ERROR_TESTID}"]`),
      'expected the stale save-error banner to be removed when renderSaveSuccess fires (AC 6.3 — mutual exclusion within the save-* banner family; without this the UI shows contradictory error+success at once).',
    ).toBeNull();
    expect(
      host.querySelector(`[data-testid="${SAVE_SUCCESS_TESTID}"]`),
      'expected the success banner to render after clearing the error.',
    ).not.toBeNull();
  });
});

describe('Issue #92 / AC 6.3 — click → POST /api/save 200 → success banner appears', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    window.history.replaceState(
      {},
      '',
      '/?repo=foo/bar&path=specs/spec.md&ref=main',
    );

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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  async function mountAndEnterEditMode(
    initialContent: string,
    opts: { baseSha?: string } = {},
  ): Promise<HTMLButtonElement> {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, initialContent);
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (
        h: HTMLElement,
        opts?: { baseSha?: string },
      ) => Promise<void>;
    };
    await enterEditMode(host, opts);
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-testid="${SAVE_BTN_TESTID}"]`,
    );
    if (!btn) throw new Error('precondition: save button must exist');
    return btn;
  }

  it('after a successful POST /api/save, the save-success banner appears with the response prUrl', async () => {
    // The end-to-end integration: click handler → submitSave →
    // server returns {ok:true, prUrl} → renderSaveSuccess fires
    // with that prUrl. Without this wiring, the success path on
    // the worker side returns a PR URL that nothing on the
    // frontend ever surfaces.
    const responsePrUrl = 'https://github.com/foo/bar/pull/777';
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: responsePrUrl }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode('# Spec\n', {
      baseSha: 'CAPTURED_BASE_SHA_abc123',
    });
    btn.click();
    // Wait for the click handler's async chain to settle.
    await new Promise((r) => setTimeout(r, 30));

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_SUCCESS_TESTID}"]`,
    );
    expect(
      banner,
      `expected a [data-testid="${SAVE_SUCCESS_TESTID}"] banner to appear after a successful save (AC 6.3 — click handler must call renderSaveSuccess on the {ok:true, prUrl} response).`,
    ).not.toBeNull();

    const link = banner!.querySelector<HTMLAnchorElement>('a[href]');
    expect(
      link,
      'expected the success banner to contain a link (AC 6.3).',
    ).not.toBeNull();
    expect(
      link!.getAttribute('href'),
      `expected the link href to equal the worker's response prUrl verbatim (AC 6.3 — round-trip from worker → frontend → user). Expected: ${JSON.stringify(responsePrUrl)}. Got: ${JSON.stringify(link!.getAttribute('href'))}.`,
    ).toBe(responsePrUrl);
  });

  it('on a non-success response (e.g., {ok:false, kind:"no-write"}), the save-success banner is NOT rendered', async () => {
    // Defensive: an impl that calls renderSaveSuccess uncondi-
    // tionally (e.g., on every settled promise regardless of body)
    // would surface a misleading "save succeeded" banner on a
    // failure. Pin: success banner appears ONLY on {ok:true}.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'no-write',
          message: 'something went wrong',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );

    const btn = await mountAndEnterEditMode('# Spec\n', {
      baseSha: 'CAPTURED_BASE_SHA_abc123',
    });
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    expect(
      host.querySelector(`[data-testid="${SAVE_SUCCESS_TESTID}"]`),
      'expected NO save-success banner on a {ok:false} response (AC 6.3 — success banner is gated on ok:true; without this gate, every settled save would appear successful regardless of outcome).',
    ).toBeNull();
  });
});
