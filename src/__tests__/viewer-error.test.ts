import { describe, it, expect, beforeEach } from 'vitest';

// Issue #90 / AC 4.7 — Error states for failed fetch.
//
// `fetchSpec` (AC 4.3) returns a discriminated union with four
// failure kinds:
//
//   { ok: false, kind: 'not-found' }                // 404
//   { ok: false, kind: 'forbidden' }                // 403
//   { ok: false, kind: 'network' }                  // fetch threw
//   { ok: false, kind: 'other', status: number }    // 500, 5xx, etc.
//
// `renderViewerError(host, failure)` renders a static, accessible
// surface explaining the failure to the user. Each kind gets a
// distinct user-visible message (so the user can act differently:
// retype the URL vs. wait out a network glitch vs. report a 5xx).
//
// Per the AC: GitHub returns 404 for private repos to anonymous
// users, so the practical mapping is "404 ⇒ private or not found".
// The 403 branch is rare in practice (rate-limit / abuse surface)
// but is explicitly listed in the issue body, so we keep a distinct
// message for it.
//
// Contract pinned in this file:
//
//   1. Named export `renderViewerError` from `src/viewer-error.ts`,
//      typed against `Extract<FetchSpecResult, { ok: false }>`.
//   2. Each kind renders exactly one `[role="alert"]` element
//      whose `textContent` is non-empty.
//   3. The four kinds produce DIFFERENT messages (no copy-paste
//      shortcut where every kind says the same thing).
//   4. The `not-found` message conveys "not found / private /
//      can't find it".
//   5. The `forbidden` message mentions "access" / "forbidden" /
//      "permission" so the user understands the surface.
//   6. The `network` message mentions "network" / "connection" /
//      "offline" so the user knows to check their connection
//      rather than re-typing the URL.
//   7. The `other` kind surfaces the numeric status code so the
//      user (or a bug report) has actionable info.
//   8. Hard clears prior host content.
//   9. Does NOT mount Milkdown.

describe('Issue #90 / AC 4.7 — renderViewerError', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('is a named export of src/viewer-error.ts', async () => {
    const mod = (await import('../viewer-error')) as unknown as {
      renderViewerError?: unknown;
    };
    expect(
      typeof mod.renderViewerError,
      'expected `renderViewerError` to be exported as a function from src/viewer-error.ts (Issue #90 AC 4.7).',
    ).toBe('function');
  });

  it('renders a `[role="alert"]` for the `not-found` kind with a "not found / private" message', async () => {
    const { renderViewerError } = await import('../viewer-error');
    renderViewerError(host, { ok: false, kind: 'not-found' });

    const alerts = host.querySelectorAll('[role="alert"]');
    expect(
      alerts.length,
      `expected exactly one [role="alert"] for not-found; got ${alerts.length}.`,
    ).toBe(1);
    const text = (alerts[0]!.textContent ?? '').toLowerCase();
    // "not found" OR "private" OR "couldn't find" — the AC says
    // GitHub returns 404 for private repos to anonymous users, so
    // the message must convey both possibilities (or at least the
    // umbrella "we couldn't find this"). Pin one of the load-bearing
    // tokens so a contributor can't satisfy the AC with a generic
    // "Error" surface.
    expect(
      /(not found|private|couldn't find|cannot find|can't find)/.test(text),
      `expected the not-found message to contain one of "not found / private / couldn't find / cannot find / can't find" (Issue #90 AC 4.7 — user must know to re-check the path or the repo's visibility). Got: ${JSON.stringify(text)}`,
    ).toBe(true);
  });

  it('renders a `[role="alert"]` for the `forbidden` kind with an access/forbidden message', async () => {
    const { renderViewerError } = await import('../viewer-error');
    renderViewerError(host, { ok: false, kind: 'forbidden' });

    const alerts = host.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(1);
    const text = (alerts[0]!.textContent ?? '').toLowerCase();
    expect(
      /(forbidden|access|permission|denied|rate)/.test(text),
      `expected the forbidden message to contain one of "forbidden / access / permission / denied / rate" so the user understands the surface (Issue #90 AC 4.7). Got: ${JSON.stringify(text)}`,
    ).toBe(true);
  });

  it('renders a `[role="alert"]` for the `network` kind with a network/connection message', async () => {
    const { renderViewerError } = await import('../viewer-error');
    renderViewerError(host, { ok: false, kind: 'network' });

    const alerts = host.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(1);
    const text = (alerts[0]!.textContent ?? '').toLowerCase();
    expect(
      /(network|connection|offline|reach|connect)/.test(text),
      `expected the network message to contain one of "network / connection / offline / reach / connect" so the user knows to check their connection (Issue #90 AC 4.7). Got: ${JSON.stringify(text)}`,
    ).toBe(true);
  });

  it('renders a `[role="alert"]` for the `other` kind that includes the numeric status code', async () => {
    // The `other` bucket catches 500/502/503 etc. The user sees a
    // generic "server error" message; including the numeric status
    // makes the surface actionable for a bug report and lets a
    // future copy iteration vary by status without changing the
    // contract.
    const { renderViewerError } = await import('../viewer-error');
    renderViewerError(host, { ok: false, kind: 'other', status: 502 });

    const alerts = host.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(1);
    const text = alerts[0]!.textContent ?? '';
    expect(
      text,
      `expected the "other" alert to surface the numeric status code (502) verbatim so users can include it in bug reports (Issue #90 AC 4.7). Got: ${JSON.stringify(text)}`,
    ).toContain('502');
  });

  it('produces DIFFERENT messages for the four kinds (no copy-paste shortcut)', async () => {
    // If a contributor satisfies all four "alert renders" tests by
    // showing the same generic "Error" copy for every kind, the user
    // can't distinguish a private repo from a network glitch from a
    // 5xx. This test pins the actionable-copy contract: all four
    // textContent strings must be distinct.
    const { renderViewerError } = await import('../viewer-error');

    const captureText = (kind: 'not-found' | 'forbidden' | 'network'): string => {
      host.innerHTML = '';
      renderViewerError(host, { ok: false, kind });
      return (host.querySelector('[role="alert"]')?.textContent ?? '').trim();
    };
    const captureOther = (status: number): string => {
      host.innerHTML = '';
      renderViewerError(host, { ok: false, kind: 'other', status });
      return (host.querySelector('[role="alert"]')?.textContent ?? '').trim();
    };

    const messages = [
      captureText('not-found'),
      captureText('forbidden'),
      captureText('network'),
      captureOther(500),
    ];
    const unique = new Set(messages);
    expect(
      unique.size,
      `expected the four error kinds to produce four distinct messages (Issue #90 AC 4.7 — user must be able to distinguish "wrong URL" from "offline" from "GitHub down"). Got: ${JSON.stringify(messages)}`,
    ).toBe(4);
  });

  it('clears prior host content (replaces, not appends)', async () => {
    // Same hard-clear contract as renderFileError / renderLanding /
    // renderViewerHeader. Without it, switching between two error
    // surfaces in the same session stacks alerts.
    const { renderViewerError } = await import('../viewer-error');
    host.innerHTML =
      '<div class="prior">prior content (e.g. a stale viewer mount)</div>';

    renderViewerError(host, { ok: false, kind: 'not-found' });

    expect(
      host.querySelector('.prior'),
      'expected renderViewerError to clear prior host content. Without the clear, a fetch failure on the second navigation would leave the first spec visible underneath the alert.',
    ).toBeNull();
  });

  it('does NOT mount a Milkdown editor (the error surface must be static)', async () => {
    // Pin same as renderFileError: an alert routed through Milkdown
    // would have the editor's keybindings and screen-reader
    // announcement compete with the actual error surface.
    const { renderViewerError } = await import('../viewer-error');
    renderViewerError(host, { ok: false, kind: 'network' });

    await Promise.resolve();
    await Promise.resolve();

    expect(
      host.querySelector('.ProseMirror'),
      'expected NO .ProseMirror element after renderViewerError — the error surface must be static (Issue #90 AC 4.7).',
    ).toBeNull();
    expect(
      host.querySelector('[contenteditable]'),
      'expected NO [contenteditable] element after renderViewerError — the error surface must be non-interactive.',
    ).toBeNull();
  });
});
