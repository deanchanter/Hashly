import { describe, it, expect, beforeEach } from 'vitest';

// Issue #157 / AC 3.2 + 3.4 — Sanitizer hardening: normalization.
//
// The v0.2 / v0.3 viewer sanitizer (`sanitizeUrlAttributes` in
// `src/viewer.ts`) does positive-allowlist scheme matching with this
// regex:
//
//   /^([a-zA-Z][a-zA-Z0-9+.-]*):/
//
// That works for naïve forms (`javascript:`, `JaVaScRiPt:`) but is
// trivially bypassed by:
//
//   1. Zero-width characters inserted between scheme letters:
//      `java​script:alert(1)` — the `​` (U+200B ZERO WIDTH
//      SPACE) is NOT in `[a-zA-Z0-9+.-]`, so the regex stops at
//      `java`, can't find the `:`, returns `match=null`, and the
//      sanitizer concludes "no scheme — relative URL — safe."
//      Browsers, by contrast, normalize the URL when the user clicks
//      the link, fire `javascript:`, and execute attacker JS on the
//      viewer's origin.
//
//   2. Percent-encoded scheme letters: `j%61vascript:alert(1)` — `%`
//      is not in the scheme charset either, same regex failure, same
//      bypass. Browsers percent-decode the URL during parsing and
//      again execute `javascript:`.
//
//   3. Mixed bypasses: `JAV%41script:`, `j​a%76ascript:` — any
//      combination of the above evades the raw-string match.
//
// The fix shape (from `openspec/changes/v0-3-2-pitch-ready/design.md`
// Decision 3): normalize the attribute value before matching.
//   • lowercase
//   • strip zero-width chars (U+200B, U+200C, U+200D, U+FEFF)
//   • percent-decode once
// Then re-check the disallowed-scheme prefix on the normalized value.
//
// These tests pin the OUTCOME (no `<a href>` survives mount with a
// scheme that normalizes to `javascript:` / `data:` / `vbscript:`)
// rather than the implementation. The builder is free to choose how
// the recovery looks (strip attribute, replace with `about:blank`,
// rewrite to `#`) so long as the dangerous scheme is gone.

const DANGEROUS_NORMALIZED_RE = /^(javascript|data|vbscript):/i;

function normalizeForAssertion(href: string): string {
  // Mirror the sanitizer's normalization so the test asserts on the
  // same shape the impl is supposed to compute. We're not testing
  // that the sanitizer's normalization is char-for-char this exact
  // function — we're testing that AFTER normalization, no anchor
  // carries a dangerous scheme. So this helper just answers the
  // question "if we were to normalize this href the way the spec
  // describes, would it look dangerous?" — and if yes, the sanitizer
  // failed.
  let v = href;
  // strip zero-width chars
  v = v.replace(/[​‌‍﻿]/g, '');
  // percent-decode once (be defensive: malformed `%` sequences
  // shouldn't crash the test)
  try {
    v = decodeURIComponent(v);
  } catch {
    /* leave as-is — malformed percent sequences are still
       suspicious if they encode a dangerous prefix anyway, but the
       sanitizer should also handle the decode failure path. */
  }
  return v.toLowerCase().trim();
}

function dangerousAnchorsAfterNormalization(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .map((a) => a.getAttribute('href') ?? '')
    .filter((h) => DANGEROUS_NORMALIZED_RE.test(normalizeForAssertion(h)));
}

function dangerousImagesAfterNormalization(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLImageElement>('img[src]'))
    .map((img) => img.getAttribute('src') ?? '')
    .filter((s) => DANGEROUS_NORMALIZED_RE.test(normalizeForAssertion(s)));
}

describe('Issue #157 / AC 3.2 + 3.4 — sanitizer normalization', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('rejects zero-width-space-injected `javascript:` (`java\\u200Bscript:`)', async () => {
    // U+200B ZERO WIDTH SPACE between scheme letters bypasses the
    // raw-string regex but browsers ignore it when firing the URL.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](java​script:alert(1))');

    expect(
      dangerousAnchorsAfterNormalization(host),
      'expected no `<a>` whose normalized href starts with `javascript:` — U+200B insertion must be stripped before scheme matching (Issue #157 AC 3.2).',
    ).toEqual([]);
  });

  it('rejects U+200C (zero-width non-joiner) injected scheme', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](java‌script:alert(1))');

    expect(
      dangerousAnchorsAfterNormalization(host),
      'expected U+200C to be stripped during normalization (Issue #157 AC 3.2 — strip ZWNJ).',
    ).toEqual([]);
  });

  it('rejects U+200D (zero-width joiner) injected scheme', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](java‍script:alert(1))');

    expect(
      dangerousAnchorsAfterNormalization(host),
      'expected U+200D to be stripped during normalization (Issue #157 AC 3.2 — strip ZWJ).',
    ).toEqual([]);
  });

  it('rejects U+FEFF (zero-width no-break space / BOM) injected scheme', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](java﻿script:alert(1))');

    expect(
      dangerousAnchorsAfterNormalization(host),
      'expected U+FEFF to be stripped during normalization (Issue #157 AC 3.2 — strip BOM).',
    ).toEqual([]);
  });

  it('rejects percent-encoded scheme letter (`j%61vascript:`)', async () => {
    // `%61` decodes to `a`. Browsers decode-and-fire; the sanitizer
    // must percent-decode once before matching.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](j%61vascript:alert(1))');

    expect(
      dangerousAnchorsAfterNormalization(host),
      'expected `j%61vascript:` to be rejected — percent-decode-once before scheme matching (Issue #157 AC 3.2 + AC 3.4).',
    ).toEqual([]);
  });

  it('rejects fully percent-encoded scheme (`%6Aavascript:`)', async () => {
    // `%6A` → `j`. Pin a second percent-encoded form so the impl
    // can't pass by special-casing one byte.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](%6Aavascript:alert(1))');

    expect(
      dangerousAnchorsAfterNormalization(host),
      'expected `%6Aavascript:` to be rejected (Issue #157 AC 3.2 — percent-decode normalization).',
    ).toEqual([]);
  });

  it('rejects mixed-case + percent-encoded combination (`J%61vAsCrIpT:`)', async () => {
    // The bypasses compose; the normalizer must apply lowercase
    // AND percent-decode AND zero-width-strip together, not in
    // isolation.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click me](J%61vAsCrIpT:alert(1))');

    expect(
      dangerousAnchorsAfterNormalization(host),
      'expected combined mixed-case + percent-encoded bypass to be rejected (Issue #157 AC 3.2).',
    ).toEqual([]);
  });

  it('rejects percent-encoded `data:` image src (`d%61ta:`)', async () => {
    // Image src is a parallel vector — pin the same normalization
    // contract for `<img>`.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '![x](d%61ta:text/html,foo)');

    expect(
      dangerousImagesAfterNormalization(host),
      'expected percent-encoded `data:` image src to be rejected (Issue #157 AC 3.2 — img path covered).',
    ).toEqual([]);
  });

  it('rejects zero-width-injected `data:` image src', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '![x](da​ta:text/html,foo)');

    expect(
      dangerousImagesAfterNormalization(host),
      'expected ZWSP-injected `data:` image src to be rejected (Issue #157 AC 3.2).',
    ).toEqual([]);
  });

  it('preserves `https://` href with no normalization side-effects', async () => {
    // Defensive negative: normalization must not over-strip
    // legitimate URLs. `https://example.com/path%20with%20spaces`
    // contains percent-encoded bytes that decode to spaces — the
    // sanitizer must NOT permanently mutate the href, only check
    // the normalized form for a disallowed scheme.
    const { mountViewer } = await import('../viewer');
    await mountViewer(
      host,
      '[link](https://example.com/path%20with%20spaces)',
    );

    const links = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    );
    const safe = links.find(
      (a) =>
        a.getAttribute('href') ===
        'https://example.com/path%20with%20spaces',
    );
    expect(
      safe,
      'expected `https://...%20...` href to be preserved verbatim — sanitizer normalization is for matching only, not for rewriting (Issue #157 AC 3.4 negative).',
    ).toBeDefined();
  });

  it('preserves a relative anchor (`#section`) under normalization', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[Jump](#section)');

    const links = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    );
    const jump = links.find((a) => a.getAttribute('href') === '#section');
    expect(
      jump,
      'expected `#section` (relative anchor) to be preserved (Issue #157 AC 3.4 — relative URLs always safe).',
    ).toBeDefined();
  });
});
