import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #90 / AC 4.3 — Anonymous public-repo fetch via GitHub raw
// content REST endpoint.
//
// `fetchSpec(repo, ref, path)` issues a GET against
//   https://raw.githubusercontent.com/<repo>/<ref>/<encoded-path>
// with NO Authorization header (anonymous public-repo only) and
// returns a discriminated result that the bootstrap maps to either
// the viewer mount (200) or one of three error states (AC 4.7:
// not-found / forbidden / network).
//
// We hand-roll fetch (no octokit on the frontend, per the AC).
//
// Contract pinned in this file:
//
//   - Named export `fetchSpec` from `src/fetch-spec.ts`.
//   - Returns a discriminated union:
//       { ok: true, content: string }                 // 200 OK
//       { ok: false, kind: 'not-found' }              // 404
//       { ok: false, kind: 'forbidden' }              // 403
//       { ok: false, kind: 'network' }                // fetch threw
//       { ok: false, kind: 'other', status: number } // any other non-2xx
//   - Requests `https://raw.githubusercontent.com/<repo>/<ref>/<path>`.
//   - URL-encodes path segments (spaces, unicode) so a copy-pasted
//     path with non-ASCII names doesn't construct an invalid URL —
//     but PRESERVES `/` separators so subdirectories work.
//   - Does NOT attach an Authorization header (anonymous contract).
//
// Mocking strategy: stub `globalThis.fetch` per test. We never hit
// the real network from jsdom. The `Response` polyfill jsdom ships
// is enough for `.ok` / `.status` / `.text()`.

describe('Issue #90 / AC 4.3 — fetchSpec', () => {
  const originalFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('is a named export of src/fetch-spec.ts', async () => {
    const mod = (await import('../fetch-spec')) as unknown as {
      fetchSpec?: unknown;
    };
    expect(
      typeof mod.fetchSpec,
      'expected `fetchSpec` to be exported as a function from src/fetch-spec.ts (Issue #90 AC 4.3).',
    ).toBe('function');
  });

  it('GETs raw.githubusercontent.com/<repo>/<ref>/<path> and returns the body on 200', async () => {
    // Pin both the URL shape (the contract surface) and the resolution
    // shape (`{ ok: true, content }`). A copy-paste mistake that fetches
    // `api.github.com/.../contents/...` would 200 with JSON metadata
    // (not raw markdown) — without this pin the bootstrap would
    // happily render `{"name":"README.md",...}` as a markdown doc.
    fetchSpy.mockResolvedValueOnce(
      new Response('# Hello world\n\nbody', { status: 200 }),
    );

    const { fetchSpec } = await import('../fetch-spec');
    const result = await fetchSpec('deanchanter/Hashly', 'main', 'README.md');

    expect(fetchSpy, 'expected exactly one fetch call').toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchSpy.mock.calls[0]!;
    expect(
      calledUrl,
      `expected fetch URL to be the raw.githubusercontent.com endpoint for the supplied repo/ref/path. Got: ${JSON.stringify(calledUrl)}`,
    ).toBe('https://raw.githubusercontent.com/deanchanter/Hashly/main/README.md');

    expect(result).toEqual({ ok: true, content: '# Hello world\n\nbody' });
  });

  it('preserves `/` separators in nested paths (subdirectories work)', async () => {
    // Realistic case: `specs/v0.3-web-pivot/spec.md`. The URL must
    // contain the literal `/` (not `%2F`) so the GitHub raw endpoint
    // resolves the subdirectory. A naïve `encodeURIComponent(path)`
    // would encode every slash and 404.
    fetchSpy.mockResolvedValueOnce(new Response('content', { status: 200 }));

    const { fetchSpec } = await import('../fetch-spec');
    await fetchSpec('deanchanter/Hashly', 'main', 'specs/v0.3-web-pivot/spec.md');

    const [calledUrl] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(
      'https://raw.githubusercontent.com/deanchanter/Hashly/main/specs/v0.3-web-pivot/spec.md',
    );
  });

  it('URL-encodes path segments containing spaces or non-ASCII chars', async () => {
    // A path with a space (e.g. `notes/my file.md`) must be encoded
    // per-segment so the URL is well-formed without losing the
    // segment boundary. Pin the encoding here so a contributor who
    // strings the path in unencoded silently breaks unicode-named
    // files.
    fetchSpy.mockResolvedValueOnce(new Response('content', { status: 200 }));

    const { fetchSpec } = await import('../fetch-spec');
    await fetchSpec('deanchanter/Hashly', 'main', 'notes/my file.md');

    const [calledUrl] = fetchSpy.mock.calls[0]!;
    expect(
      calledUrl,
      `expected the space in "my file.md" to be encoded as "%20" (per-segment encoding) while the "/" separator stays literal. Got: ${JSON.stringify(calledUrl)}`,
    ).toBe(
      'https://raw.githubusercontent.com/deanchanter/Hashly/main/notes/my%20file.md',
    );
  });

  it('returns `{ ok: false, kind: "not-found" }` on a 404 response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const { fetchSpec } = await import('../fetch-spec');
    const result = await fetchSpec('deanchanter/Hashly', 'main', 'no-such-file.md');

    expect(result).toEqual({ ok: false, kind: 'not-found' });
  });

  it('returns `{ ok: false, kind: "forbidden" }` on a 403 response', async () => {
    // 403 is rare from raw.githubusercontent.com (private repos
    // surface as 404 to anonymous callers), but rate-limit / abuse
    // surfaces can still emit 403. AC 4.7 wants both mapped distinctly
    // so future copy can differentiate.
    fetchSpy.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

    const { fetchSpec } = await import('../fetch-spec');
    const result = await fetchSpec('private/repo', 'main', 'README.md');

    expect(result).toEqual({ ok: false, kind: 'forbidden' });
  });

  it('returns `{ ok: false, kind: "network" }` when fetch rejects (offline / DNS / TLS error)', async () => {
    // The offline / DNS-failure path. fetch() rejects with a
    // TypeError (per spec) before we get a Response. We must not
    // throw out of fetchSpec — the bootstrap relies on the
    // discriminated result to render a network-error UI.
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { fetchSpec } = await import('../fetch-spec');
    const result = await fetchSpec('deanchanter/Hashly', 'main', 'README.md');

    expect(result).toEqual({ ok: false, kind: 'network' });
  });

  it('returns `{ ok: false, kind: "other", status }` on a non-200/403/404 (e.g. 500)', async () => {
    // GitHub Pages outages / origin errors. Distinct from "network"
    // (we got a Response, just not a usable one). Including the
    // status lets the error surface include a hint without forcing
    // a specific code path per status.
    fetchSpy.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const { fetchSpec } = await import('../fetch-spec');
    const result = await fetchSpec('deanchanter/Hashly', 'main', 'README.md');

    expect(result).toEqual({ ok: false, kind: 'other', status: 500 });
  });

  it('does NOT attach an Authorization header (anonymous public-repo only)', async () => {
    // AC 4.3 explicitly: "no auth". The viewer must not accidentally
    // grow an authenticated codepath later — pin the absence of an
    // Authorization header here so a regression that drops a token
    // into the request is caught at test time.
    fetchSpy.mockResolvedValueOnce(new Response('content', { status: 200 }));

    const { fetchSpec } = await import('../fetch-spec');
    await fetchSpec('deanchanter/Hashly', 'main', 'README.md');

    const init = fetchSpy.mock.calls[0]![1] as RequestInit | undefined;
    if (init && init.headers) {
      const headers =
        init.headers instanceof Headers
          ? init.headers
          : new Headers(init.headers as HeadersInit);
      expect(
        headers.has('Authorization'),
        'expected NO Authorization header on the fetch (Issue #90 AC 4.3 — anonymous public-repo only). The viewer must not grow an auth surface here.',
      ).toBe(false);
    }
    // If init is undefined or has no headers, the assertion is
    // implicitly satisfied (no headers means no Authorization).
  });
});
