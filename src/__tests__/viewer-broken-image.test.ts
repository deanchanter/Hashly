import { describe, it, expect, beforeEach } from 'vitest';

// Issue #90 / Critical fix #5 — broken-image fallback in `mountViewer`.
//
// `mountEditor` (v0.2) calls `installBrokenImageFallback(host)` after
// the Milkdown mount so any `<img>` whose `error` event fires is
// replaced with `<span class="hashly-broken-image">{alt}</span>` —
// the OS "?" glyph never appears, the alt text becomes the visible
// fallback, and assistive tech still announces the image. The same
// surface is missing from the AC 4.4 `mountViewer` (extraction
// dropped the fallback hook).
//
// Reviewer flagged: viewer with broken image → OS "?" glyph instead
// of alt-text fallback. Pin the same contract for mountViewer.
//
// We re-pin AC1 + AC2 + AC6 (empty-alt decorative idiom) here. The
// other v0.2 ACs (a11y role/aria-label, contenteditable=false on
// the fallback, observer-leak disconnect, mixed-paragraph cleanup)
// are tested against `mountEditor` already; if the builder reuses
// the same `installBrokenImageFallback` (recommended), those
// invariants come along for free. The minimum to close the
// reviewer's finding is the visible-fallback + img-removal pair.

describe('Issue #90 / Critical fix #5 — broken-image fallback in mountViewer', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('AC1 (carry-over): an <img> that errors is replaced with a `.hashly-broken-image` span carrying the alt text', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '![rocket diagram](/__broken__.png)');

    const img = host.querySelector<HTMLImageElement>('.ProseMirror img');
    expect(
      img,
      'precondition: Milkdown must render `![alt](src)` as an <img> inside .ProseMirror in viewer mode.',
    ).not.toBeNull();
    expect(
      img!.getAttribute('alt'),
      'precondition: the rendered <img> must carry the alt attribute from the markdown source.',
    ).toBe('rocket diagram');

    img!.dispatchEvent(new Event('error', { cancelable: false }));
    // Allow the broken-image hook's microtask + MutationObserver
    // callback to settle before assertions (same shape as the v0.2
    // broken-image tests).
    await Promise.resolve();
    await Promise.resolve();

    const fallback = host.querySelector('.hashly-broken-image');
    expect(
      fallback,
      'expected a `.hashly-broken-image` element after the <img> errored — without this, the OS "?" glyph is what the spec reader sees (Issue #90 critical fix #5 — same fallback contract as v0.2 mountEditor / issue #78 slice 1).',
    ).not.toBeNull();
    expect(
      fallback!.textContent ?? '',
      'expected the fallback span to contain the alt text "rocket diagram".',
    ).toContain('rocket diagram');
  });

  it('AC2 (carry-over): the original broken <img> is removed from .ProseMirror so the OS "?" glyph cannot appear', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '![rocket diagram](/__broken__.png)');

    const img = host.querySelector<HTMLImageElement>(
      '.ProseMirror img[src*="__broken__"]',
    );
    expect(
      img,
      'precondition: Milkdown rendered an <img> with the broken src.',
    ).not.toBeNull();

    img!.dispatchEvent(new Event('error', { cancelable: false }));
    await Promise.resolve();
    await Promise.resolve();

    const lingering = host.querySelector(
      '.ProseMirror img[src*="__broken__"]',
    );
    expect(
      lingering,
      'expected NO content <img> with the broken src to remain inside .ProseMirror after the error event (Issue #90 fix #5 — the broken-image hook must REMOVE the <img>, not just style it; otherwise the OS glyph still appears).',
    ).toBeNull();
  });

  it('AC6 (carry-over): empty-alt `![](src)` decorative-image idiom does NOT render a fallback pill', async () => {
    // Empty alt = decorative image per the markdown convention.
    // The fallback pill would surface a visible bordered rectangle
    // with no text — worse than the OS glyph because it draws the
    // user's eye to a meaningless surface. Pin the v0.2 contract:
    // empty alt → image is removed, no pill is rendered.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '![](/__broken__.png)');

    const img = host.querySelector<HTMLImageElement>(
      '.ProseMirror img[src*="__broken__"]',
    );
    expect(
      img,
      'precondition: Milkdown rendered the empty-alt image as an <img>.',
    ).not.toBeNull();

    img!.dispatchEvent(new Event('error', { cancelable: false }));
    await Promise.resolve();
    await Promise.resolve();

    const fallbackSpan = host.querySelector('.hashly-broken-image');
    expect(
      fallbackSpan,
      'expected NO `.hashly-broken-image` element when the alt is empty — empty alt is the markdown decorative-image idiom, the fallback should be silent (Issue #90 fix #5 / matches v0.2 issue #78 slice 1 AC6).',
    ).toBeNull();

    const lingering = host.querySelector(
      '.ProseMirror img[src*="__broken__"]',
    );
    expect(
      lingering,
      'expected the broken <img> with empty alt to be removed entirely (no pill, no glyph — the image disappears).',
    ).toBeNull();
  });
});
