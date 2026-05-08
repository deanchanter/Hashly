import { describe, it, expect, beforeEach } from 'vitest';

// Issue #157 / AC 3.5 — Sanitizer hardening: latency contract.
//
// Design.md Decision 3 + the "MutationObserver re-sanitizer fires on
// every Milkdown DOM update and degrades typing latency" risk note
// commit two contracts:
//
//   1. The viewer-scoped observer must not have pathological cost
//      under a realistic spec render (mount + many mutations).
//   2. The observer is *viewer-scoped only*. The editor path is
//      separate — `_remountAsEditable` must NOT install (or must
//      disconnect) the observer, so typing in edit mode pays zero
//      observer overhead.
//
// Two distinct tests:
//
//   • A benchmark: mount a representative spec body (~50 sections,
//     ~100 links/images), trigger many post-mount mutations, assert
//     end-to-end wall-time stays under a generous bound. The bound
//     is intentionally loose (multi-second) — its job is to catch
//     accidental O(N²)-per-keystroke regressions, not to optimize
//     microseconds. Browsers and jsdom both share the same
//     MutationObserver microtask scheduler, so the relative
//     overhead between "no observer" and "observer with sanitize
//     callback" carries.
//
//   • A "viewer-scoped only" property test: after a flip to edit
//     mode via `_remountAsEditable`, an injected `javascript:`
//     anchor stays in the DOM. This isn't a security gap — edit
//     mode is the authenticated author's surface, the initial
//     sanitize pass still runs, and the user is not rendering
//     attacker markdown without first having been in viewer mode
//     where the observer fires. It locks down the design intent
//     so a future change can't silently bolt the observer onto
//     the editor and tank typing latency.

const DANGEROUS_RE = /^\s*(javascript|data|vbscript)\s*:/i;

function buildLargeMarkdown(): string {
  const parts: string[] = ['# Realistic Spec\n'];
  for (let i = 0; i < 50; i++) {
    parts.push(`## Section ${i}\n`);
    parts.push(
      `Paragraph with [link ${i}](https://example.com/${i}) and ` +
        `another [link ${i}b](https://example.org/${i}) and an ` +
        `image ![alt](https://example.com/img-${i}.png).\n`,
    );
    parts.push(
      `- list item with [a](https://example.net/a-${i})\n` +
        `- list item with [b](https://example.net/b-${i})\n`,
    );
    parts.push('');
  }
  return parts.join('\n');
}

async function flushObserver(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('Issue #157 / AC 3.5 — sanitizer latency contract', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('mounts a realistic spec body in under a generous wall-time bound', async () => {
    // The mount path runs the initial sanitize pass + installs the
    // observer. A regression that walks the host DOM repeatedly
    // (e.g., per-link nested loop) blows past this bound; the
    // current impl walks once.
    const { mountViewer } = await import('../viewer');
    const md = buildLargeMarkdown();

    const start = performance.now();
    await mountViewer(host, md);
    const elapsed = performance.now() - start;

    // Generous: a typical jsdom mount of a 50-section doc clears
    // in <1s on cold CI. We assert <5s to catch only catastrophic
    // regressions.
    expect(
      elapsed,
      `expected mountViewer of a realistic 50-section spec to complete within 5000ms — observed ${elapsed.toFixed(1)}ms (Issue #157 AC 3.5: mount must not block on observer setup or sanitize-pass cost).`,
    ).toBeLessThan(5000);
  });

  it('handles 100 post-mount mutations within a generous wall-time bound', async () => {
    // Simulates a worst-case render where Milkdown (or a plugin)
    // inserts/mutates many nodes after the initial mount. Each
    // batch fires the observer; the sanitizer walks the host DOM.
    // If the impl re-walks the entire host on every mutation
    // *synchronously* per mutation record (instead of letting the
    // microtask coalesce them), this blows up.
    const { mountViewer } = await import('../viewer');
    await mountViewer(host, buildLargeMarkdown());

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const a = document.createElement('a');
      // Mix safe + dangerous so the sanitizer exercises both
      // paths.
      a.setAttribute(
        'href',
        i % 3 === 0
          ? 'javascript:alert(1)'
          : `https://example.com/insert-${i}`,
      );
      a.textContent = `insert ${i}`;
      host.appendChild(a);
      // Yield occasionally so the MutationObserver microtask gets
      // a chance to run; otherwise all 100 mutations coalesce
      // into one observer call and the test isn't measuring what
      // we want.
      if (i % 10 === 9) {
        await flushObserver();
      }
    }
    await flushObserver();
    const elapsed = performance.now() - start;

    // Generous bound — catches the "sanitize re-walks all 5000
    // anchors on each of 100 mutations" failure mode (≈500k node
    // visits) but allows a healthy "re-walk on each batch" impl.
    expect(
      elapsed,
      `expected 100 post-mount mutations to drain within 8000ms — observed ${elapsed.toFixed(1)}ms (Issue #157 AC 3.5: observer cost must be bounded under realistic render churn).`,
    ).toBeLessThan(8000);

    // After the run, no dangerous anchors should remain — the
    // observer must have caught every batch.
    const dangling = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).filter((el) => DANGEROUS_RE.test(el.getAttribute('href') ?? ''));
    expect(
      dangling.map((el) => el.getAttribute('href')),
      'expected zero dangerous anchors after 100-mutation churn — observer must keep firing across batches and apply normalized sanitizer to every insertion (Issue #157 AC 3.5 cross-pin with AC 3.3).',
    ).toEqual([]);
  });

  it('does NOT install the sanitizer observer on the editor path (`_remountAsEditable`)', async () => {
    // Viewer-scoped-only contract. Flip to edit mode, inject a
    // `javascript:` anchor post-flip, and assert it survives.
    // Surviving here proves the observer is disconnected on the
    // editor path; if a future change wires it up, this test
    // fails and forces a deliberate decision (with a typing-
    // latency benchmark to back it).
    //
    // SECURITY NOTE: the initial sanitize pass still runs at
    // mount/remount time, so attacker markdown loaded into edit
    // mode IS sanitized once. This test only proves the *observer*
    // doesn't run in edit mode — i.e., DOM mutations performed
    // *after* the editor mounts aren't re-sanitized. Those
    // mutations come from the user's own keystrokes; the
    // authenticated-author trust boundary is the protection.
    const viewer = await import('../viewer');
    await viewer.mountViewer(host, '# Doc');
    const editable = await viewer._remountAsEditable(host);
    expect(editable, 'fixture: edit-mode remount returned an editor').toBeTruthy();

    const a = document.createElement('a');
    a.setAttribute('href', 'javascript:alert(1)');
    a.textContent = 'edit-mode insert';
    host.appendChild(a);

    await flushObserver();
    await flushObserver();

    const survivor = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).find((el) => el.getAttribute('href') === 'javascript:alert(1)');
    expect(
      survivor,
      'expected the observer to be DISCONNECTED in edit mode — `javascript:` anchor injected post-flip must persist (proves no observer overhead pays the typing-latency cost). If this test starts failing after a feature change, weigh the typing-latency tradeoff before re-enabling the observer in edit mode (Issue #157 AC 3.5: editor path separate; observer is viewer-scoped only).',
    ).toBeTruthy();
  });

  it('re-installs the observer when flipping back to read-only via `_remountAsReadOnly`', async () => {
    // Round-trip: viewer → editable → read-only. The read-only
    // remount path installs a fresh observer (slice B contract).
    // Inject a dangerous anchor after the read-only flip and
    // assert it gets stripped — proves the observer is alive on
    // the post-flip surface, not just on initial mount.
    const viewer = await import('../viewer');
    await viewer.mountViewer(host, '# Doc');
    await viewer._remountAsEditable(host);
    await viewer._remountAsReadOnly(host);

    const a = document.createElement('a');
    a.setAttribute('href', 'javascript:alert(1)');
    a.textContent = 'post-flip insert';
    host.appendChild(a);

    await flushObserver();

    const dangling = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).filter((el) => DANGEROUS_RE.test(el.getAttribute('href') ?? ''));
    expect(
      dangling.map((el) => el.getAttribute('href')),
      'expected the observer to be re-installed by `_remountAsReadOnly` — dangerous anchors injected after the flip must be stripped (Issue #157 AC 3.5 cross-pin with AC 3.3 lifetime).',
    ).toEqual([]);
  });
});
