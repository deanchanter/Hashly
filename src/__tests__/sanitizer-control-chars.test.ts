import { describe, it, expect, beforeEach } from 'vitest';

// Issue #157 / Critical fix follow-up — control-char sanitizer bypass.
//
// The WHATWG URL parser strips ASCII tab (U+0009), LF (U+000A), and
// CR (U+000D) from a URL before scheme parsing. So `java\tscript:`
// in an `<a href>` parses as `javascript:` in a real browser and
// fires attacker JS on click. Our slice-A normalizer added
// zero-width strip + percent-decode-once + lowercase, but it does
// NOT strip control chars — so the regex
//
//   /^([a-z][a-z0-9+.-]*):/
//
// applied to the normalized form `java\tscript:` matches `java`
// (no tab in the scheme charset), can't find the `:`, returns
// `match=null`, and the sanitizer concludes "relative URL — safe."
// Browser disagrees, attacker wins.
//
// Same vector via percent-encoding: `j%09avascript:` percent-decodes
// to `j\tavascript:`, which after our strip set is unchanged, and
// the regex still misses. The fix has to strip `\t\n\r\0` (and
// equivalents) BOTH after percent-decode AND on the raw value, so
// composed bypasses (zero-width + percent-encoded + tab) collapse
// to the canonical `javascript:` form before scheme matching.
//
// CRITICAL TEST-DESIGN NOTES (per team-lead feedback):
//
//   1. The previous `sanitizer-normalization.test.ts` used a
//      `normalizeForAssertion` helper that mirrored the impl's
//      normalizer. Sharing the same blind spot made the tests pass
//      for the wrong reason. This file uses an INDEPENDENT
//      "browser-defensive" assertion helper that strips `\t\n\r\0`
//      + zero-width and percent-decodes — modeled on what a
//      properly-hardened browser-equivalent path would see, NOT on
//      what the impl currently does.
//
//   2. Raw control chars in markdown source don't reliably reach
//      the rendered DOM — Milkdown's markdown parser treats
//      `\t\n\r\0` as token boundaries / whitespace and either
//      strips them or rejects the link entirely. So a markdown
//      payload `[a](java\tscript:...)` mostly tests Milkdown, not
//      the sanitizer. To actually exercise the sanitizer + observer
//      with raw control chars in href, we inject anchors directly
//      into the DOM post-mount — that's the realistic threat model
//      anyway (paste, plugin output, late mutation), and it
//      exercises the same `sanitizeUrlAttributes` code path as
//      initial mount via the AC 3.3 observer.
//
//   3. Percent-encoded control chars DO survive markdown parsing
//      (the `%` character is valid in link destinations), so those
//      tests use the markdown source path and exercise the initial
//      mount sanitize.

const DANGEROUS_RE = /^\s*(javascript|data|vbscript)\s*:/i;

/**
 * Defense-in-depth normalization for ASSERTION ONLY — does not
 * mirror the impl. Strips:
 *   • ASCII tab/LF/CR/NUL (the WHATWG URL parser's pre-strip set,
 *     plus NUL because it's the same code-shape gap)
 *   • Zero-width chars (U+200B/200C/200D/FEFF)
 * then percent-decodes once and lowercases. If a surviving anchor
 * normalizes to `javascript:` / `data:` / `vbscript:` under THIS
 * helper, the impl failed regardless of what surface was missed.
 */
function browserDefensiveNormalize(href: string): string {
  let v = href;
  // Pass 1 — strip control + zero-width pre-decode.
  v = v.replace(/[\t\n\r\0​‌‍﻿]/g, '');
  // Percent-decode once. Ignore malformed sequences.
  try {
    v = decodeURIComponent(v);
  } catch {
    /* leave as-is — still suspicious if the prefix decodes
       partially. */
  }
  // Pass 2 — strip control + zero-width post-decode (catches
  // `%09`-encoded tab that resurfaces as a literal tab).
  v = v.replace(/[\t\n\r\0​‌‍﻿]/g, '');
  return v.toLowerCase().trim();
}

function dangerousAnchors(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .map((a) => a.getAttribute('href') ?? '')
    .filter((h) => DANGEROUS_RE.test(browserDefensiveNormalize(h)));
}

function dangerousImages(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLImageElement>('img[src]'))
    .map((img) => img.getAttribute('src') ?? '')
    .filter((s) => DANGEROUS_RE.test(browserDefensiveNormalize(s)));
}

async function flushObserver(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Inject a raw-href anchor into a mounted host and let the observer
 * run. Returns the surviving anchor element (or undefined if the
 * sanitizer removed/neutralized it). */
async function injectAnchor(
  host: HTMLElement,
  rawHref: string,
): Promise<void> {
  const a = document.createElement('a');
  a.setAttribute('href', rawHref);
  a.textContent = 'inject';
  host.appendChild(a);
  await flushObserver();
}

async function injectImage(
  host: HTMLElement,
  rawSrc: string,
): Promise<void> {
  const img = document.createElement('img');
  img.setAttribute('src', rawSrc);
  img.setAttribute('alt', 'inject');
  host.appendChild(img);
  await flushObserver();
}

describe('Issue #157 critical follow-up — control-char sanitizer bypasses', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('rejects raw ASCII tab in scheme (`java\\tscript:`) injected into the viewer DOM', async () => {
    // WHATWG URL parser strips ASCII tab before scheme parsing,
    // so a real browser fires this as `javascript:`. The
    // sanitizer must strip `\t` from the normalized form before
    // scheme matching.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    await injectAnchor(host, 'java\tscript:alert(1)');

    expect(
      dangerousAnchors(host),
      'expected `java\\tscript:` injected into the viewer DOM to be neutralized — observer + sanitizer must strip ASCII tab before scheme matching (Issue #157 critical follow-up).',
    ).toEqual([]);
  });

  it('rejects raw LF (U+000A) in scheme (`java\\nscript:`)', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    await injectAnchor(host, 'java\nscript:alert(1)');

    expect(
      dangerousAnchors(host),
      'expected raw LF in scheme to be rejected (WHATWG URL parser strip-set: \\t\\n\\r) — Issue #157 critical follow-up.',
    ).toEqual([]);
  });

  it('rejects raw CR (U+000D) in scheme (`java\\rscript:`)', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    await injectAnchor(host, 'java\rscript:alert(1)');

    expect(
      dangerousAnchors(host),
      'expected raw CR in scheme to be rejected — Issue #157 critical follow-up.',
    ).toEqual([]);
  });

  it('rejects raw NUL (U+0000) in scheme (`java\\0script:`) — same code-shape gap', async () => {
    // Most browsers don't actually fire NUL-injected schemes,
    // but the impl strip-set is "control characters that defeat
    // the scheme regex." NUL is in that class; closing it costs
    // nothing and prevents future browser-quirk surprises.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    await injectAnchor(host, 'java\0script:alert(1)');

    expect(
      dangerousAnchors(host),
      'expected raw NUL in scheme to be rejected — same code-shape gap as \\t\\n\\r (Issue #157 critical follow-up; defensive).',
    ).toEqual([]);
  });

  it('rejects raw tab in `<img src>` (parallel surface)', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    await injectImage(host, 'da\tta:text/html,foo');

    expect(
      dangerousImages(host),
      'expected raw tab in `<img src>` `data:` scheme to be rejected (Issue #157 critical follow-up — img parallel).',
    ).toEqual([]);
  });

  it('rejects percent-encoded tab (`j%09avascript:`) via markdown source', async () => {
    // `%09` percent-decodes to `\t`. The impl already
    // percent-decodes once; after that, the strip-set must
    // remove the resulting tab so the regex matches
    // `javascript:`. Markdown source survives parse because `%`
    // is valid in link destinations.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click](j%09avascript:alert(1))');

    expect(
      dangerousAnchors(host),
      'expected `j%09avascript:` (percent-encoded tab) to be rejected — decode-once + strip-tab must compose (Issue #157 critical follow-up).',
    ).toEqual([]);
  });

  it('rejects percent-encoded LF (`j%0Aavascript:`) via markdown source', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click](j%0Aavascript:alert(1))');

    expect(
      dangerousAnchors(host),
      'expected `j%0Aavascript:` (percent-encoded LF) to be rejected — Issue #157 critical follow-up.',
    ).toEqual([]);
  });

  it('rejects percent-encoded CR (`j%0Davascript:`) via markdown source', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click](j%0Davascript:alert(1))');

    expect(
      dangerousAnchors(host),
      'expected `j%0Davascript:` (percent-encoded CR) to be rejected — Issue #157 critical follow-up.',
    ).toEqual([]);
  });

  it('rejects percent-encoded NUL (`j%00avascript:`) via markdown source', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click](j%00avascript:alert(1))');

    expect(
      dangerousAnchors(host),
      'expected `j%00avascript:` (percent-encoded NUL) to be rejected — Issue #157 critical follow-up; defensive.',
    ).toEqual([]);
  });

  it('rejects composed bypass: zero-width + percent-encoded tab + mixed-case (`J%09A​vAsCrIpT:`)', async () => {
    // The bypasses compose. ZW char + percent-encoded tab in
    // mixed-case scheme — pin that all normalization passes
    // apply together, not just in isolation.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[click](J%09A​vAsCrIpT:alert(1))');

    expect(
      dangerousAnchors(host),
      'expected composed ZW + percent-tab + mixed-case bypass to be rejected — normalization passes must compose (Issue #157 critical follow-up).',
    ).toEqual([]);
  });

  it('rejects raw tab in href set via attribute mutation on existing anchor (observer path)', async () => {
    // Cross-pin with AC 3.3 attribute-mutation: rewrite an
    // existing safe href to a tab-injected scheme. The observer
    // must re-run the sanitizer with the extended strip-set.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[GitHub](https://github.com)');

    const link = host.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com"]',
    );
    expect(link, 'fixture: safe https anchor mounted').toBeTruthy();
    link!.setAttribute('href', 'java\tscript:alert(1)');

    await flushObserver();

    expect(
      dangerousAnchors(host),
      'expected attribute-mutation tab-injection to be neutralized by the observer with extended strip-set (Issue #157 critical follow-up + AC 3.3 attribute-mutation cross-pin).',
    ).toEqual([]);
  });

  it('preserves `https://github.com` injected post-mount (negative — strip-set must not over-fire)', async () => {
    // Defensive negative: extending the strip-set must not
    // collateral-damage legitimate URLs. A clean `https://`
    // anchor injected post-mount survives intact.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    await injectAnchor(host, 'https://github.com');

    const survivor = host.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com"]',
    );
    expect(
      survivor,
      'expected clean `https://github.com` to survive post-mount injection — strip-set extension must not over-fire (Issue #157 critical follow-up; negative).',
    ).toBeTruthy();
  });
});
