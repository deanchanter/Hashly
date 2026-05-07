import { describe, it, expect, beforeEach } from 'vitest';

// Issue #157 / AC 3.3 + AC 3.4 — Sanitizer hardening: MutationObserver
// scoped to the read-only viewer surface.
//
// `sanitizeUrlAttributes` runs ONCE at mount time today. Anything
// injected into the viewer DOM after mount — Milkdown's runtime
// insertions (paste, IME composition completion), heading-anchor
// rewrites, or any future plugin that touches the rendered tree —
// bypasses the sanitizer entirely. The fix shape (design.md
// Decision 3): hook a MutationObserver on the viewer host that
// watches `childList` (subtree) and `attributes` (href, src) and
// re-runs the sanitizer on inserted nodes + on attribute mutations
// of link-bearing elements.
//
// These tests pin the OUTCOME (no `<a>`/`<img>` inside the host
// retains a dangerous scheme after a microtask flush, regardless of
// how it got there) rather than the observer's exact options. The
// builder picks the observer config; the contract is: post-mount
// DOM mutations involving disallowed schemes get neutralized
// without re-mounting.
//
// Scope: read-only viewer surface only. Edit-mode editors are
// covered by the existing edit path; this observer must NOT be
// installed by `_remountAsEditable` (the editor tree is large and
// constantly mutating during typing — see AC 3.5 for the latency
// concern). The observer SHOULD be installed by `mountViewer` and
// by `_remountAsReadOnly`.

const DANGEROUS_RE = /^\s*(javascript|data|vbscript)\s*:/i;

async function flushObserver(): Promise<void> {
  // MutationObserver callbacks are microtasks. A `setTimeout(0)`
  // gives them a full task to drain; both sync and async observer
  // dispatches are caught.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
}

describe('Issue #157 / AC 3.3 — MutationObserver on the read-only viewer host', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('strips a `javascript:` href on a dynamically inserted `<a>`', async () => {
    // Simulates a runtime DOM insertion (paste, plugin output,
    // anything that adds a node post-mount). Without an observer,
    // the anchor survives unchanged. The test forces the observer
    // path by appending the anchor AFTER `mountViewer` has returned
    // and the initial sanitizer pass has run.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc\n\nbody.');

    const a = document.createElement('a');
    a.setAttribute('href', 'javascript:alert(1)');
    a.textContent = 'late insert';
    host.appendChild(a);

    await flushObserver();

    const anchors = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).filter((el) => DANGEROUS_RE.test(el.getAttribute('href') ?? ''));
    expect(
      anchors.map((el) => el.getAttribute('href')),
      'expected a dynamically-appended `<a href="javascript:...">` to be neutralized by the viewer-scoped MutationObserver (Issue #157 AC 3.3).',
    ).toEqual([]);
  });

  it('strips a `data:` src on a dynamically inserted `<img>`', async () => {
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    const img = document.createElement('img');
    img.setAttribute('src', 'data:text/html,<script>alert(1)</script>');
    img.setAttribute('alt', 'late img');
    host.appendChild(img);

    await flushObserver();

    const dangerous = Array.from(
      host.querySelectorAll<HTMLImageElement>('img[src]'),
    ).filter((el) => DANGEROUS_RE.test(el.getAttribute('src') ?? ''));
    expect(
      dangerous.map((el) => el.getAttribute('src')),
      'expected a dynamically-appended `<img src="data:...">` to be neutralized by the observer (Issue #157 AC 3.3 — img path).',
    ).toEqual([]);
  });

  it('strips a dangerous href set via `setAttribute` on an existing safe anchor', async () => {
    // Attribute-mutation path: the anchor is already in the DOM
    // (it survived initial sanitization because its href was
    // safe), then someone rewrites the href to a disallowed scheme.
    // Browsers fire the new scheme on click — the observer must
    // re-run on attribute mutations of link-bearing elements.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '[GitHub](https://github.com)');

    const link = host.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com"]',
    );
    expect(link, 'fixture: expected the safe `https://github.com` anchor to mount').toBeTruthy();
    link!.setAttribute('href', 'javascript:alert(1)');

    await flushObserver();

    const dangerous = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).filter((el) => DANGEROUS_RE.test(el.getAttribute('href') ?? ''));
    expect(
      dangerous.map((el) => el.getAttribute('href')),
      'expected the post-mutation `javascript:` href to be re-neutralized by the observer (Issue #157 AC 3.3 — attribute mutation path).',
    ).toEqual([]);
  });

  it('strips a normalization-bypass href (zero-width + percent-encoded) inserted post-mount', async () => {
    // Combines AC 3.2 normalization with AC 3.3 observer: the
    // injected href both lives in the late-insertion path AND
    // exercises the normalizer (ZWSP + `%61` → `a`). A naïve
    // observer that re-checks the raw attribute string instead of
    // the normalized form would let this through.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    const a = document.createElement('a');
    a.setAttribute('href', 'j%61va​script:alert(1)');
    a.textContent = 'sneaky';
    host.appendChild(a);

    await flushObserver();

    const anchors = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    );
    const survived = anchors.find((el) => {
      const href = el.getAttribute('href') ?? '';
      // Normalize the same way the sanitizer should: strip ZW,
      // percent-decode, lowercase.
      let v = href.replace(/[​‌‍﻿]/g, '');
      try {
        v = decodeURIComponent(v);
      } catch {
        /* ignore */
      }
      return /^\s*(javascript|data|vbscript)\s*:/i.test(v);
    });
    expect(
      survived?.getAttribute('href'),
      'expected a ZWSP+percent-encoded scheme injected post-mount to be neutralized by the observer running the normalized sanitizer (Issue #157 AC 3.3 + AC 3.2 cross-pin).',
    ).toBeUndefined();
  });

  it('strips a dangerous link inserted via a nested fragment (subtree mutations are observed)', async () => {
    // The observer must watch the SUBTREE, not just direct
    // children of the host. Real Milkdown insertions land deep
    // inside the ProseMirror tree.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc\n\nparagraph.');

    const wrapper = document.createElement('section');
    const inner = document.createElement('p');
    const a = document.createElement('a');
    a.setAttribute('href', 'vbscript:msgbox(1)');
    a.textContent = 'deep';
    inner.appendChild(a);
    wrapper.appendChild(inner);
    host.appendChild(wrapper);

    await flushObserver();

    const dangerous = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).filter((el) => DANGEROUS_RE.test(el.getAttribute('href') ?? ''));
    expect(
      dangerous.map((el) => el.getAttribute('href')),
      'expected the deeply-nested `vbscript:` anchor to be neutralized — observer must watch subtree mutations (Issue #157 AC 3.3).',
    ).toEqual([]);
  });

  it('does NOT strip an `https://` href inserted post-mount (allowed-scheme passthrough)', async () => {
    // Negative test: the observer must not over-fire. A late
    // insertion of an `https://` link (e.g., from a paste) survives
    // intact.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com/legit');
    a.textContent = 'legit';
    host.appendChild(a);

    await flushObserver();

    const survivor = host.querySelector<HTMLAnchorElement>(
      'a[href="https://example.com/legit"]',
    );
    expect(
      survivor,
      'expected dynamically-inserted `https://` anchor to be preserved verbatim — observer must not over-strip allowlisted schemes (Issue #157 AC 3.3 negative).',
    ).toBeTruthy();
  });

  it('continues sanitizing after multiple mutation batches (observer not single-shot)', async () => {
    // The observer must keep running for the lifetime of the
    // mount, not detach after the first mutation batch.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, '# Doc');

    // Batch 1
    const a1 = document.createElement('a');
    a1.setAttribute('href', 'javascript:alert(1)');
    host.appendChild(a1);
    await flushObserver();

    // Batch 2 (separate task — observer must still be live)
    const a2 = document.createElement('a');
    a2.setAttribute('href', 'data:text/html,foo');
    host.appendChild(a2);
    await flushObserver();

    // Batch 3
    const img = document.createElement('img');
    img.setAttribute('src', 'vbscript:msgbox(1)');
    host.appendChild(img);
    await flushObserver();

    const danglingAnchors = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).filter((el) => DANGEROUS_RE.test(el.getAttribute('href') ?? ''));
    const danglingImgs = Array.from(
      host.querySelectorAll<HTMLImageElement>('img[src]'),
    ).filter((el) => DANGEROUS_RE.test(el.getAttribute('src') ?? ''));
    expect(
      [...danglingAnchors, ...danglingImgs].map(
        (el) =>
          el.getAttribute('href') ?? el.getAttribute('src') ?? '<empty>',
      ),
      'expected the observer to keep firing across multiple mutation batches — must not detach after first run (Issue #157 AC 3.3 — observer lifetime).',
    ).toEqual([]);
  });
});
