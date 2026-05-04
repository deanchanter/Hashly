import { describe, it, expect, beforeEach } from 'vitest';

// Issue #90 / AC 4.2 — Landing page for missing/invalid params.
//
// When the viewer is loaded WITHOUT a valid `?repo=…&path=…` (or with
// invalid values that `parseSpecUrl` rejects), it must show a static
// landing page with:
//
//   1. A short explanation of how to use the viewer.
//   2. An example link the user can click to see a real spec render
//      — exactly `?repo=deanchanter/Hashly&path=README.md` per the AC.
//
// We keep the landing-page renderer in its own module (`src/landing.ts`)
// so the integration tests can drive it directly without spinning up the
// full bootstrap, and so the renderer is reachable from a non-Tauri
// codepath (the v0.2 `src/main.ts` is full of Tauri imports that
// poison the test slot otherwise).
//
// Contract pinned in this file:
//
//   - Named export `renderLanding(host: HTMLElement, error?: string): void`
//     in `src/landing.ts`.
//   - Replaces (NOT appends to) prior host content. Same hard-clear
//     contract as `renderFileError` — without it, a re-render with
//     stale state stacks alerts on top of editors.
//   - Inserts exactly one `<a>` whose `href` decodes to the example
//     query string `?repo=deanchanter/Hashly&path=README.md`. The
//     link must be a relative href (begins with `?`) so navigating
//     to it keeps the user on the viewer's own origin.
//   - Renders some prose explaining the URL-param shape — we assert
//     "repo" + "path" appear in the visible text so a future copy-edit
//     that drops the actionable instruction breaks the test.
//   - When `error` is provided, the error text is rendered in a
//     visible role-correct surface (`[role="alert"]`). When `error`
//     is omitted (cold landing), NO alert is rendered.
//   - Does NOT mount Milkdown — the landing page is static.

describe('Issue #90 / AC 4.2 — renderLanding', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('is a named export of src/landing.ts', async () => {
    // RED until builder creates `src/landing.ts` exporting `renderLanding`.
    const mod = (await import('../landing')) as unknown as {
      renderLanding?: unknown;
    };
    expect(
      typeof mod.renderLanding,
      'expected `renderLanding` to be exported as a function from src/landing.ts (Issue #90 AC 4.2).',
    ).toBe('function');
  });

  it('clears prior host content (replaces, not appends)', async () => {
    const { renderLanding } = await import('../landing');
    host.innerHTML = '<p class="stale">stale content from a prior render</p>';

    renderLanding(host);

    expect(
      host.querySelector('.stale'),
      'expected renderLanding to clear prior host content — without the clear, a previously-rendered editor would visually overlap with the landing page.',
    ).toBeNull();
  });

  it('renders an example link to `?repo=deanchanter/Hashly&path=README.md`', async () => {
    // The AC quotes this example link verbatim. The user's first
    // interaction is "click the example to see what it does", so the
    // link MUST point to a valid public spec render.
    //
    // We assert the *decoded* href contains the example query string
    // so the impl can choose how to encode `&` (literal vs `&amp;` in
    // markup); after the browser parses the attribute, the property
    // returns the unescaped form.
    const { renderLanding } = await import('../landing');
    renderLanding(host);

    const links = host.querySelectorAll('a[href]');
    expect(
      links.length,
      `expected at least one example <a> link in the landing page; got ${links.length}.`,
    ).toBeGreaterThanOrEqual(1);

    const exampleHref = '?repo=deanchanter/Hashly&path=README.md';
    const matchingLink = Array.from(links).find((a) => {
      const href = a.getAttribute('href') ?? '';
      return href === exampleHref;
    });
    expect(
      matchingLink,
      `expected an <a> with href exactly equal to ${JSON.stringify(exampleHref)} (the AC's example link, verbatim). Got hrefs: ${JSON.stringify(
        Array.from(links).map((a) => a.getAttribute('href')),
      )}.`,
    ).toBeDefined();
  });

  it('the example link is a relative URL (starts with `?`) so it stays on the same origin', async () => {
    // If the impl hardcodes `https://hashly.dev/?repo=...` the click
    // takes the user OFF the viewer they're currently using — defeats
    // the purpose of "click here to see what it does". Pin the
    // relative form explicitly so the link works on any deploy
    // (localhost, preview, prod).
    const { renderLanding } = await import('../landing');
    renderLanding(host);

    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const example = links.find((a) =>
      (a.getAttribute('href') ?? '').includes('repo=deanchanter/Hashly'),
    );
    expect(example, 'expected an example link to be present').toBeDefined();
    const href = example!.getAttribute('href') ?? '';
    expect(
      href.startsWith('?'),
      `expected the example link to be a relative URL starting with "?" so the click stays on the viewer's origin. Got: ${JSON.stringify(href)}.`,
    ).toBe(true);
  });

  it('renders a short explanation that mentions the `repo` and `path` params', async () => {
    // Lock in the actionable copy: the user must learn that they
    // need a `repo` and `path` param. We don't pin verbatim wording
    // (copy is allowed to evolve) but pin the two key tokens so a
    // future copy-edit that drops "tell the user how to use the
    // viewer" breaks the test.
    const { renderLanding } = await import('../landing');
    renderLanding(host);

    const text = (host.textContent ?? '').toLowerCase();
    expect(
      text,
      `expected the landing page text to mention "repo" so the user learns to add a repo query param. Got text: ${JSON.stringify(text.slice(0, 200))}.`,
    ).toContain('repo');
    expect(
      text,
      `expected the landing page text to mention "path" so the user learns to add a path query param. Got text: ${JSON.stringify(text.slice(0, 200))}.`,
    ).toContain('path');
  });

  it('does NOT mount a Milkdown editor (no .ProseMirror inside host)', async () => {
    // The landing surface is static — same defensive pin as
    // `renderFileError`. If a future contributor routes the
    // explanation through Milkdown, screen readers would announce
    // a read-only doc instead of a navigation surface.
    const { renderLanding } = await import('../landing');
    renderLanding(host);

    // Allow microtasks to settle in case a stray async call were
    // accidentally enqueued.
    await Promise.resolve();
    await Promise.resolve();

    expect(
      host.querySelector('.ProseMirror'),
      'expected NO .ProseMirror inside host after renderLanding — the landing surface must be static (Issue #90 AC 4.2).',
    ).toBeNull();
    expect(
      host.querySelector('[contenteditable]'),
      'expected NO [contenteditable] inside host after renderLanding — the landing surface must be non-interactive.',
    ).toBeNull();
  });

  it('renders the supplied error string in a [role="alert"] when called with an error', async () => {
    // When parseSpecUrl rejects, the bootstrap passes the error
    // string through so the user sees WHY the landing page is
    // showing instead of their spec. Without this, "I typed the URL
    // wrong" is indistinguishable from "I forgot the params".
    const { renderLanding } = await import('../landing');
    const errorMessage = '`repo` must be `owner/name` (alphanumerics, `.`, `_`, `-`)';
    renderLanding(host, errorMessage);

    const alerts = host.querySelectorAll('[role="alert"]');
    expect(
      alerts.length,
      `expected exactly one [role="alert"] when renderLanding is called with an error string; got ${alerts.length}.`,
    ).toBe(1);
    expect(
      alerts[0]!.textContent ?? '',
      `expected the alert to contain the verbatim error string ${JSON.stringify(errorMessage)} so the user sees why the landing page rendered.`,
    ).toContain(errorMessage);
  });

  it('does NOT render a [role="alert"] when called with no error (cold landing — user just typed the URL with no params)', async () => {
    // The cold landing (user lands on hashly.dev with no params)
    // should be welcoming, not alarming. An empty alert would still
    // be announced by screen readers; explicitly omit it.
    const { renderLanding } = await import('../landing');
    renderLanding(host);

    const alerts = host.querySelectorAll('[role="alert"]');
    expect(
      alerts.length,
      `expected NO [role="alert"] on a cold landing (no error supplied) so screen readers do not announce a non-existent error. Got ${alerts.length}.`,
    ).toBe(0);
  });
});
