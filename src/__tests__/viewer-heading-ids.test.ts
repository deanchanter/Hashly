import { describe, it, expect, beforeEach } from 'vitest';

// Issue #90 / Critical fix #4 — Heading IDs in `mountViewer`.
//
// `mountEditor` (v0.2) wires Milkdown's `headingIdGenerator` so each
// heading gets a slug-based `id` attribute (e.g. `## Setup` →
// `<h2 id="setup">`). In-doc anchor links like `[Setup](#setup)`
// scroll to the heading via the standard same-page hash mechanism.
//
// `mountViewer` (AC 4.4) was extracted without copying this wiring,
// so spec readers viewing a doc with a TOC saw clickable anchors
// that scrolled nowhere — UX regression flagged by the reviewer.
//
// Contract pinned in this file:
//
//   1. After mount, every heading has an `id` whose value is the
//      lower-cased, whitespace-collapsed, hyphen-joined slug of the
//      heading's text.
//
//   2. Duplicate-text headings get a counter suffix (`section`,
//      `section-1`, `section-2`) — same convention as v0.2 (issue
//      #17). The convention is GitHub-compatible so a copy-pasted
//      `[link](#section-1)` from a GitHub-rendered preview lands at
//      the right heading.
//
//   3. A relative anchor link `[Jump](#section)` survives the
//      mountViewer sanitizer (relative URLs are allowlisted —
//      already pinned by `viewer-xss.test.ts`) AND its href matches
//      the heading id. This is the load-bearing UX outcome: clicking
//      the rendered <a> scrolls to the rendered heading.

describe('Issue #90 / Critical fix #4 — heading IDs in mountViewer', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('assigns `id="section"` to a `## Section` heading (lowercase, slug-style)', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '## Section\n\nbody prose');

    const h2 = host.querySelector('h2');
    expect(
      h2,
      'expected an <h2> rendered from `## Section`',
    ).not.toBeNull();
    expect(
      h2?.getAttribute('id'),
      `expected the <h2> to carry id="section" (Issue #90 fix #4 — slug = lowercase + whitespace-to-hyphen). Got: ${JSON.stringify(h2?.getAttribute('id'))}`,
    ).toBe('section');
  });

  it('disambiguates duplicate-text headings with `<slug>-<n>` counter suffixes', async () => {
    // GitHub-style heading id collisions: the first occurrence is
    // `section`, the second is `section-1`, the third is
    // `section-2`. Pin this verbatim so a TOC link copied from a
    // GitHub preview lands correctly. (Same contract as v0.2 issue
    // #17, just re-asserted for the viewer mount path.)
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '## Section\n\n## Section\n\n## Section');

    const headings = Array.from(host.querySelectorAll<HTMLHeadingElement>('h2'));
    expect(
      headings.length,
      `expected three <h2> elements rendered from three "## Section" lines; got ${headings.length}.`,
    ).toBe(3);

    const ids = headings.map((h) => h.getAttribute('id')).sort();
    expect(
      ids,
      `expected the three duplicate H2 ids to be ["section", "section-1", "section-2"] (Issue #90 fix #4 — disambiguation contract matches v0.2 mountEditor). Got: ${JSON.stringify(ids)}.`,
    ).toEqual(['section', 'section-1', 'section-2']);
  });

  it('a relative anchor `[Jump](#section)` renders an <a href="#section"> that matches the heading id', async () => {
    // The load-bearing UX outcome: in-doc anchor click works.
    // We pin both halves on the same render — the heading carries
    // the right id AND the link's href is the same string. Without
    // both halves, the anchor scrolls to nowhere.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '## Section\n\n[Jump](#section)\n\nbody');

    const heading = host.querySelector('h2');
    const anchor = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).find((a) => a.getAttribute('href') === '#section');

    expect(
      heading?.getAttribute('id'),
      'expected the <h2> to carry id="section" so the anchor link resolves',
    ).toBe('section');
    expect(
      anchor,
      'expected an <a href="#section"> in the rendered DOM (Issue #90 fix #4 — relative anchor links must survive the sanitizer AND target the heading).',
    ).toBeDefined();
  });
});
