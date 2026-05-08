import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #158 / AC 4.3, 4.4, 4.5 — Save flow refactored on the
// banner primitive + in-flight guard for Cmd+S.
//
// Pinned NEW behavior beyond the existing AC 6.x save-flow contract:
//
//   1. **Dismissible banners** — every save outcome banner is
//      dismissible (banner-dismiss control rendered).
//   2. **Dismiss returns focus to editor** — clicking dismiss
//      restores focus to the live `.ProseMirror` (or the editor
//      host) so keyboard / SR users stay in editing context.
//   3. **Cmd+S triggers save** — pressing Cmd+S (Ctrl+S on
//      non-Mac) inside the editor host POSTs to `/api/save`.
//   4. **Cmd+S in-flight guard** — while a save is pending,
//      additional Cmd+S presses are dropped (no second POST).
//      Combined with the existing AC 6.1 button-click lock,
//      this means rapid Cmd+S → exactly one POST.
//   5. **Success "copy details" affordance (#119)** — the
//      success banner has a button to copy details (PR URL or
//      similar) to the clipboard, with success feedback after
//      the click.
//
// Implementation freedom: the builder can either keep the
// `data-testid="save-success"|"save-error"|"save-conflict"`
// outer wrappers (rendered via `showBanner`) or migrate to
// banner-only pins. These tests query by ROLE + CONTENT so the
// pins survive either path.

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

function installFakeLocation(): { restore: () => void; original: Location } {
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
    assign: () => {},
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

async function mountAndEnter(host: HTMLElement): Promise<HTMLButtonElement> {
  const { mountViewer } = await import('../viewer');
  await mountViewer(host, '# Spec\n\nbody\n');
  const { enterEditMode } = (await import('../edit-mode')) as unknown as {
    enterEditMode: (h: HTMLElement, opts?: { baseSha?: string }) => Promise<void>;
  };
  await enterEditMode(host, { baseSha: 'BASE_SHA_xyz' });
  const btn = document.querySelector<HTMLButtonElement>(
    `[data-testid="${SAVE_BTN_TESTID}"]`,
  );
  if (!btn) throw new Error('precondition: save button must exist');
  return btn;
}

function findBannerByContent(
  root: ParentNode,
  fragment: string,
): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'),
  );
  return (
    candidates.find((el) =>
      (el.textContent ?? '').toLowerCase().includes(fragment.toLowerCase()),
    ) ?? null
  );
}

describe('Issue #158 / AC 4.3 — save outcomes render banners with correct ARIA + dismiss', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let locRestore: () => void;

  beforeEach(() => {
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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    locRestore();
  });

  it('success outcome renders a role="status" banner that is dismissible', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const btn = await mountAndEnter(host);
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const statusBanner = host.querySelector<HTMLElement>('[role="status"]');
    expect(
      statusBanner,
      'expected a role="status" banner after a successful save (AC 4.3 — banner-primitive ARIA contract)',
    ).not.toBeNull();
    const dismiss = statusBanner!.querySelector<HTMLButtonElement>(
      '[data-testid="banner-dismiss"]',
    );
    expect(
      dismiss,
      'expected the success banner to be dismissible (AC 4.3 — every save banner uses banner primitive with dismissible:true)',
    ).not.toBeNull();
  });

  it('conflict outcome renders a role="alert" banner that is dismissible', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'conflict',
          message: 'your edit and an upstream change overlap; please reload',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );
    const btn = await mountAndEnter(host);
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const alertBanner = findBannerByContent(host, 'overlap');
    expect(alertBanner, 'expected the conflict banner').not.toBeNull();
    expect(
      alertBanner!.getAttribute('role'),
      'conflict → role="alert"',
    ).toBe('alert');
    expect(
      alertBanner!.querySelector('[data-testid="banner-dismiss"]'),
      'conflict banner must be dismissible',
    ).not.toBeNull();
  });

  it('no-write outcome renders a role="alert" banner that is dismissible', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'no-write',
          message: "You don't have write access — ask the dev to add you.",
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    const btn = await mountAndEnter(host);
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const banner = findBannerByContent(host, "don't have write");
    expect(banner, 'expected the no-write error banner').not.toBeNull();
    expect(banner!.getAttribute('role'), 'no-write → role="alert"').toBe('alert');
    expect(
      banner!.querySelector('[data-testid="banner-dismiss"]'),
      'no-write banner must be dismissible',
    ).not.toBeNull();
  });

  it('network outcome renders a role="alert" banner that is dismissible', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    const btn = await mountAndEnter(host);
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const banner = host.querySelector<HTMLElement>('[role="alert"]');
    expect(banner, 'expected a role="alert" banner on network failure').not.toBeNull();
    expect(
      banner!.querySelector('[data-testid="banner-dismiss"]'),
      'network banner must be dismissible',
    ).not.toBeNull();
  });
});

describe('Issue #158 / AC 4.5 — banner dismiss returns focus to editor', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let locRestore: () => void;

  beforeEach(() => {
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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    locRestore();
  });

  it('dismissing the success banner returns focus to the editor surface (.ProseMirror or host)', async () => {
    // AC 4.5 verbatim — "banner dismiss returns focus to the
    // editor". The save click takes focus away from the
    // ProseMirror editor (button click); after dismiss, focus
    // must go back so the user can resume typing without an
    // extra mouse / Tab dance.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const btn = await mountAndEnter(host);

    // Pre-click, focus the live editor surface so it's the
    // "previously focused" element when the banner appears.
    const proseMirror = host.querySelector<HTMLElement>('.ProseMirror');
    expect(proseMirror, 'precondition: ProseMirror must be mounted').not.toBeNull();
    proseMirror!.focus();

    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const dismissBtn = host.querySelector<HTMLButtonElement>(
      '[data-testid="banner-dismiss"]',
    );
    expect(dismissBtn, 'precondition: dismiss control must exist').not.toBeNull();
    dismissBtn!.click();

    const active = document.activeElement as HTMLElement | null;
    const focusedEditor =
      active === proseMirror || active === host || host.contains(active);
    expect(
      focusedEditor,
      `expected focus to return to the editor surface after dismiss (AC 4.5). activeElement: ${active?.tagName ?? 'null'}#${active?.id ?? ''}.${active?.className ?? ''}`,
    ).toBe(true);
  });
});

describe('Issue #158 / AC 4.4 — Cmd+S in-flight guard', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let resolveFetch: ((response: Response) => void) | null = null;
  let locRestore: () => void;
  let saveCallCount: number;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    originalFetch = globalThis.fetch;
    resolveFetch = null;
    saveCallCount = 0;
    fetchSpy = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (u.includes('/api/save')) {
        saveCallCount += 1;
        return new Promise<Response>((resolve) => {
          // First in-flight save holds open until the test resolves.
          if (!resolveFetch) {
            resolveFetch = resolve;
          } else {
            resolve(
              new Response(
                JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
                { status: 200, headers: { 'content-type': 'application/json' } },
              ),
            );
          }
        });
      }
      void init;
      // Other fetches (session-status, repo perms) — return generic 200.
      return Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    window.history.replaceState({}, '', '/?repo=foo/bar&path=specs/spec.md&ref=main');
    ({ restore: locRestore } = installFakeLocation());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    locRestore();
  });

  function dispatchCmdS(target: HTMLElement): void {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    const ev = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(ev);
  }

  it('Cmd+S (or Ctrl+S) inside the editor in edit mode triggers POST /api/save', async () => {
    // AC 4.4 precondition — without a Cmd+S handler there's no
    // in-flight guard to test. Pin the handler exists.
    await mountAndEnter(host);

    dispatchCmdS(host);
    await new Promise((r) => setTimeout(r, 30));

    const saveCalls = fetchSpy.mock.calls.filter((c) => {
      const u = c[0];
      const url = typeof u === 'string' ? u : u instanceof URL ? u.href : (u as Request).url;
      return url.includes('/api/save');
    });
    expect(
      saveCalls.length,
      'expected Cmd+S to POST /api/save exactly once (AC 4.4 — Cmd+S handler)',
    ).toBe(1);
  });

  it('rapid Cmd+S during an in-flight save dispatches exactly one POST /api/save', async () => {
    // The central AC 4.5 pin: "rapid Cmd+S → exactly one POST".
    // While the first save is pending, subsequent Cmd+S presses
    // must be dropped. Combined with the existing AC 6.1 click
    // lock, this forms the in-flight guard.
    await mountAndEnter(host);

    dispatchCmdS(host);
    dispatchCmdS(host);
    dispatchCmdS(host);
    dispatchCmdS(host);
    await new Promise((r) => setTimeout(r, 30));

    expect(
      saveCallCount,
      `expected exactly one POST /api/save during in-flight saves; got ${saveCallCount} (AC 4.4 — Cmd+S in-flight guard).`,
    ).toBe(1);
  });

  it('button click during an in-flight Cmd+S save is dropped (cross-input in-flight lock)', async () => {
    // Belt: not just rapid Cmd+S — a Cmd+S followed by a click
    // must also be dropped. The in-flight guard is per-host, not
    // per-input-source.
    const btn = await mountAndEnter(host);
    dispatchCmdS(host);
    await new Promise((r) => setTimeout(r, 5));
    btn.click();
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    expect(
      saveCallCount,
      `expected exactly one POST /api/save when Cmd+S is followed by clicks; got ${saveCallCount}.`,
    ).toBe(1);
  });

  it('after the in-flight save resolves, a subsequent Cmd+S triggers a NEW POST /api/save', async () => {
    // Restoration belt: the guard releases on resolution. The
    // user must be able to make a second save attempt.
    await mountAndEnter(host);
    dispatchCmdS(host);
    await new Promise((r) => setTimeout(r, 5));

    expect(resolveFetch, 'precondition: first save in flight').not.toBeNull();
    resolveFetch!(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(saveCallCount, 'first save resolved').toBe(1);

    dispatchCmdS(host);
    await new Promise((r) => setTimeout(r, 30));

    expect(
      saveCallCount,
      'expected a second POST /api/save after the first resolved (AC 4.4 — guard releases on resolution)',
    ).toBe(2);
  });
});

describe('Issue #158 / AC 4.3 — success banner copy-details affordance (#119)', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let locRestore: () => void;
  let writtenText: string | null;

  beforeEach(() => {
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
    writtenText = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: {
        writeText: vi.fn((t: string) => {
          writtenText = t;
          return Promise.resolve();
        }),
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    locRestore();
  });

  it('success banner exposes a "copy" affordance that writes the PR URL to the clipboard', async () => {
    // #119: the success banner needs an explicit "copy details"
    // button so a user retrying after the auto-tab-blur can
    // grab the PR URL without alt-clicking the link. This pins
    // the affordance + the actual clipboard write on click.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/42' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const btn = await mountAndEnter(host);
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const banner = host.querySelector<HTMLElement>('[role="status"]');
    expect(banner, 'precondition: success banner').not.toBeNull();

    const buttons = Array.from(
      banner!.querySelectorAll<HTMLButtonElement>('button'),
    );
    const copyBtn = buttons.find((b) =>
      (b.textContent ?? '').toLowerCase().includes('copy'),
    );
    expect(
      copyBtn,
      `expected a button with text containing "copy" inside the success banner (#119). Found buttons: ${JSON.stringify(buttons.map((b) => b.textContent))}.`,
    ).toBeDefined();

    copyBtn!.click();
    await new Promise((r) => setTimeout(r, 5));

    expect(
      writtenText,
      `expected the copy button to write the PR URL via navigator.clipboard.writeText. Got: ${JSON.stringify(writtenText)}.`,
    ).toContain('https://github.com/foo/bar/pull/42');
  });

  it('after the copy click, the banner shows success feedback (e.g., "Copied")', async () => {
    // #119 — visual feedback. A click that produced no UI
    // change leaves the user wondering if anything happened.
    // Pin: after click, the banner contains "copied" (case
    // insensitive). Don't pin exact copy.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/42' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const btn = await mountAndEnter(host);
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    const banner = host.querySelector<HTMLElement>('[role="status"]');
    const buttons = Array.from(
      banner!.querySelectorAll<HTMLButtonElement>('button'),
    );
    const copyBtn = buttons.find((b) =>
      (b.textContent ?? '').toLowerCase().includes('copy'),
    )!;
    copyBtn.click();
    // Allow microtasks for the clipboard promise + UI update.
    await new Promise((r) => setTimeout(r, 20));

    const text = (banner!.textContent ?? '').toLowerCase();
    expect(
      text.includes('copied'),
      `expected the success banner to show "copied" feedback after the copy click (#119). Banner text: ${JSON.stringify(banner!.textContent)}.`,
    ).toBe(true);
  });
});
