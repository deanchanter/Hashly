import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #90 / Critical fix #7 — Carry the `#hashly` wordmark into
// `renderLanding` and `renderViewerHeader`.
//
// `index.html` ships a static `<header class="hashly-titlebar">`
// containing the v0.2 wordmark markup
// (`.hashly-wordmark` > `.hashly-wordmark__hash` + `.hashly-wordmark__name`).
// In Tauri mode that titlebar is the visible brand surface above the
// editor.
//
// In web mode (post-fix-#3 bootstrap), the bootstrap renders a
// `.viewer-header` strip below the static titlebar. Without giving
// `renderViewerHeader` and `renderLanding` their own wordmark, the
// web user EITHER sees two stacked headers (titlebar + viewer-header,
// only one branded) OR — if the bootstrap strips the static titlebar
// for web mode — no wordmark at all on landing / viewer surfaces.
//
// Decision (per team-lead's brief): each web-mode surface owns its
// own wordmark. The bootstrap strips / hides the static titlebar in
// web mode (a separate concern, not pinned by this file). What this
// file pins is that:
//
//   1. `renderLanding(host)` produces a `.hashly-wordmark` element
//      with the same v0.2 sub-structure (`.hashly-wordmark__hash` +
//      `.hashly-wordmark__name`).
//   2. `renderViewerHeader(host, info)` does the same.
//
// We pin the SUB-CLASSES not just `.hashly-wordmark` because the
// gold `#` and ink `hashly` are styled separately via those hooks —
// using just `.hashly-wordmark` without the children would render
// without the gold accent and break the brand.

describe('Issue #90 / Critical fix #7 — wordmark carry-over into landing + viewer-header', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('`renderLanding(host)` emits a `.hashly-wordmark` element inside the host', async () => {
    const { renderLanding } = await import('../landing');
    renderLanding(host);

    const wordmark = host.querySelector('.hashly-wordmark');
    expect(
      wordmark,
      'expected a `.hashly-wordmark` element rendered into the landing host (Issue #90 fix #7 — landing surface must carry the brand wordmark since the bootstrap strips the static titlebar in web mode).',
    ).not.toBeNull();
  });

  it('`renderLanding(host)` carries the v0.2 wordmark sub-structure (`__hash` + `__name`)', async () => {
    // The hash and name are styled separately (gold # + ink "hashly").
    // Without both child classes the brand is wrong.
    const { renderLanding } = await import('../landing');
    renderLanding(host);

    const hash = host.querySelector('.hashly-wordmark__hash');
    const name = host.querySelector('.hashly-wordmark__name');
    expect(
      hash,
      'expected `.hashly-wordmark__hash` inside the landing wordmark (Issue #90 fix #7 — gold # is styled via this hook).',
    ).not.toBeNull();
    expect(
      name,
      'expected `.hashly-wordmark__name` inside the landing wordmark (Issue #90 fix #7 — ink "hashly" is styled via this hook).',
    ).not.toBeNull();
    // Sanity: the hash slot should literally contain the `#` character
    // (matches the v0.2 `index.html` markup) so screen readers reading
    // the textContent get the brand string back.
    expect((hash?.textContent ?? '').trim()).toBe('#');
    expect((name?.textContent ?? '').toLowerCase().trim()).toBe('hashly');
  });

  it('`renderViewerHeader(host, info)` emits a `.hashly-wordmark` element inside the host', async () => {
    const { renderViewerHeader } = await import('../viewer-header');
    renderViewerHeader(host, {
      repo: 'deanchanter/Hashly',
      path: 'README.md',
      ref: 'main',
    });

    const wordmark = host.querySelector('.hashly-wordmark');
    expect(
      wordmark,
      'expected a `.hashly-wordmark` element rendered into the viewer-header host (Issue #90 fix #7 — viewer-header must carry the brand wordmark since the bootstrap strips the static titlebar in web mode).',
    ).not.toBeNull();
  });

  it('`renderViewerHeader(host, info)` carries the v0.2 wordmark sub-structure (`__hash` + `__name`)', async () => {
    const { renderViewerHeader } = await import('../viewer-header');
    renderViewerHeader(host, {
      repo: 'deanchanter/Hashly',
      path: 'README.md',
      ref: 'main',
    });

    const hash = host.querySelector('.hashly-wordmark__hash');
    const name = host.querySelector('.hashly-wordmark__name');
    expect(hash, 'expected `.hashly-wordmark__hash` inside the viewer-header wordmark.').not.toBeNull();
    expect(name, 'expected `.hashly-wordmark__name` inside the viewer-header wordmark.').not.toBeNull();
    expect((hash?.textContent ?? '').trim()).toBe('#');
    expect((name?.textContent ?? '').toLowerCase().trim()).toBe('hashly');
  });
});

// Companion: the static `<header class="hashly-titlebar">` from
// `index.html` must NOT be visible in web mode after the bootstrap
// runs (otherwise the user sees two stacked headers — the static
// titlebar + the viewer-header — both carrying the wordmark).
//
// We assert this via the web-bootstrap path: simulate a successful
// fetch + mount, then check that after settle, no descendant of the
// static `.hashly-titlebar` remains visible (either the element is
// removed or `display: none` / a `hidden` attribute is set).
//
// The check is deliberately lenient — builder picks the mechanism
// (remove the element, hide via CSS, hide via attribute). What's
// pinned: the static titlebar isn't visibly stacked above the
// viewer-header in web mode.

describe('Issue #90 / Critical fix #7 — static titlebar removed/hidden in web mode (no duplicate wordmarks)', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML =
      '<header class="hashly-titlebar"><span class="hashly-wordmark" aria-label="hashly"><span class="hashly-wordmark__hash" aria-hidden="true">#</span><span class="hashly-wordmark__name">hashly</span></span></header><header id="viewer-header"></header><div id="editor"></div>';
    document.title = 'Hashly';
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=README.md&ref=main');

    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn().mockResolvedValueOnce(new Response('# Hello', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.doMock('@tauri-apps/api/event', () => ({
      listen: vi.fn(async () => () => {}),
    }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: vi.fn(async () => null),
      save: vi.fn(async () => null),
    }));
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async () => ''),
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.doUnmock('@tauri-apps/api/event');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/core');
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('after web-mode bootstrap, the static `.hashly-titlebar` is NOT visible (avoids duplicate wordmark with viewer-header)', async () => {
    const { bootstrap } = await import('../main');
    bootstrap();
    // Settle — same window as web-bootstrap.test.ts.
    await new Promise((r) => setTimeout(r, 150));

    const titlebar = document.querySelector<HTMLElement>('.hashly-titlebar');
    // Acceptable outcomes for "not visible":
    //   (a) the element was removed from the DOM entirely, OR
    //   (b) it has `display: none` (inline style), OR
    //   (c) it has the `hidden` attribute, OR
    //   (d) it has `visibility: hidden`.
    // Builder picks the mechanism — what we pin is the OUTCOME.
    if (titlebar !== null) {
      const style = titlebar.style;
      const isHidden =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        titlebar.hasAttribute('hidden');
      expect(
        isHidden,
        `expected the static \`.hashly-titlebar\` to be hidden or removed in web mode. Without this, the user sees TWO stacked branded headers (static titlebar + .viewer-header). Found a visible titlebar with style.display=${JSON.stringify(style.display)}, visibility=${JSON.stringify(style.visibility)}, hidden=${titlebar.hasAttribute('hidden')}.`,
      ).toBe(true);
    }
    // If titlebar === null the element was removed → also acceptable.
  });
});
