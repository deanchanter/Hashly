import { describe, it, expect, beforeEach } from 'vitest';

// Issue #90 / Critical fix #1 (security) — XSS scheme rejection.
//
// Milkdown's commonmark + gfm presets pass URI schemes through the
// markdown parser verbatim. A markdown file in any public repo can
// embed a payload like:
//
//   [click me](javascript:alert(1))
//   [click me](JaVaScRiPt:fetch('/api/...'))
//   [click me]( javascript:...)        ← leading whitespace
//   [click me](data:text/html,<script>alert(1)</script>)
//   [click me](vbscript:...)
//   ![alt](javascript:alert(1))         ← image src is the same vector
//
// Click → JS executes on the viewer's origin (hashly.pages.dev),
// with access to the user's session, cookies, etc. Combined with
// the path-traversal finding (fix #2), this was a full kill chain.
//
// Fix shape: a post-mount sanitizer in `mountViewer` that walks
// the rendered DOM, locates every `<a>` with `href` and every
// `<img>` with `src`, and ensures NEITHER attribute carries a
// scheme outside the safe allowlist:
//
//   safe: relative URLs (no scheme), http:, https:, mailto:
//   forbidden: javascript:, data:, vbscript:, anything else
//
// The builder is free to choose the recovery: strip the attribute
// and let the element render as inert text, replace `<a>` with a
// `<span>`, or rewrite to a safe value like `about:blank`. The
// tests pin the OUTCOME ("no `<a>` in the DOM has a dangerous href
// after mount") rather than the mechanism.
//
// Pattern: each test renders a single markdown payload via
// `mountViewer` and inspects the resulting host DOM. We deliberately
// keep the markdown payloads minimal so a failure points at the one
// broken case.

const SCHEME_RE = /^\s*(javascript|data|vbscript)\s*:/i;

function dangerousAnchors(host: HTMLElement): HTMLAnchorElement[] {
  return Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(
    (a) => SCHEME_RE.test(a.getAttribute('href') ?? ''),
  );
}

function dangerousImages(host: HTMLElement): HTMLImageElement[] {
  return Array.from(host.querySelectorAll<HTMLImageElement>('img[src]')).filter(
    (img) => SCHEME_RE.test(img.getAttribute('src') ?? ''),
  );
}

describe('Issue #90 / Critical fix #1 — XSS scheme rejection in mountViewer', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('rejects a `javascript:` href in a markdown link', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](javascript:alert(1))');

    expect(
      dangerousAnchors(host).map((a) => a.getAttribute('href')),
      'expected NO `<a>` with a `javascript:` href after mount — clicking would execute attacker JS on the viewer\'s origin (Issue #90 critical fix #1).',
    ).toEqual([]);
  });

  it('rejects a mixed-case `JaVaScRiPt:` href (case-insensitive scheme detection)', async () => {
    // A naïve `startsWith('javascript:')` check fails this case;
    // pin the case-insensitive contract so the impl normalizes
    // the scheme before comparing.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](JaVaScRiPt:alert(1))');

    expect(
      dangerousAnchors(host).map((a) => a.getAttribute('href')),
      'expected `JaVaScRiPt:` (mixed case) to be rejected — browsers parse the scheme case-insensitively, so the sanitizer must too (Issue #90 critical fix #1).',
    ).toEqual([]);
  });

  it('rejects a `javascript:` href via CommonMark angle-bracket-wrapped destination (`[x](<javascript:...>)`)', async () => {
    // CommonMark allows wrapping a link destination in `<...>` to
    // include characters the bare form would treat as
    // terminators. This is a distinct syntactic surface from
    // `[x](javascript:...)`; pin the sanitizer's contract for
    // both forms so a future Milkdown upgrade that emits one
    // form differently can't slip a payload through.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](<javascript:alert(1)>)');

    expect(
      dangerousAnchors(host).map((a) => a.getAttribute('href')),
      'expected `<javascript:...>`-wrapped href to be rejected — same threat model as the bare form, distinct CommonMark syntax (Issue #90 critical fix #1).',
    ).toEqual([]);
  });

  it('rejects a `data:` href (data-URL exfiltration / HTML injection vector)', async () => {
    // `data:text/html,<script>...</script>` opens a page on the
    // `data:` origin with full DOM access — also dangerous.
    const { mountViewer } = await import('../viewer');
    await mountViewer(
      host,
      '[click me](data:text/html,<script>alert(1)</script>)',
    );

    expect(
      dangerousAnchors(host).map((a) => a.getAttribute('href')),
      'expected `data:` href to be rejected (Issue #90 critical fix #1 — data URLs can carry executable HTML/scripts).',
    ).toEqual([]);
  });

  it('rejects a `vbscript:` href (legacy IE/Edge vector)', async () => {
    // VBScript only fires on legacy IE/Edge, but the sanitizer's
    // allowlist must be exhaustive — never trust the user agent
    // to refuse the scheme.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](vbscript:msgbox(1))');

    expect(
      dangerousAnchors(host).map((a) => a.getAttribute('href')),
      'expected `vbscript:` href to be rejected (Issue #90 critical fix #1).',
    ).toEqual([]);
  });

  it('rejects a `javascript:` src in a markdown image (`![alt](javascript:...)`)', async () => {
    // Image `src` is also a JS-execution vector — `<img src="javascript:...">`
    // historically fires `javascript:` on legacy browsers, and even
    // modern engines parse the scheme. Pin the same contract for
    // images.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '![x](javascript:alert(1))');

    expect(
      dangerousImages(host).map((img) => img.getAttribute('src')),
      'expected NO `<img>` with a `javascript:` src after mount (Issue #90 critical fix #1).',
    ).toEqual([]);
  });

  it('rejects a `data:` image src that contains text/html (XSS vector through SVG)', async () => {
    // `data:image/svg+xml,<svg ...><script>...</script>...` is a
    // documented XSS vector — Chrome blocks scripts in svg-as-img
    // contexts but other browsers and some embeds don't. Reject
    // all `data:` schemes uniformly rather than relying on the
    // image MIME parse. (Distinct browsers have distinct
    // behaviors; uniform rejection is the only safe default.)
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '![x](data:text/html,foo)');

    expect(
      dangerousImages(host).map((img) => img.getAttribute('src')),
      'expected `<img src="data:...">` to be rejected (Issue #90 critical fix #1).',
    ).toEqual([]);
  });

  it('preserves an `https://` href (allowlisted scheme)', async () => {
    // Defensive negative test: the sanitizer must not over-strip
    // legitimate links. A `[GitHub](https://github.com)` link
    // must survive intact so the viewer is still useful.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[GitHub](https://github.com)');

    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const githubLink = links.find(
      (a) => a.getAttribute('href') === 'https://github.com',
    );
    expect(
      githubLink,
      'expected an `<a href="https://github.com">` link to be preserved (Issue #90 critical fix #1 — sanitizer must not over-strip allowlisted schemes; otherwise legitimate links break).',
    ).toBeDefined();
  });

  it('preserves a relative anchor href (`#section`) — same-doc navigation', async () => {
    // Relative URLs (no scheme) are always safe. Pin this so the
    // sanitizer's "scheme detection" doesn't mis-classify a
    // relative URL as scheme-bearing.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[Jump](#section)');

    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const jump = links.find((a) => a.getAttribute('href') === '#section');
    expect(
      jump,
      'expected `<a href="#section">` (relative anchor) to be preserved (Issue #90 critical fix #1 — relative URLs are always safe).',
    ).toBeDefined();
  });

  it('preserves an `https://` image src (allowlisted scheme)', async () => {
    // Companion to the link-preservation test, for image src.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '![alt](https://example.com/img.png)');

    const imgs = Array.from(host.querySelectorAll<HTMLImageElement>('img[src]'));
    const safeImg = imgs.find(
      (img) => img.getAttribute('src') === 'https://example.com/img.png',
    );
    expect(
      safeImg,
      'expected `<img src="https://...">` to be preserved (Issue #90 critical fix #1).',
    ).toBeDefined();
  });
});
