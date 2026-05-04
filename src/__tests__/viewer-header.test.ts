import { describe, it, expect, beforeEach } from 'vitest';

// Issue #90 / AC 4.5 — Persistent header showing <repo> <path> <ref>
// with a link out to github.com.
//
// `renderViewerHeader(host, { repo, path, ref })` renders a static
// header surface inside the supplied `host` element. The header
// surfaces the spec's coordinates (repo / path / ref) and a single
// link out to the canonical GitHub view of the file:
//
//   https://github.com/<repo>/blob/<ref>/<path>
//
// The bootstrap places this above the viewer mount so the user always
// has an at-a-glance reminder of "where this came from" plus a
// one-click escape hatch to read the rendered file on GitHub.
//
// Contract pinned in this file:
//
//   1. Named export `renderViewerHeader` from `src/viewer-header.ts`.
//   2. The header is non-empty: visible text contains the verbatim
//      `repo`, `path`, and `ref` strings (no truncation, no rewrites).
//   3. Renders exactly one `<a>` whose `href` is
//      `https://github.com/<repo>/blob/<ref>/<encoded-path>`. Path
//      segments are encoded with `encodeURIComponent`; `/` separators
//      are preserved (same encoding rule as `fetchSpec`).
//   4. The link opens in a new tab (`target="_blank"`) AND carries
//      `rel` containing `noopener` so the GitHub page can't reach
//      back into the viewer's `window.opener`.
//   5. Hard-clears prior `host` content (replace, not append) — same
//      contract as `renderFileError` / `renderLanding`.

describe('Issue #90 / AC 4.5 — renderViewerHeader', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('is a named export of src/viewer-header.ts', async () => {
    const mod = (await import('../viewer-header')) as unknown as {
      renderViewerHeader?: unknown;
    };
    expect(
      typeof mod.renderViewerHeader,
      'expected `renderViewerHeader` to be exported as a function from src/viewer-header.ts (Issue #90 AC 4.5).',
    ).toBe('function');
  });

  it('renders the verbatim repo, path, and ref strings into the host', async () => {
    // The user must see WHERE the rendered spec came from. Pin the
    // verbatim strings — a future copy-edit that prefixes "repo: " /
    // "path: " is fine, but truncating `deanchanter/Hashly` to
    // `Hashly` (or hiding the ref behind a tooltip) is not. We use
    // `toContain` so the impl is free to add labels / separators.
    const { renderViewerHeader } = await import('../viewer-header');

    renderViewerHeader(host, {
      repo: 'deanchanter/Hashly',
      path: 'specs/v0.3-web-pivot/spec.md',
      ref: 'issue-90-viewer',
    });

    const text = host.textContent ?? '';
    expect(
      text,
      `expected the header to contain the repo string verbatim. Got: ${JSON.stringify(text)}`,
    ).toContain('deanchanter/Hashly');
    expect(
      text,
      `expected the header to contain the path string verbatim. Got: ${JSON.stringify(text)}`,
    ).toContain('specs/v0.3-web-pivot/spec.md');
    expect(
      text,
      `expected the header to contain the ref string verbatim. Got: ${JSON.stringify(text)}`,
    ).toContain('issue-90-viewer');
  });

  it('renders an <a> with href = https://github.com/<repo>/blob/<ref>/<path>', async () => {
    const { renderViewerHeader } = await import('../viewer-header');

    renderViewerHeader(host, {
      repo: 'deanchanter/Hashly',
      path: 'README.md',
      ref: 'main',
    });

    const links = host.querySelectorAll<HTMLAnchorElement>('a[href]');
    expect(
      links.length,
      `expected exactly one <a> link in the header (the github.com out-link); got ${links.length}.`,
    ).toBe(1);

    const expected = 'https://github.com/deanchanter/Hashly/blob/main/README.md';
    expect(
      links[0]!.getAttribute('href'),
      `expected the github.com out-link href to be exactly ${JSON.stringify(expected)}. Got: ${JSON.stringify(links[0]!.getAttribute('href'))}.`,
    ).toBe(expected);
  });

  it('preserves `/` separators in nested paths (the github URL must work for subdirectory specs)', async () => {
    // Realistic case: `specs/v0.3-web-pivot/spec.md`. A naïve
    // `encodeURIComponent(path)` would turn every `/` into `%2F`
    // and the github link would 404. Pin the same per-segment
    // encoding rule as `fetchSpec`.
    const { renderViewerHeader } = await import('../viewer-header');

    renderViewerHeader(host, {
      repo: 'deanchanter/Hashly',
      path: 'specs/v0.3-web-pivot/spec.md',
      ref: 'main',
    });

    const link = host.querySelector<HTMLAnchorElement>('a[href]');
    expect(link, 'expected a link to be present').not.toBeNull();
    expect(
      link!.getAttribute('href'),
      `expected nested-path slashes to remain literal (not %2F-encoded). Got: ${JSON.stringify(link!.getAttribute('href'))}`,
    ).toBe(
      'https://github.com/deanchanter/Hashly/blob/main/specs/v0.3-web-pivot/spec.md',
    );
  });

  it('URL-encodes spaces / non-ASCII chars per segment (same rule as fetchSpec)', async () => {
    // A path containing a space (e.g. `notes/my file.md`) must
    // produce a link with `%20` so click-through actually works.
    const { renderViewerHeader } = await import('../viewer-header');

    renderViewerHeader(host, {
      repo: 'deanchanter/Hashly',
      path: 'notes/my file.md',
      ref: 'main',
    });

    const link = host.querySelector<HTMLAnchorElement>('a[href]');
    expect(
      link!.getAttribute('href'),
      `expected the space in "my file.md" to be encoded as "%20" (per-segment encoding) while "/" stays literal. Got: ${JSON.stringify(link!.getAttribute('href'))}`,
    ).toBe('https://github.com/deanchanter/Hashly/blob/main/notes/my%20file.md');
  });

  it('opens the github link in a new tab (target="_blank") with rel="noopener" for safety', async () => {
    // `target="_blank"` without `rel="noopener"` lets the destination
    // page reach back into `window.opener` — a known phishing /
    // session-leak surface. Pin both attributes here so a future
    // contributor can't satisfy "opens in new tab" by dropping the
    // safety attribute.
    const { renderViewerHeader } = await import('../viewer-header');

    renderViewerHeader(host, {
      repo: 'deanchanter/Hashly',
      path: 'README.md',
      ref: 'main',
    });

    const link = host.querySelector<HTMLAnchorElement>('a[href]');
    expect(
      link!.getAttribute('target'),
      `expected the github.com out-link to have target="_blank" so it opens in a new tab and the user does not lose the viewer. Got: ${JSON.stringify(link!.getAttribute('target'))}`,
    ).toBe('_blank');

    const rel = link!.getAttribute('rel') ?? '';
    expect(
      rel,
      `expected the github.com out-link to have rel containing "noopener" so the destination page cannot reach window.opener (Issue #90 AC 4.5 — security pin on target="_blank"). Got rel: ${JSON.stringify(rel)}`,
    ).toContain('noopener');
  });

  it('clears prior host content (replaces, not appends)', async () => {
    // Same hard-clear contract as `renderFileError` / `renderLanding`.
    // Without it, a re-render after navigation (a future SPA-style
    // refresh) would stack two headers on top of each other.
    const { renderViewerHeader } = await import('../viewer-header');

    host.innerHTML = '<p class="stale">stale header from a prior render</p>';

    renderViewerHeader(host, {
      repo: 'deanchanter/Hashly',
      path: 'README.md',
      ref: 'main',
    });

    expect(
      host.querySelector('.stale'),
      'expected renderViewerHeader to clear prior host content. Without the clear, navigation between specs in a single session would leave stale headers stacked.',
    ).toBeNull();
  });
});
