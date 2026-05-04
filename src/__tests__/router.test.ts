import { describe, it, expect } from 'vitest';

// Issue #90 / AC 4.1 — URL-parameter routing.
//
// The viewer entry point reads the spec to render from query params:
//
//   ?repo=owner/name&path=specs/foo.md&ref=main
//
// Contract pinned in this file:
//
//   1. `parseSpecUrl` is a named export of `src/router.ts` (a NEW module
//      separate from the Tauri-coupled `src/main.ts`). The split keeps
//      web-mode logic testable and prevents the URL parser from picking
//      up the Tauri import side-effects that gate `src/main.ts`'s test
//      mocks.
//
//   2. Signature: `parseSpecUrl(href: string)` returns either
//        { repo, path, ref }                 // valid
//      or
//        { error: string }                   // invalid
//
//      We discriminate via `'error' in result`, NOT by null/undefined.
//      An explicit error string keeps the landing-page test (AC 4.2)
//      able to inspect *why* the parse failed without re-running the
//      parser.
//
//   3. Validation rules (locked in via the cases below):
//        - `repo` must match `^<owner>/<name>$` where each segment
//          matches `[A-Za-z0-9._-]+` (GitHub-realistic — github
//          usernames allow hyphens, repo names allow dots/underscores).
//          Exactly one `/` separator. No empty segments.
//        - `path` must be present and non-empty (after URI decode).
//          Leading `/` is rejected (paths are repo-relative; a leading
//          slash signals user error).
//        - `ref` defaults to `'main'` when absent. When present it
//          must be non-empty after decode.
//
//   4. The parser accepts a full href OR a search string starting with
//      `?`. We test both shapes — the runtime hands it `window.location.href`
//      but isolated unit tests are easier with `?repo=...`.
//
// These cases are exhaustive for the pure-function surface; the
// integration with Milkdown / fetch / the landing page lives in
// later AC tests (4.2 / 4.3 / 4.4).

describe('Issue #90 / AC 4.1 — parseSpecUrl', () => {
  it('is a named export of src/router.ts', async () => {
    // RED until builder creates `src/router.ts` exporting `parseSpecUrl`.
    // This test exists separately so the failure mode "missing module"
    // surfaces precisely instead of as an opaque undefined-call inside
    // a behavioral test.
    const mod = (await import('../router')) as unknown as {
      parseSpecUrl?: unknown;
    };
    expect(
      typeof mod.parseSpecUrl,
      'expected `parseSpecUrl` to be exported as a function from src/router.ts (Issue #90 AC 4.1).',
    ).toBe('function');
  });

  it('parses a full href with repo + path + ref', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      'https://hashly.example/?repo=deanchanter/Hashly&path=specs/foo.md&ref=main',
    );
    expect(result, 'expected a successful parse with all three fields').toEqual({
      repo: 'deanchanter/Hashly',
      path: 'specs/foo.md',
      ref: 'main',
    });
  });

  it('accepts a bare search string starting with `?` (not a full href)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=deanchanter/Hashly&path=README.md&ref=main');
    expect(result).toEqual({
      repo: 'deanchanter/Hashly',
      path: 'README.md',
      ref: 'main',
    });
  });

  it('defaults `ref` to "main" when the query param is absent', async () => {
    // The example link in the AC body is exactly this shape:
    //   ?repo=deanchanter/Hashly&path=README.md
    // — no ref. The default must be "main" so the example link works
    // without manual ref-supplying.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      'https://hashly.example/?repo=deanchanter/Hashly&path=README.md',
    );
    expect(result).toEqual({
      repo: 'deanchanter/Hashly',
      path: 'README.md',
      ref: 'main',
    });
  });

  it('URI-decodes path segments (e.g. encoded `/`)', async () => {
    // A nested path like `specs/v0.3-web-pivot/spec.md` is the common
    // case. URLSearchParams handles plain `/` fine, but a defensively
    // encoded value (`specs%2Ffoo.md`) must round-trip too — otherwise
    // a copy-pasted URL with an over-encoded path silently fails.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=deanchanter/Hashly&path=specs%2Fv0.3-web-pivot%2Fspec.md&ref=main',
    );
    expect(result).toEqual({
      repo: 'deanchanter/Hashly',
      path: 'specs/v0.3-web-pivot/spec.md',
      ref: 'main',
    });
  });

  it('returns `{ error }` when `repo` is missing', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?path=README.md');
    expect(
      result,
      'expected an error object (not null/undefined) when repo is missing',
    ).toHaveProperty('error');
    expect(
      (result as { error: string }).error,
      'expected the error string to mention the missing `repo` param so the landing page can show actionable copy',
    ).toMatch(/repo/i);
  });

  it('returns `{ error }` when `path` is missing', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=deanchanter/Hashly');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('returns `{ error }` when `path` is present but empty', async () => {
    // Empty `path` is a distinct failure from "missing path" — the
    // user supplied the param but with no value. Must still error
    // (we cannot fetch an empty path).
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=deanchanter/Hashly&path=');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('returns `{ error }` when `repo` is missing the `/` separator', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=Hashly&path=README.md');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/repo/i);
  });

  it('returns `{ error }` when `repo` has more than one `/` (subpath, not owner/name)', async () => {
    // `owner/name/extra` is not a valid github repo shape. We reject
    // it explicitly so a user who pastes a deep github URL into the
    // repo param sees a clear error rather than a 404 on a fabricated
    // `raw.githubusercontent.com/owner/name/extra/main/README.md`.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=deanchanter/Hashly/extra&path=README.md');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/repo/i);
  });

  it('returns `{ error }` when `repo` owner segment is empty', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=/Hashly&path=README.md');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/repo/i);
  });

  it('returns `{ error }` when `repo` name segment is empty', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=deanchanter/&path=README.md');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/repo/i);
  });

  it('returns `{ error }` when `repo` contains illegal characters (e.g. spaces)', async () => {
    // GitHub repo names disallow spaces. We reject any char outside
    // `[A-Za-z0-9._-]` in either segment so we never construct a
    // raw.githubusercontent.com URL with characters that would 404
    // (or worse, escape a path boundary).
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=' + encodeURIComponent('dean chanter') + '/Hashly&path=README.md',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/repo/i);
  });

  it('returns `{ error }` when `path` starts with `/` (paths are repo-relative)', async () => {
    // A leading slash means "absolute" — but raw.githubusercontent.com
    // composes the URL as `<repo>/<ref>/<path>`, so a leading slash
    // would produce `<repo>/<ref>//path` which 404s. Reject up front
    // with a clear error rather than letting AC 4.7's 404 surface
    // hide the real cause.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=deanchanter/Hashly&path=/README.md');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('accepts a non-default ref (e.g. a branch name)', async () => {
    // Sanity check that the ref param actually overrides the default.
    // Without this, an implementation that hard-codes `ref = "main"`
    // would still pass the default-ref test above.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=deanchanter/Hashly&path=README.md&ref=issue-90-viewer',
    );
    expect(result).toEqual({
      repo: 'deanchanter/Hashly',
      path: 'README.md',
      ref: 'issue-90-viewer',
    });
  });

  it('returns `{ error }` when `ref` is present but empty', async () => {
    // Like empty `path`: present-but-empty is a distinct failure from
    // absent. A blank ref would produce a malformed
    // raw.githubusercontent.com URL.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=deanchanter/Hashly&path=README.md&ref=');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });
});

// Critical fix #2 (security) — path-traversal hardening.
//
// The original AC 4.1 parser only rejected paths starting with `/`.
// That left a kill chain:
//   ?repo=trusted/repo&path=../../attacker/malrepo/main/payload.md
// would build the raw URL `https://raw.githubusercontent.com/trusted/repo/main/../../attacker/malrepo/main/payload.md`,
// which the browser's URL normalizer collapses BEFORE the request,
// resolving to the attacker's repo. The viewer header still shows
// the trusted repo (textContent), giving the user no signal that
// they're reading attacker content.
//
// Fix: reject any path that contains a `..`, `.`, or empty segment
// (in raw OR percent-encoded form). The contract pinned here is
// "every segment after URI-decode + split('/') must be a non-empty,
// non-dot, non-dotdot string".

describe('Issue #90 / Critical fix #2 — path-traversal rejection in parseSpecUrl', () => {
  it('rejects a path containing a `..` segment (parent-directory traversal)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=../attacker/malrepo/main/payload.md',
    );
    expect(
      result,
      'expected `..` segment to be rejected — silent origin spoof otherwise (constructs a raw.githubusercontent.com URL that the browser normalizes to the attacker repo).',
    ).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('rejects a path with a `..` segment in the MIDDLE of the path', async () => {
    // Mid-path `..` is the same exploit shape as leading `..` —
    // the URL normalizer collapses it before the request. Pin
    // both positions so a regression that only blocks leading
    // traversal can't slip through.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=specs/../../../attacker/payload.md',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('rejects a path containing a `.` segment (current-directory)', async () => {
    // `.` segments are also collapsed by URL normalization. While
    // less impactful than `..`, accepting them lets an attacker
    // craft a URL that looks structurally different from what the
    // viewer header displays (e.g. `specs/./foo.md` vs `specs/foo.md`).
    // Reject for consistency + defense in depth.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=specs/./foo.md',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('rejects a path that is exactly `..`', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=trusted/repo&path=..');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('rejects a path that is exactly `.`', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=trusted/repo&path=.');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('rejects a percent-encoded `..` segment (`%2E%2E`)', async () => {
    // The parser URI-decodes the path BEFORE validation. Pin the
    // post-decode check by feeding `%2E%2E` (which decodes to
    // `..`) and asserting it's rejected. Without this, a naïve
    // pre-decode regex check could be bypassed via encoding.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=%2E%2E/attacker/payload.md',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('rejects a path with empty segments (consecutive `//`)', async () => {
    // `specs//foo.md` URL-normalizes to `specs/foo.md` — same
    // structural-difference concern as `.`. Already implicitly
    // rejected by some impls (split('/') yields empty string),
    // but pinning explicitly so the contract is "every segment
    // is a non-empty filesystem-name-like token".
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=specs//foo.md',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('rejects a percent-encoded SINGLE dot segment (`%2E`)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=%2E/foo.md',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('still accepts valid nested paths (`specs/v0.3-web-pivot/spec.md`) — regression on the happy path', async () => {
    // Defensive: make sure the new traversal rejection didn't
    // accidentally outlaw the common "nested subdirectory" case.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=specs/v0.3-web-pivot/spec.md&ref=main',
    );
    expect(result).toEqual({
      repo: 'trusted/repo',
      path: 'specs/v0.3-web-pivot/spec.md',
      ref: 'main',
    });
  });

  it('still accepts paths whose segments contain dots (e.g. `v0.3-web-pivot`) — only `.` and `..` segments are forbidden', async () => {
    // `v0.3-web-pivot` is a valid directory name in this repo.
    // The traversal check must distinguish a SEGMENT that IS `.`
    // from a segment that CONTAINS `.`s.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=specs/v0.3-web-pivot/spec.md',
    );
    expect(result).toHaveProperty('repo');
    expect((result as { path: string }).path).toBe('specs/v0.3-web-pivot/spec.md');
  });
});

// Critical fix iteration 2 (security) — `ref` traversal + charset
// hardening.
//
// Round 1's fix #2 closed `path` traversal but left `ref` wide open.
// The same kill chain works through `ref`:
//
//   ?repo=trusted/repo&path=README.md&ref=main/../../../attacker/malrepo/main
//
// `parseSpecUrl` accepts this; `fetchSpec` composes
//   https://raw.githubusercontent.com/trusted/repo/main/../../../attacker/malrepo/main/README.md
// which the browser normalizes BEFORE the HTTP request to
//   https://raw.githubusercontent.com/attacker/malrepo/main/README.md
// — silent origin spoof, viewer header still showing `trusted/repo`.
//
// Bundled with the charset-tightening half of a round-1 non-critical:
// reject any `ref` containing characters outside the github-realistic
// `[A-Za-z0-9._/-]` set so `ref=<script>`, `ref=main?evil=1`,
// `ref=main#frag`, control chars, spaces all fail at parse time.
//
// Branch names like `release/v1.2` are valid (slash separators), so
// `ref` must validate per-segment, not as a single token.

describe('Issue #90 / Critical fix iteration 2 — `ref` traversal + charset hardening', () => {
  it('rejects a `ref` containing a `..` segment (parent-directory traversal)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=main/../../../attacker/malrepo/main',
    );
    expect(
      result,
      'expected `..` segment in ref to be rejected — silent origin spoof otherwise (browser URL normalization collapses `..` before the HTTP request).',
    ).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  it('rejects a `ref` containing a `.` segment (current-directory)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=main/./feature',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  it('rejects a `ref` that is exactly `..`', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl('?repo=trusted/repo&path=README.md&ref=..');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  it('rejects a `ref` starting with `/` (leading slash creates an empty first segment)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=/main',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  it('rejects a `ref` ending with `/` (trailing slash creates an empty last segment)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=main/',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  it('rejects a `ref` with consecutive `//` (empty middle segment)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=release//v1.2',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  it('rejects a percent-encoded `..` in `ref` (`%2E%2E` after URI decode)', async () => {
    // Decode-then-validate: `%2E%2E` decodes to `..`, which then
    // fails the segment check. Pin so a future regression that
    // validates pre-decode would let the encoded form through.
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=main/%2E%2E/attacker',
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  it('rejects a `ref` containing a space', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=' + encodeURIComponent('main branch'),
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  it('rejects a `ref` containing `<` / `>` / control chars (charset tightening)', async () => {
    // Defense-in-depth: even though these would never reach
    // raw.githubusercontent.com cleanly, rejecting them at parse
    // time means the viewer-header textContent never displays
    // user-supplied `<` / `>` / NUL bytes either.
    const { parseSpecUrl } = await import('../router');
    const cases = ['<script>', '%00', '%3Cscript%3E', ' '];
    for (const bad of cases) {
      const result = parseSpecUrl(
        '?repo=trusted/repo&path=README.md&ref=' + encodeURIComponent(bad),
      );
      expect(
        result,
        `expected ref ${JSON.stringify(bad)} (rejecting after URI decode) to be rejected on charset.`,
      ).toHaveProperty('error');
    }
  });

  it('rejects a `ref` containing `?` (would be parsed as a query separator in the composed URL)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=' + encodeURIComponent('main?evil=1'),
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  it('rejects a `ref` containing `#` (would be parsed as a fragment in the composed URL)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=' + encodeURIComponent('main#frag'),
    );
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/ref/i);
  });

  // Happy-path regression pins — make sure the new validation doesn't
  // outlaw legitimate branch / tag refs.

  it('accepts a simple branch name `main`', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=main',
    );
    expect((result as { ref: string }).ref).toBe('main');
  });

  it('accepts a slash-separated branch name `release/v1.2`', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=release/v1.2',
    );
    expect((result as { ref: string }).ref).toBe('release/v1.2');
  });

  it('accepts `feature/foo-bar` (hyphenated multi-segment ref)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=feature/foo-bar',
    );
    expect((result as { ref: string }).ref).toBe('feature/foo-bar');
  });

  it('accepts a SemVer tag-style ref `v0.3.0`', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=v0.3.0',
    );
    expect((result as { ref: string }).ref).toBe('v0.3.0');
  });

  it('accepts the repo\'s actual release tag `0.2.3-bundle-signing` (dots, hyphens, mixed)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=0.2.3-bundle-signing',
    );
    expect((result as { ref: string }).ref).toBe('0.2.3-bundle-signing');
  });

  it('accepts `release/v1.2_rc.1` (underscores allowed)', async () => {
    const { parseSpecUrl } = await import('../router');
    const result = parseSpecUrl(
      '?repo=trusted/repo&path=README.md&ref=release/v1.2_rc.1',
    );
    expect((result as { ref: string }).ref).toBe('release/v1.2_rc.1');
  });

  // Defense-in-depth — any accepted ref must compose into a URL that
  // normalizes to start with `/${repo}/${ref}/`. If a malicious ref
  // somehow slipped past the segment / charset checks, this catches
  // the consequence: the URL fed to fetch resolves to a different
  // repo than the one displayed in the viewer header.

  it('any accepted `ref` produces a fetch URL whose normalized pathname starts with `/${repo}/${ref}/`', async () => {
    // We feed several valid refs through `parseSpecUrl` then through
    // `fetchSpec`'s URL composition (mirroring the implementation
    // shape, since fetchSpec is what actually builds the URL). We
    // then run the composed URL through `new URL(...)` — exactly
    // what the browser does — and assert pathname survives intact.
    const { parseSpecUrl } = await import('../router');

    const cases = [
      { ref: 'main', path: 'README.md' },
      { ref: 'release/v1.2', path: 'specs/v0.3-web-pivot/spec.md' },
      { ref: 'feature/foo-bar', path: 'docs/api.md' },
      { ref: 'v0.3.0', path: 'README.md' },
      { ref: '0.2.3-bundle-signing', path: 'CHANGELOG.md' },
    ];

    const repo = 'trusted/repo';
    for (const { ref, path } of cases) {
      const parsed = parseSpecUrl(
        '?repo=' + repo + '&path=' + encodeURIComponent(path) + '&ref=' + encodeURIComponent(ref),
      );
      expect(
        parsed,
        `precondition: ref ${JSON.stringify(ref)} must parse successfully.`,
      ).not.toHaveProperty('error');
      const ok = parsed as { repo: string; path: string; ref: string };

      const composed =
        `https://raw.githubusercontent.com/${ok.repo}/${ok.ref}/${ok.path
          .split('/')
          .map((s) => encodeURIComponent(s))
          .join('/')}`;
      const normalized = new URL(composed);

      const expectedPrefix = `/${ok.repo}/${ok.ref}/`;
      expect(
        normalized.pathname.startsWith(expectedPrefix),
        `expected URL normalization to keep the pathname starting with ${JSON.stringify(expectedPrefix)} so the fetch targets the repo+ref the viewer header displays. Got pathname: ${JSON.stringify(normalized.pathname)} from composed URL: ${JSON.stringify(composed)}.`,
      ).toBe(true);

      // Sanity: the normalized URL must NOT contain `..` or `/.` —
      // if it did, the segment check let something through.
      expect(normalized.pathname.includes('/../')).toBe(false);
      expect(normalized.pathname.includes('/./')).toBe(false);
    }
  });
});
