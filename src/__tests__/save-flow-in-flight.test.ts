import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #92 fix-loop iter-1 — Save button in-flight state (fix #7).
//
// AC for adversarial-reviewer's #7:
//
//   Today the Save button stays visually identical during the
//   network round-trip (potentially seconds). No spinner, no
//   disabled state, no `aria-busy`. Screen-reader users get no
//   announcement.
//
//   Fix: in `onSaveClick`, set `saveBtn.disabled = true;
//   saveBtn.setAttribute('aria-busy', 'true'); saveBtn.textContent
//   = 'Saving…';` in the try; restore in finally.
//
// Pinned contract (in addition to the existing AC 6.1
// in-flight-LOCK pin in save-flow-click.test.ts):
//
//   1. **Disabled-during-fetch** — while POST /api/save is
//      in-flight, `button.disabled === true`. (Stronger than the
//      AC 6.1 sync-race lock which only pins "second click is
//      ignored"; this pins the VISUAL state too.)
//   2. **aria-busy** — while in-flight, button carries
//      `aria-busy="true"` so screen readers announce the busy
//      state (NVDA / VoiceOver / JAWS all read aria-busy).
//   3. **Text reflects state** — while in-flight, textContent
//      contains "Saving" (any case; pin substring not exact
//      copy). After resolution, textContent is restored to
//      "Save" (substring match).
//   4. **Restored on success** — after a 200 OK response,
//      disabled is false, aria-busy is not "true", textContent
//      is "Save" again.
//   5. **Restored on failure** — same restoration after a 4xx
//      response (no-write, conflict, etc.).
//   6. **Restored on network throw** — same restoration when
//      submitSave returns kind:'network'.
//
// We control fetch timing via the same "never-resolves-until-
// the-test-resolves" pattern from save-flow-click.test.ts's
// in-flight-lock test. Each test exposes a `resolveFetch`
// hook so the test can:
//
//   - click the button
//   - assert mid-flight state
//   - call resolveFetch
//   - assert restored state

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

describe('Issue #92 fix #7 — Save button in-flight visual state', () => {
  let host: HTMLDivElement;
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let resolveFetch: ((response: Response) => void) | null = null;
  let originalLocation: Location;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);

    originalFetch = globalThis.fetch;
    resolveFetch = null;
    fetchSpy = vi.fn(() => {
      // Each call returns a controllable promise. The first call
      // captures resolveFetch; subsequent calls return immediately
      // (defensive for unrelated fetches the bootstrap may issue).
      return new Promise<Response>((resolve) => {
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
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    window.history.replaceState(
      {},
      '',
      '/?repo=foo/bar&path=specs/spec.md&ref=main',
    );

    originalLocation = window.location;
    let _href = originalLocation.href;
    const fakeLocation: FakeLocation = {
      get href() { return _href; },
      // eslint-disable-next-line accessor-pairs
      set href(v: string) { _href = v; },
      origin: originalLocation.origin,
      protocol: originalLocation.protocol,
      host: originalLocation.host,
      hostname: originalLocation.hostname,
      port: originalLocation.port,
      pathname: originalLocation.pathname,
      search: originalLocation.search,
      hash: originalLocation.hash,
      assign: () => {},
      replace: () => {},
      reload: () => {},
      toString() { return _href; },
    } as unknown as FakeLocation;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: fakeLocation,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  async function mountAndEnterEditMode(): Promise<HTMLButtonElement> {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Spec\n\nbody\n');
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (
        h: HTMLElement,
        opts?: { baseSha?: string },
      ) => Promise<void>;
    };
    await enterEditMode(host, { baseSha: 'CAPTURED_BASE_SHA_abc123' });
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-testid="${SAVE_BTN_TESTID}"]`,
    );
    if (!btn) throw new Error('precondition: save button must exist');
    return btn;
  }

  it('while POST /api/save is in-flight, the Save button is disabled', async () => {
    // The central UX pin: a clicked button that's still doing
    // network work must visually communicate "you've already
    // pressed me, I'm working on it". Without this, an impatient
    // user may click multiple times and (per AC 6.1's lock) the
    // extra clicks silently do nothing — but the user has no
    // signal that the FIRST click is in progress.
    const btn = await mountAndEnterEditMode();
    expect(btn.disabled, 'precondition: button must start enabled').toBe(false);

    btn.click();
    // Yield to let the click handler set up the fetch.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    expect(
      btn.disabled,
      'expected button.disabled === true while POST /api/save is in-flight (#7 — without this, an impatient user clicks multiple times with no signal the first click is working).',
    ).toBe(true);
  });

  it('while in-flight, the Save button has aria-busy="true" (screen-reader announcement)', async () => {
    // a11y belt: SRs use aria-busy to announce "this control is
    // currently doing work". Without it, a screen-reader user
    // gets no signal that their save click is processing.
    const btn = await mountAndEnterEditMode();
    btn.click();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    expect(
      btn.getAttribute('aria-busy'),
      'expected aria-busy="true" while save is in-flight (#7 — screen-reader announcement). Got: ' +
        JSON.stringify(btn.getAttribute('aria-busy')),
    ).toBe('true');
  });

  it('while in-flight, the Save button textContent contains "Saving" (visual progress cue)', async () => {
    // The text label changes ("Save" → "Saving…") so sighted
    // users see a state cue beyond just the disabled appearance.
    // Pin substring match — exact copy ("Saving…", "Saving",
    // "Saving now") is editorial.
    const btn = await mountAndEnterEditMode();
    expect(
      (btn.textContent ?? '').toLowerCase(),
      'precondition: button starts as "Save"',
    ).toContain('save');

    btn.click();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    expect(
      (btn.textContent ?? '').toLowerCase(),
      `expected button textContent to contain "saving" while in-flight (#7 — visual progress cue). Got: ${JSON.stringify(btn.textContent)}.`,
    ).toContain('saving');
  });

  it('after a successful POST /api/save (200), the button is restored: NOT disabled, NOT aria-busy, textContent back to "Save"', async () => {
    // The restoration pin. Without this, the button stays
    // disabled / busy after the save resolves and the user can't
    // save again (without reload).
    const btn = await mountAndEnterEditMode();
    btn.click();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    expect(btn.disabled, 'precondition: button must be disabled mid-flight').toBe(true);
    expect(resolveFetch, 'precondition: a fetch must be in-flight').not.toBeNull();

    resolveFetch!(
      new Response(
        JSON.stringify({ ok: true, prUrl: 'https://github.com/foo/bar/pull/1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    // Wait for the click handler's then-branch to run.
    await new Promise((r) => setTimeout(r, 30));

    expect(
      btn.disabled,
      'expected button.disabled === false after a successful save resolves (#7 — restoration on success).',
    ).toBe(false);
    expect(
      btn.getAttribute('aria-busy'),
      `expected aria-busy to be absent or "false" after restoration. Got: ${JSON.stringify(btn.getAttribute('aria-busy'))}.`,
    ).not.toBe('true');
    expect(
      (btn.textContent ?? '').toLowerCase(),
      `expected button textContent to be restored to "Save" after success. Got: ${JSON.stringify(btn.textContent)}.`,
    ).toContain('save');
    expect(
      (btn.textContent ?? '').toLowerCase(),
      `expected button textContent NOT to still say "Saving" after success. Got: ${JSON.stringify(btn.textContent)}.`,
    ).not.toContain('saving');
  });

  it('after a failed POST /api/save (4xx with kind:"no-write"), the button is restored', async () => {
    // Same restoration on failure — without this, a user who hit
    // a no-write error can never retry.
    const btn = await mountAndEnterEditMode();
    btn.click();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    expect(resolveFetch, 'precondition: fetch in-flight').not.toBeNull();
    resolveFetch!(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'no-write',
          message: 'You don\'t have write access...',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    await new Promise((r) => setTimeout(r, 30));

    expect(
      btn.disabled,
      'expected button.disabled === false after a failed save resolves (#7 — user must be able to retry after a no-write error).',
    ).toBe(false);
    expect(
      btn.getAttribute('aria-busy'),
      'expected aria-busy NOT to be "true" after failure restoration.',
    ).not.toBe('true');
  });

  it('after a network throw (fetch rejects), the button is restored', async () => {
    // The defensive floor: even when submitSave's fetch throws
    // (network error → kind:'network' from the AC 6.7 floor),
    // the click handler's `finally` block must restore the
    // button. Without this, an offline user is stuck with a
    // disabled button until reload.
    //
    // We override fetch to reject directly on the first call
    // (not the resolve-later pattern).
    globalThis.fetch = vi.fn(() => {
      return Promise.reject(new TypeError('Failed to fetch'));
    }) as unknown as typeof fetch;

    const btn = await mountAndEnterEditMode();
    btn.click();
    // Wait for the rejection to propagate through submitSave's
    // try/catch and the click handler's finally.
    await new Promise((r) => setTimeout(r, 30));

    expect(
      btn.disabled,
      'expected button.disabled === false after a network-throw (#7 — defensive floor; submitSave converts the throw to kind:"network", click handler must still restore the button).',
    ).toBe(false);
    expect(
      btn.getAttribute('aria-busy'),
      'expected aria-busy NOT to be "true" after network-throw restoration.',
    ).not.toBe('true');
    expect(
      (btn.textContent ?? '').toLowerCase(),
      `expected button textContent restored to "Save" after network-throw. Got: ${JSON.stringify(btn.textContent)}.`,
    ).toContain('save');
  });
});
