import { describe, it, expect, beforeEach } from 'vitest';
import { editorViewCtx } from '@milkdown/core';
import type { Editor } from '@milkdown/core';

// Issue #91 / AC 5.6 — Edit-mode frontmatter regression (web).
//
// Replicates the v0.2 desktop-editor frontmatter contract for the new
// web edit-mode codepath: when the user edits surrounding content,
// the YAML frontmatter block must round-trip BYTE-IDENTICALLY (no
// re-serialization, no normalization, no whitespace fiddling).
//
// The v0.2 desktop test (`src/__tests__/frontmatter.test.ts` →
// `Issue #48 — saveCurrent re-emits frontmatter byte-equal ahead of
// editor body`) covers `mountEditor` + `saveCurrent`. The web path
// uses `mountViewer` (`src/viewer.ts`) and a forthcoming edit-mode
// toggle / save flow (#92). For #91 we lock the round-trip *now* so
// when builder lifts the read-only restriction (5.1) the contract is
// already in place — and won't drift the way the desktop's
// `saveCurrent` did until #48 / #33 hardened it.
//
// Pinned testable seam — `getViewerMarkdown(host): string | null`,
// exported from `src/viewer.ts`. It returns the markdown buffer
// currently represented by the viewer mounted in `host`:
//
//   - frontmatter portion: BYTE-EQUAL to the frontmatter that was
//     captured at mount time (re-emitted verbatim, including fences
//     and any trailing whitespace on the closing line).
//   - body portion: the live ProseMirror document, serialized via
//     Milkdown's `serializerCtx` — the same path the eventual save
//     flow will use.
//   - returns null when no viewer is mounted in `host` (so a future
//     "save before mount" misuse can't silently pass).
//
// Why a sibling on `src/viewer.ts` instead of a new `src/edit-mode.ts`
// surface: AC 5.6 is the regression pin for the EXISTING viewer
// mount. The captured frontmatter and the mounted editor are both
// already viewer-state; lifting the getter into a separate module
// would introduce cross-module coordination just to satisfy the test
// shape. Builder is free to factor edit-mode wiring later (5.1+)
// without re-exporting; the getter stays where the state lives.
//
// Mocking: the existing `vitest.setup.ts` opts the suite into Tauri
// mode by default. These tests delete the Tauri global in beforeEach
// so the mountViewer path runs in a plain-browser context (no Tauri
// IPC needed for read-only mount + serialize).

describe('Issue #91 / AC 5.6 — web viewer round-trip preserves frontmatter byte-identically', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('exports `getViewerMarkdown` as a named function from src/viewer.ts', async () => {
    // RED until builder adds the sibling export. The "is a function"
    // half forbids a regression where a static `let getViewerMarkdown
    // = ''` mutable export accidentally typechecks against a `: any`
    // import alias.
    const mod = (await import('../viewer')) as unknown as {
      getViewerMarkdown?: unknown;
    };
    expect(
      typeof mod.getViewerMarkdown,
      'expected `getViewerMarkdown` to be exported as a function from src/viewer.ts (Issue #91 AC 5.6 — viewer must expose the round-trip getter so the test pin and the eventual save flow share one surface).',
    ).toBe('function');
  });

  it('returns null when no viewer is mounted in the host', async () => {
    // Pin the floor: a "save before mount" misuse must fail loudly,
    // not return a misleading empty string. Without this, a future
    // bug where the toolbar's Save button is reachable before the
    // viewer mounts would silently write `""` to the repo.
    const { getViewerMarkdown } = (await import('../viewer')) as unknown as {
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };
    const out = getViewerMarkdown(host);
    expect(
      out,
      'expected null when no viewer is mounted in host (Issue #91 AC 5.6 — the getter must distinguish "no viewer" from "empty doc" so a misuse doesn\'t silently overwrite a real spec with "").',
    ).toBeNull();
  });

  it('after mountViewer with a frontmatter doc, getViewerMarkdown returns the BYTE-EQUAL input (no edits, baseline round-trip)', async () => {
    // The cleanest baseline: mount → no edit → getter must return the
    // verbatim input. Any drift here (line-ending normalization,
    // collapsed blank lines, re-emitted YAML, etc.) will trip the
    // eventual save flow's byte-equal contract too.
    const { mountViewer, getViewerMarkdown } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };

    const original = '---\ntitle: Spec\nauthor: dean\n---\n# Body\n\nbody prose\n';
    await mountViewer(host, original);

    const out = getViewerMarkdown(host);
    expect(
      out,
      `expected getViewerMarkdown(host) to return the input verbatim after mount (Issue #91 AC 5.6 — baseline round-trip; if this fails, the captured-frontmatter + serialized-body re-assembly is dropping bytes). Got: ${JSON.stringify(out)}`,
    ).toBe(original);
  });

  it('after a programmatic body edit, the frontmatter prefix is byte-identical to the captured block', async () => {
    // The actual regression pin. Mount → edit body via a transaction
    // (programmatic dispatch is the same path Milkdown's input rules
    // / paste handler use, and it bypasses the read-only `editable:
    // () => false` guard — same shape as v0.2's desktop tests).
    // After the edit the body has changed, but the frontmatter MUST
    // be byte-identical to the original.
    const { mountViewer, getViewerMarkdown } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };

    const frontmatter = '---\ntitle: Spec\nauthor: dean\ndate: 2026-05-04\n---\n';
    const body = '# Body\n\nbody prose\n';
    const original = frontmatter + body;

    const editor = await mountViewer(host, original);

    // Insert "!" at end of the H1 — same shape as the v0.2 AC #3 test.
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const endOfFirstNode = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', endOfFirstNode));
    });
    // Flush ProseMirror's view-update microtasks (same pattern used
    // in `edit-toggle.test.ts` after dispatch).
    await Promise.resolve();
    await Promise.resolve();

    const out = getViewerMarkdown(host);
    expect(
      out,
      'expected getViewerMarkdown to return non-null after a successful mount + edit (Issue #91 AC 5.6).',
    ).not.toBeNull();

    // Frontmatter prefix is byte-identical to the input frontmatter.
    expect(
      out!.startsWith(frontmatter),
      `expected the round-trip output to START with the byte-identical frontmatter block (Issue #91 AC 5.6 — frontmatter must NOT be touched when the user edits surrounding content; this is the v0.2 #48 contract carried into the web path). Frontmatter expected: ${JSON.stringify(frontmatter)}. Output was: ${JSON.stringify(out)}`,
    ).toBe(true);

    // Body must reflect the edit. Without this assertion, an impl
    // that returns the verbatim original input (ignoring the edit)
    // would also pass the prefix check above.
    expect(
      out!,
      `expected the round-trip output to include the edited body (the inserted "!" must reach the serialized body). Output was: ${JSON.stringify(out)}`,
    ).toContain('Body!');
  });

  it('a doc without frontmatter does not gain a leading `---` block on round-trip', async () => {
    // Negative pin: an over-eager getter that always prepends "---\n"
    // would fail this. Without it, a doc without frontmatter could
    // get one mid-flight.
    const { mountViewer, getViewerMarkdown } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };

    const original = '# Just body\n\nplain prose, no frontmatter\n';
    await mountViewer(host, original);

    const out = getViewerMarkdown(host);
    expect(
      out,
      'expected non-null output for a successfully-mounted no-frontmatter doc.',
    ).not.toBeNull();
    expect(
      out!.startsWith('---'),
      `expected the output to NOT start with "---" when the input had no frontmatter (Issue #91 AC 5.6 — captured frontmatter is null in this case; nothing should be prepended). Output was: ${JSON.stringify(out)}`,
    ).toBe(false);
    // Sanity: the body content reaches the round-trip.
    expect(out!).toContain('Just body');
  });

  it('frontmatter with trailing whitespace on the closing fence round-trips byte-equal (whitespace preservation)', async () => {
    // The v0.2 frontmatter parser treats `---   ` (trailing spaces on
    // the closing fence) as a valid close. The captured raw block
    // INCLUDES those trailing spaces — re-emitting must preserve
    // them. A naïve re-emitter that calls `.trim()` would silently
    // collapse this and fail the byte-equal contract.
    const { mountViewer, getViewerMarkdown } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };

    const frontmatter = '---\ntitle: x\n---   \n';
    const original = frontmatter + '# body\n';
    await mountViewer(host, original);

    const out = getViewerMarkdown(host);
    expect(
      out!.startsWith(frontmatter),
      `expected the trailing-whitespace closing fence to round-trip byte-equal (Issue #91 AC 5.6 — frontmatter is captured RAW including trailing whitespace; re-emit must NOT trim). Frontmatter: ${JSON.stringify(frontmatter)}. Output: ${JSON.stringify(out)}`,
    ).toBe(true);
  });

  it('a malformed-YAML frontmatter passes through verbatim (no panel, body == original input)', async () => {
    // Same pass-through behavior as v0.2's parseFrontmatter: malformed
    // YAML → no frontmatter capture, body == original input. The
    // round-trip must NOT silently reformat or lose the malformed
    // block — if the user opens it, the unchanged bytes must come
    // back out.
    const { mountViewer, getViewerMarkdown } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };

    // Unclosed bracket → js-yaml throws → parseFrontmatter pass-through.
    const malformed = '---\ntitle: [unclosed\n---\n# body\n';
    await mountViewer(host, malformed);

    const out = getViewerMarkdown(host);
    expect(
      out,
      'expected non-null output even when the frontmatter is malformed (mount succeeded; round-trip must too).',
    ).not.toBeNull();
    // The malformed YAML lands in the editor body (pass-through). The
    // round-trip must contain the literal "title: [unclosed" line.
    expect(
      out!,
      `expected the malformed frontmatter to round-trip unchanged in the body (Issue #91 AC 5.6 — pass-through means the "---" lines render as a thematic break / setext heading inside the editor; the round-trip must keep them). Output: ${JSON.stringify(out)}`,
    ).toContain('title: [unclosed');
  });
});
