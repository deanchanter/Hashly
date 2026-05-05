import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #92 / AC 6.7 — Save-time no-write-access fail (frontend half).
//
// The worker translates a GitHub 403 on a write path into:
//   {ok: false, kind: 'no-write', message: <contains literal phrase>}
//
// "the message must include the literal text 'ask the dev to add you
// as a collaborator (or install the Hashly GitHub App on the repo)'."
//
// This file pins:
//
//   1. `submitSave` is exported from `src/save-flow.ts` and posts to
//      /api/save with the contracted body shape.
//   2. When the worker returns the no-write structured error,
//      `submitSave` resolves to the matching discriminated-union shape
//      `{ok: false, kind: 'no-write', message}`.
//   3. `renderSaveError(host, message)` is exported from
//      `src/save-result.ts` and creates a `[data-testid="save-error"]`
//      banner above the editor with the message text — same pattern
//      as `[data-testid="view-only-lock"]` and
//      `[data-testid="post-auth-prompt"]` (AC 5.5 / 5.3 cross-pin).
//   4. End-to-end: passing the no-write response into the rendering
//      seam produces a banner whose textContent contains the literal
//      AC 6.7 phrase verbatim.
//
// Pinned testid: `save-error`. The conflict banner (AC 6.5) uses
// `save-conflict`; the success banner (AC 6.3) uses `save-success`.
// Three distinct testids so each AC can pin its own surface without
// stomping the others.
//
// Tests opt out of vitest.setup.ts's Tauri-default flag — save flow
// is a web-mode-only path.

// AC 6.7 — VERBATIM. Cross-pinned with worker/test/save-no-write.test.ts.
const REQUIRED_PHRASE =
  "ask the dev to add you as a collaborator (or install the Hashly GitHub App on the repo)";

const SAVE_ERROR_TESTID = 'save-error';

describe('Issue #92 / AC 6.7 — submitSave named export + no-write response shape', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('exports `submitSave` as a named function from src/save-flow.ts', async () => {
    // RED until the builder creates `src/save-flow.ts` with the
    // named export. The "is a function" floor forbids a regression
    // where a default-export module shape silently typechecks
    // against `undefined` (same shape as the AC 5.1 / 5.2 floor
    // tests that pin `enterEditMode` / `attemptEditAction`).
    const mod = (await import('../save-flow')) as unknown as {
      submitSave?: unknown;
    };
    expect(
      typeof mod.submitSave,
      'expected `submitSave` to be exported as a function from src/save-flow.ts (Issue #92 — the seam every save AC composes against).',
    ).toBe('function');
  });

  it('POSTs to /api/save with the contracted body shape (repo, path, ref, content, baseSha) and credentials: same-origin', async () => {
    // Pin BOTH the URL/path (so a copy-paste mistake to /api/save/
    // or a base-URL prefix is caught) AND the body fields (so a
    // regression that drops baseSha — the stale-SHA detection key —
    // doesn't silently slip past). credentials: same-origin so the
    // HttpOnly session cookie rides along.
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'no-write',
          message: REQUIRED_PHRASE,
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { submitSave } = (await import('../save-flow')) as unknown as {
      submitSave: (opts: {
        repo: string;
        path: string;
        ref: string;
        content: string;
        baseSha: string;
        commitMessage?: string;
      }) => Promise<unknown>;
    };

    await submitSave({
      repo: 'foo/bar',
      path: 'specs/spec.md',
      ref: 'main',
      content: 'edited content\n',
      baseSha: 'BASE_SHA_MATCHES',
    });

    expect(
      fetchSpy,
      'expected exactly one fetch call (AC 6.2 — submitSave issues a single POST to /api/save).',
    ).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(
      String(url),
      `expected the fetch URL to be /api/save (AC 6.2 — the worker's save endpoint). Got: ${JSON.stringify(url)}.`,
    ).toBe('/api/save');

    const sentInit = (init ?? {}) as RequestInit;
    expect(
      sentInit.method,
      'expected method: "POST" (AC 6.2 — POST /api/save). A GET would not carry the body fields.',
    ).toBe('POST');
    expect(
      sentInit.credentials,
      'expected credentials: "same-origin" so the HttpOnly session cookie is included (without it the worker auth-gates with 401 even for authed users).',
    ).toBe('same-origin');

    const ct = new Headers(sentInit.headers as HeadersInit | undefined).get(
      'content-type',
    );
    expect(
      ct?.toLowerCase() ?? '',
      `expected Content-Type: application/json so the worker can parse the body (AC 6.2). Got: ${JSON.stringify(ct)}.`,
    ).toContain('application/json');

    expect(typeof sentInit.body).toBe('string');
    const parsed = JSON.parse(sentInit.body as string) as Record<string, unknown>;
    expect(parsed.repo).toBe('foo/bar');
    expect(parsed.path).toBe('specs/spec.md');
    expect(parsed.ref).toBe('main');
    expect(parsed.content).toBe('edited content\n');
    expect(
      parsed.baseSha,
      `expected the body to carry baseSha verbatim — this is the stale-SHA detection key (AC 6.4 cross-pin); a regression that drops it would silently disable conflict detection. Got body: ${JSON.stringify(parsed)}.`,
    ).toBe('BASE_SHA_MATCHES');
  });

  it('on a no-write JSON response, resolves to {ok:false, kind:"no-write", message:<contains literal phrase>}', async () => {
    // The central RED-path pin. The discriminated-union shape is
    // the contract every consumer of submitSave will branch on; if
    // the kind field gets renamed or the message gets dropped, the
    // banner-rendering path silently falls into the wrong branch.
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'no-write',
          message: REQUIRED_PHRASE,
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { submitSave } = (await import('../save-flow')) as unknown as {
      submitSave: (opts: Record<string, string>) => Promise<{
        ok: boolean;
        kind?: string;
        message?: string;
        prUrl?: string;
      }>;
    };

    const result = await submitSave({
      repo: 'foo/bar',
      path: 'specs/spec.md',
      ref: 'main',
      content: 'edited\n',
      baseSha: 'BASE_SHA_MATCHES',
    });

    expect(
      result.ok,
      `expected ok:false on a no-write response (AC 6.7). Got: ${JSON.stringify(result)}.`,
    ).toBe(false);
    expect(
      result.kind,
      `expected kind:'no-write' (AC 6.7 — distinguishes the dedicated banner from generic errors / conflicts). Got: ${JSON.stringify(result)}.`,
    ).toBe('no-write');
    expect(typeof result.message).toBe('string');
    expect(
      String(result.message),
      `expected the message to carry the AC 6.7 literal phrase verbatim ${JSON.stringify(REQUIRED_PHRASE)}. Got: ${JSON.stringify(result.message)}.`,
    ).toContain(REQUIRED_PHRASE);
  });

  it('on a fetch network error (TypeError), resolves to {ok:false, kind:"network", ...} and does NOT reject', async () => {
    // Defensive floor: an offline / DNS-down state must NOT surface
    // as an unhandled rejection in the WebView console. Same shape
    // as attemptEditAction's fetch-throw resolution (AC 5.2). The
    // 'network' kind lets the frontend show a transient-friendly
    // message instead of the no-write copy.
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { submitSave } = (await import('../save-flow')) as unknown as {
      submitSave: (opts: Record<string, string>) => Promise<{
        ok: boolean;
        kind?: string;
      }>;
    };

    let result: { ok: boolean; kind?: string } | undefined;
    await expect(
      (async () => {
        result = await submitSave({
          repo: 'foo/bar',
          path: 'specs/spec.md',
          ref: 'main',
          content: 'edited\n',
          baseSha: 'BASE_SHA_MATCHES',
        });
      })(),
      'expected submitSave to NOT reject on a network error (AC 6.7 defensive floor — return a structured `network` kind instead).',
    ).resolves.toBeUndefined();
    expect(result?.ok).toBe(false);
    expect(
      result?.kind,
      `expected kind:'network' on a fetch throw so the frontend can render a transient-friendly message rather than the no-write copy. Got: ${JSON.stringify(result)}.`,
    ).toBe('network');
  });
});

describe('Issue #92 / AC 6.7 — renderSaveError banner pattern', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('exports `renderSaveError` as a named function from src/save-result.ts', async () => {
    // RED until the builder creates `src/save-result.ts` with the
    // named export. Same floor pattern as renderViewOnlyLock /
    // renderPostAuthPrompt — co-locating the save banner family in
    // its own module so the save flow can import them without
    // dragging in main.ts's Tauri side-effects.
    const mod = (await import('../save-result')) as unknown as {
      renderSaveError?: unknown;
    };
    expect(
      typeof mod.renderSaveError,
      'expected `renderSaveError` to be exported as a function from src/save-result.ts (Issue #92 / AC 6.7 — the banner-rendering seam used by 6.5 / 6.7).',
    ).toBe('function');
  });

  it('creates a [data-testid="save-error"] element with the message text and prepends it ABOVE the editor', async () => {
    // The form-factor pin. Mirrors the AC 5.5 view-only-lock /
    // AC 5.3 post-auth-prompt patterns so a screen-reader user
    // and a sighted user both see the error consistently with the
    // rest of the banner family. Above-the-editor positioning is
    // pinned by host.firstElementChild — same shape as fix-loop-1
    // pins for the other banners.
    const { renderSaveError } = (await import('../save-result')) as unknown as {
      renderSaveError: (host: HTMLElement, message: string) => void;
    };

    // Pre-populate the host with editor-shaped content so the
    // "above the editor" pin is meaningful (without it, a banner
    // appended into an empty host would trivially be the only
    // child and the prepend-vs-append distinction would be
    // unobservable).
    const editorBody = document.createElement('div');
    editorBody.className = 'ProseMirror';
    editorBody.textContent = 'editor body';
    host.appendChild(editorBody);

    renderSaveError(host, 'something went wrong');

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_ERROR_TESTID}"]`,
    );
    expect(
      banner,
      `expected a [data-testid="${SAVE_ERROR_TESTID}"] element after renderSaveError (AC 6.7 — the dedicated save-error banner surface).`,
    ).not.toBeNull();
    expect(
      banner!.textContent,
      `expected the banner textContent to include the message string. Got: ${JSON.stringify(banner!.textContent)}.`,
    ).toContain('something went wrong');

    expect(
      host.firstElementChild,
      'expected the save-error banner to be the FIRST child of the host so it sits ABOVE the editor body (AC 6.7 banner positioning — mirrors the AC 5.5 view-only-lock pattern; without prepend the user has to scroll past the editor to see the error).',
    ).toBe(banner);
  });

  it('rendered banner contains the AC 6.7 literal phrase verbatim when given the no-write message', async () => {
    // The hard contract: the literal phrase from issue #92 / AC 6.7
    // must end up in the user-visible DOM. Without this pin, the
    // worker-side translation could be correct but a frontend
    // regression that strips/sanitizes the message before render
    // would silently lose it.
    const { renderSaveError } = (await import('../save-result')) as unknown as {
      renderSaveError: (host: HTMLElement, message: string) => void;
    };

    renderSaveError(host, REQUIRED_PHRASE);

    const banner = host.querySelector<HTMLElement>(
      `[data-testid="${SAVE_ERROR_TESTID}"]`,
    );
    expect(banner, 'precondition: banner must be in the DOM').not.toBeNull();
    expect(
      banner!.textContent ?? '',
      `expected the rendered banner to contain the AC 6.7 literal phrase verbatim ${JSON.stringify(REQUIRED_PHRASE)}. Got: ${JSON.stringify(banner!.textContent)}.`,
    ).toContain(REQUIRED_PHRASE);
  });

  it('idempotent — a second renderSaveError call replaces the existing banner instead of stacking', async () => {
    // Defensive: if the user retries a save and gets a second
    // failure, the UI must NOT stack two banners (the second
    // wouldn't be visible above the first; the user would see
    // stale copy). Pin: at most one save-error banner in the DOM
    // at any time. Mirrors the renderViewOnlyLock idempotency
    // (AC 5.5) and renderPostAuthPrompt idempotency (AC 5.3).
    const { renderSaveError } = (await import('../save-result')) as unknown as {
      renderSaveError: (host: HTMLElement, message: string) => void;
    };

    renderSaveError(host, 'first failure');
    renderSaveError(host, 'second failure');

    const banners = host.querySelectorAll(
      `[data-testid="${SAVE_ERROR_TESTID}"]`,
    );
    expect(
      banners.length,
      `expected exactly ONE [data-testid="${SAVE_ERROR_TESTID}"] element after two renderSaveError calls (AC 6.7 idempotency — stacking would let stale errors hide the live one).`,
    ).toBe(1);
    expect(
      (banners[0]!.textContent ?? '').includes('second failure') ||
        (banners[0]!.textContent ?? '').includes('first failure'),
      'expected at least one of the two messages to be visible (the impl picks "first wins" or "latest replaces"; either is acceptable, but stacking is not).',
    ).toBe(true);
  });
});
