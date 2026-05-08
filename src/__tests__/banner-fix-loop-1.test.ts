import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Issue #158 fix-loop iter-1 — UX critical findings.
//
// 7 criticals from the UX review (read full report in
// `~/.claude/teams/ship-158/inboxes/team-lead.json`):
//
//   #1 Banner ships zero CSS (no contrast, no 44×44 touch
//      targets, no per-kind layout). New consumers (loading
//      banner, redirecting banner) get NO visual treatment
//      because legacy save-* classes were preserved by accident.
//   #2 Esc does not dismiss a dismissible banner.
//   #3 Viewer error surface (`src/viewer-error.ts`) hand-rolls
//      its own div instead of using showBanner. AC 4.8 mandates
//      the centralized primitive.
//   #4 View-only-lock + auth-cancelled + post-auth-prompt all
//      bypass the primitive (none dismissible).
//   #5 "Redirecting…" banner fires `location.assign` in the same
//      tick — SR users hear nothing, sighted users see a flash.
//      Defer navigation to next macrotask so the live region
//      gets a chance to announce.
//   #6 Banner dismiss glyph `×` is identical to the error-kind
//      icon glyph `×`. Visually + SR-ambiguously the same.
//   #7 Conflict-banner "Copy your edit" succeeds silently —
//      the user never knows their work was saved to clipboard.

// ───────────────────────────────────────────────────────────────
// Critical #1 — Banner CSS module exists with per-kind rules and
// 44×44 dismiss touch target. We read the file directly because
// jsdom doesn't compute styles from imported CSS.
// ───────────────────────────────────────────────────────────────

describe('Issue #158 fix-loop iter-1 / critical #1 — banner CSS module', () => {
  const candidates = [
    'src/ui/banner.css',
    'src/ui/banner.module.css',
  ];

  function loadCss(): { path: string; content: string } | null {
    for (const rel of candidates) {
      const p = resolve(process.cwd(), rel);
      if (existsSync(p)) return { path: rel, content: readFileSync(p, 'utf-8') };
    }
    return null;
  }

  it('a banner CSS module exists at src/ui/banner.css (or .module.css)', () => {
    const css = loadCss();
    expect(
      css,
      `expected a CSS module at one of: ${candidates.join(', ')} (#1 — banner primitive must ship its own styling, not depend on legacy save-* classes).`,
    ).not.toBeNull();
  });

  it('the CSS module is imported by src/ui/banner.ts so consumers get styling automatically', () => {
    const banner = readFileSync(resolve(process.cwd(), 'src/ui/banner.ts'), 'utf-8');
    const importsCss =
      /import\s+['"]\.\/banner(\.module)?\.css['"]/.test(banner) ||
      /import\s+\w+\s+from\s+['"]\.\/banner(\.module)?\.css['"]/.test(banner);
    expect(
      importsCss,
      `expected src/ui/banner.ts to import its CSS module (#1 — without the import, consumers like the loading and redirecting banners get NO visual styling).`,
    ).toBe(true);
  });

  it('the CSS module has per-kind rules targeting [data-banner-kind="<kind>"] for each of the 5 kinds', () => {
    const css = loadCss();
    expect(css, 'precondition: CSS module must exist').not.toBeNull();
    const c = css!.content;
    const kinds = ['info', 'success', 'warning', 'error', 'conflict'] as const;
    for (const kind of kinds) {
      const re = new RegExp(`\\[data-banner-kind\\s*=\\s*['"]?${kind}['"]?\\]`);
      expect(
        re.test(c),
        `expected CSS rule targeting [data-banner-kind="${kind}"] for visual kind distinction (#1 — without per-kind styling, error and info banners look identical).`,
      ).toBe(true);
    }
  });

  it('the dismiss button has min-width AND min-height ≥ 44px (WCAG 2.5.5 touch target) — pinned via inline style on the element', () => {
    // jsdom can't compute imported CSS; we pin the rule by
    // requiring inline `style.minWidth` / `style.minHeight` on
    // the dismiss button to be a value ≥ 44px. The builder is
    // free to set this inline OR via CSS — but the CSS path
    // needs to put the rule in a place the test can verify.
    // Simplest: set inline-style as belt-and-suspenders.
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Re-import to ensure fresh module state.
    return import('../ui/banner').then(({ showBanner }) => {
      const handle = showBanner(host, {
        kind: 'error',
        message: 'm',
        dismissible: true,
      });
      const dismiss = handle.element.querySelector<HTMLButtonElement>(
        '[data-testid="banner-dismiss"]',
      );
      expect(dismiss, 'precondition: dismiss control must exist').not.toBeNull();

      function pxValue(s: string): number {
        const m = /^(\d+(?:\.\d+)?)(px|rem|em)?$/.exec(s.trim());
        if (!m) return NaN;
        const n = Number(m[1]);
        const unit = m[2] ?? 'px';
        if (unit === 'rem' || unit === 'em') return n * 16;
        return n;
      }

      const minW = pxValue(dismiss!.style.minWidth);
      const minH = pxValue(dismiss!.style.minHeight);
      expect(
        minW >= 44,
        `expected dismiss button style.minWidth ≥ 44px (WCAG 2.5.5 touch target). Got: ${JSON.stringify(dismiss!.style.minWidth)}.`,
      ).toBe(true);
      expect(
        minH >= 44,
        `expected dismiss button style.minHeight ≥ 44px (WCAG 2.5.5 touch target). Got: ${JSON.stringify(dismiss!.style.minHeight)}.`,
      ).toBe(true);
    });
  });
});

// ───────────────────────────────────────────────────────────────
// Critical #2 — Esc dismisses a dismissible banner.
// ───────────────────────────────────────────────────────────────

describe('Issue #158 fix-loop iter-1 / critical #2 — Esc dismisses dismissible banner', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('pressing Escape on a dismissible banner removes it from the DOM', async () => {
    const { showBanner } = await import('../ui/banner');
    const handle = showBanner(host, { kind: 'error', message: 'm', dismissible: true });
    expect(handle.element.isConnected).toBe(true);

    // Dispatch Escape on the banner element. Tests with bubbling
    // so handler can be on banner OR document.
    const ev = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    handle.element.dispatchEvent(ev);

    expect(
      handle.element.isConnected,
      'expected the banner to be removed after Escape keypress (#2 — keyboard users need an Esc-to-dismiss path; tabbing past message+action+dismiss is unacceptable).',
    ).toBe(false);
  });

  it('Escape on a NON-dismissible banner does NOT remove it', async () => {
    const { showBanner } = await import('../ui/banner');
    const handle = showBanner(host, { kind: 'info', message: 'm' });
    const ev = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    handle.element.dispatchEvent(ev);
    expect(
      handle.element.isConnected,
      'Escape must be a no-op for non-dismissible banners (the loading banner, redirecting banner) — they own their own lifecycle.',
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Critical #3 — Viewer error surface uses showBanner primitive.
// ───────────────────────────────────────────────────────────────

describe('Issue #158 fix-loop iter-1 / critical #3 — viewer error uses banner primitive', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('renderViewerError renders a banner with [data-banner-kind="error"] (primitive marker)', async () => {
    const { renderViewerError } = await import('../viewer-error');
    renderViewerError(host, { ok: false, kind: 'not-found' });

    const banner = host.querySelector('[data-banner-kind="error"]');
    expect(
      banner,
      `expected the viewer-error surface to be built on showBanner — element with [data-banner-kind="error"] must be present (#3 — AC 4.8 mandates centralized primitive; today viewer-error.ts hand-rolls its own div).`,
    ).not.toBeNull();
  });

  it('renderViewerError surface includes a [data-testid="banner-icon"] (primitive renders this)', async () => {
    const { renderViewerError } = await import('../viewer-error');
    renderViewerError(host, { ok: false, kind: 'not-found' });
    expect(
      host.querySelector('[data-testid="banner-icon"]'),
      `expected the primitive's banner-icon span (#3 — proves viewer-error went through showBanner, not hand-rolled).`,
    ).not.toBeNull();
  });

  it('renderViewerError surface includes a dismiss control (banner is dismissible)', async () => {
    const { renderViewerError } = await import('../viewer-error');
    renderViewerError(host, { ok: false, kind: 'not-found' });
    expect(
      host.querySelector('[data-testid="banner-dismiss"]'),
      `expected the viewer-error banner to be dismissible (#3 — primitive's dismiss control; user who recovers mid-flight can clear the alert without using Retry/Back).`,
    ).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────
// Critical #4 — JIT-auth surfaces (view-only-lock, auth-cancelled,
// post-auth-prompt) use the banner primitive.
// ───────────────────────────────────────────────────────────────

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

function installFakeLocation(
  assignImpl: (url: string) => void = () => {},
): { restore: () => void; original: Location } {
  const original = window.location;
  let _href = original.href;
  const fake: FakeLocation = {
    get href() { return _href; },
    // eslint-disable-next-line accessor-pairs
    set href(v: string) { _href = v; },
    origin: original.origin,
    protocol: original.protocol,
    host: original.host,
    hostname: original.hostname,
    port: original.port,
    pathname: original.pathname,
    search: original.search,
    hash: original.hash,
    assign: assignImpl,
    replace: () => {},
    reload: () => {},
    toString() { return _href; },
  } as unknown as FakeLocation;
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: fake,
  });
  return {
    original,
    restore() {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}

describe('Issue #158 fix-loop iter-1 / critical #4 — JIT surfaces use primitive', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let locRestore: () => void;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=specs/spec.md&ref=main');
    ({ restore: locRestore } = installFakeLocation());
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n\nbody\n');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    locRestore();
  });

  it('view-only lock surface is built on the banner primitive (has banner-icon + banner-dismiss)', async () => {
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (u.includes('/api/session-status')) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      if (u.includes('/api/github/repos/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ permissions: { push: false } }), {
            status: 200, headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const { attemptEditAction } = await import('../edit-mode');
    await attemptEditAction(host);

    const lock = host.querySelector<HTMLElement>('[data-testid="view-only-lock"]');
    expect(lock, 'precondition: lock must render').not.toBeNull();
    expect(
      lock!.querySelector('[data-testid="banner-icon"]'),
      `expected view-only-lock to be built on showBanner (banner-icon present) (#4 — AC 4.1 mandates primitive everywhere).`,
    ).not.toBeNull();
    expect(
      lock!.querySelector('[data-testid="banner-dismiss"]'),
      `expected view-only-lock to be dismissible (banner-dismiss present) (#4 — currently bespoke banner has no dismiss).`,
    ).not.toBeNull();
  });

  it('auth-cancelled surface is built on the banner primitive', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
    const { attemptEditAction } = await import('../edit-mode');
    await attemptEditAction(host, { isRestore: true });

    const cancelled = host.querySelector<HTMLElement>('[data-testid="auth-cancelled"]');
    expect(cancelled, 'precondition: auth-cancelled must render').not.toBeNull();
    expect(
      cancelled!.querySelector('[data-testid="banner-icon"]'),
      `expected auth-cancelled banner to be built on showBanner (#4).`,
    ).not.toBeNull();
    expect(
      cancelled!.querySelector('[data-testid="banner-dismiss"]'),
      `expected auth-cancelled banner to be dismissible (#4 — currently has no dismiss; sits forever).`,
    ).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────
// Critical #5 — "Redirecting…" banner has live-region announcement
// window: location.assign is deferred (rAF / setTimeout) so the
// live region is in DOM for at least one tick before navigation.
// ───────────────────────────────────────────────────────────────

describe('Issue #158 fix-loop iter-1 / critical #5 — redirecting banner SR window', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let locRestore: () => void;
  // Track the order of: banner mount and location.assign invocation.
  // The contract: assign is deferred (microtask/macrotask) so the
  // live region exists in the DOM for ≥ 1 tick before navigation.
  let assignTimestamp: number;
  let bannerMountTimestamp: number;
  // Monitor the DOM for the appearance of the redirect banner.
  let mutObserver: MutationObserver | null = null;

  beforeEach(async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=specs/spec.md&ref=main');

    assignTimestamp = -1;
    bannerMountTimestamp = -1;
    ({ restore: locRestore } = installFakeLocation((_url: string) => {
      void _url;
      assignTimestamp = performance.now();
    }));

    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n\nbody\n');

    mutObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          const text = (node.textContent ?? '').toLowerCase();
          if (text.includes('redirect') || text.includes('signing in') || text.includes('taking you')) {
            if (bannerMountTimestamp < 0) {
              bannerMountTimestamp = performance.now();
            }
          }
        }
      }
    });
    mutObserver.observe(document.body, { childList: true, subtree: true });
  });

  afterEach(() => {
    mutObserver?.disconnect();
    globalThis.fetch = originalFetch;
    locRestore();
  });

  it('redirecting banner is mounted in DOM for at least one macrotask BEFORE location.assign fires', async () => {
    // Fix-loop critical #5: today the banner is created and
    // location.assign fires in the SAME synchronous tick — SR
    // live-region announcements require the region to exist
    // before the content is set, AND the page is navigating
    // away. A microtask gap (or rAF / setTimeout 0) gives AT
    // a chance to register and announce.
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
    const { attemptEditAction } = await import('../edit-mode');

    const before = performance.now();
    await attemptEditAction(host);
    // attemptEditAction returns when the work is done; if
    // assign was deferred via setTimeout / rAF, we need to
    // give the timer a chance to fire.
    await new Promise((r) => setTimeout(r, 60));

    expect(
      bannerMountTimestamp,
      'precondition: banner must have mounted',
    ).toBeGreaterThan(0);
    expect(
      assignTimestamp,
      'precondition: location.assign must have fired',
    ).toBeGreaterThan(0);

    const gapMs = assignTimestamp - bannerMountTimestamp;
    void before;
    expect(
      gapMs > 0,
      `expected location.assign to fire AFTER the banner mount (#5 — same-tick mount+navigate gives SR no announcement window). bannerMount=${bannerMountTimestamp.toFixed(2)}, assign=${assignTimestamp.toFixed(2)}, gap=${gapMs.toFixed(2)}ms. Suggested fix: wrap window.location.assign(...) in setTimeout(..., 0) or requestAnimationFrame.`,
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Critical #6 — Dismiss glyph distinct from error-kind glyph.
// ───────────────────────────────────────────────────────────────

describe('Issue #158 fix-loop iter-1 / critical #6 — dismiss glyph distinct from error icon', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('error-kind banner: dismiss button textContent differs from kind-icon textContent', async () => {
    // Fix-loop critical #6: today both glyphs are `×`. SR users
    // hear "× Dismiss" but the visible glyph is identical.
    // Fix: change either the kind-icon glyph or the dismiss
    // glyph to a distinct character, OR drop the visible glyph
    // on the dismiss button (use only an aria-label + an
    // sr-only span / icon-as-mask).
    const { showBanner } = await import('../ui/banner');
    const handle = showBanner(host, {
      kind: 'error',
      message: 'm',
      dismissible: true,
    });
    const icon = handle.element.querySelector<HTMLElement>('[data-testid="banner-icon"]');
    const dismiss = handle.element.querySelector<HTMLElement>('[data-testid="banner-dismiss"]');
    expect(icon, 'precondition: icon').not.toBeNull();
    expect(dismiss, 'precondition: dismiss').not.toBeNull();

    const iconText = (icon!.textContent ?? '').trim();
    const dismissVisibleText = (dismiss!.textContent ?? '').trim();
    expect(
      iconText !== dismissVisibleText || dismissVisibleText.length === 0,
      `expected error-kind icon glyph to be visually distinct from the dismiss button glyph (#6 — today both are "×"; visually ambiguous). icon=${JSON.stringify(iconText)}, dismiss=${JSON.stringify(dismissVisibleText)}.`,
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Critical #7 — Conflict banner copy provides SR/visual feedback.
// ───────────────────────────────────────────────────────────────

describe('Issue #158 fix-loop iter-1 / critical #7 — conflict copy feedback', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    });
  });

  it('clicking "Copy your edit" on the conflict banner produces visible "Copied" feedback', async () => {
    // Fix-loop critical #7: the conflict banner is the ONLY
    // recovery path for stale-SHA conflicts. The user must
    // know the copy succeeded — silence forces them to
    // alt-test the clipboard or re-click defensively.
    const { renderSaveConflict } = await import('../save-result');
    renderSaveConflict(host, { getContent: () => 'edited content' });

    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'));
    const copyBtn = buttons.find((b) =>
      (b.textContent ?? '').toLowerCase().includes('copy'),
    );
    expect(copyBtn, 'precondition: copy button must exist').toBeDefined();

    copyBtn!.click();
    await new Promise((r) => setTimeout(r, 20));

    const text = (host.textContent ?? '').toLowerCase();
    expect(
      text.includes('copied'),
      `expected the conflict banner to show "Copied" feedback after the copy click (#7 — conflict is the only recovery path; silent copy is unacceptable). Banner text: ${JSON.stringify(host.textContent)}.`,
    ).toBe(true);
  });
});
