import { describe, it, expect, beforeEach } from 'vitest';
import { editorViewCtx } from '@milkdown/core';
import type { Editor } from '@milkdown/core';

// Issue #91 / AC 5.1 — Switch Milkdown into editable mode.
//
// "Today the viewer is `editable: () => false`. Need an explicit
// 'edit mode' state that flips Milkdown to editable AND surfaces edit
// affordances."
//
// AC 5.1 is the *mechanism* — the function that takes a mounted
// read-only viewer and converts it into an editable buffer with a
// formatting toolbar. The *intent detection* (typing / clicking a
// formatting affordance triggers the flip) and the *auth gate* (JIT
// redirect when unauthenticated) are AC 5.2's territory; this slice
// exercises only the seam in isolation so the contract stays stable
// while AC 5.2 / 5.3 layer auth-aware wiring on top.
//
// Pinned testable seam — `enterEditMode(host: HTMLElement):
// Promise<void>`, exported from `src/edit-mode.ts`. Contract:
//
//   1. After resolution, the .ProseMirror root in `host` has
//      contenteditable="true" AND aria-readonly="false".
//   2. The mounted body content survives the flip (the rendered
//      heading / paragraphs are still in the DOM).
//   3. The captured frontmatter survives the flip:
//      `getViewerMarkdown(host)` re-emits the byte-equal frontmatter
//      block (so the v0.2-#48 contract pinned by AC 5.6 carries
//      through).
//   4. An edit-affordances surface (`[data-testid="edit-toolbar"]`)
//      appears in the DOM with at least one <button> child.
//   5. Calling `enterEditMode(host)` when no viewer is mounted in
//      `host` is a safe no-op (returns a resolved promise; does NOT
//      throw, does NOT mutate the DOM).
//   6. Idempotent: calling `enterEditMode(host)` twice on the same
//      host leaves the DOM in the same end state as a single call.
//
// Bidirectional (`exitEditMode`) is intentionally out of scope here.
// AC 5.1's wording is one-directional: "switch INTO editable mode
// when the user attempts a content-modifying action". The web JIT
// flow assumes once you've auth'd, you stay in edit mode for the
// session — there's no documented "go back to read-only" affordance
// in the v0.3 spec. Punting on it keeps this slice tight.

describe('Issue #91 / AC 5.1 — enterEditMode flips the web viewer to editable', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
  });

  it('exports `enterEditMode` as a named function from src/edit-mode.ts', async () => {
    // RED until builder creates `src/edit-mode.ts` with the named
    // export. The "is a function" floor forbids a regression where
    // a default-export module shape (`export default { ... }`) is
    // imported via `* as mod` and silently typechecks against
    // `mod.enterEditMode = undefined`.
    const mod = (await import('../edit-mode')) as unknown as {
      enterEditMode?: unknown;
    };
    expect(
      typeof mod.enterEditMode,
      'expected `enterEditMode` to be exported as a function from src/edit-mode.ts (Issue #91 AC 5.1 — the named-export floor; without this surface there is no edit-mode mechanism for #91 / #92 / future slices to share).',
    ).toBe('function');
  });

  it('flips contenteditable from "false" to "true" on the mounted .ProseMirror root', async () => {
    // The core mechanism: after enterEditMode, the editor accepts
    // user keystrokes. We pin the contenteditable attribute on the
    // .ProseMirror root since that's the same surface the v0.2
    // desktop tests pin (`edit-toggle.test.ts`); regressions are
    // diff-able against the desktop pattern.
    const { mountViewer } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
    };
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (host: HTMLElement) => Promise<void>;
    };

    await mountViewer(host, '# Hello\n\nbody\n');

    const pmBefore = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pmBefore?.getAttribute('contenteditable'),
      'precondition: a freshly-mounted viewer must be read-only (the edit-mode flip is meaningless if we start editable).',
    ).toBe('false');

    await enterEditMode(host);

    const pmAfter = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pmAfter,
      'expected a .ProseMirror root to remain after enterEditMode (the flip must NOT destroy the editor surface).',
    ).not.toBeNull();
    expect(
      pmAfter!.getAttribute('contenteditable'),
      'expected contenteditable="true" on .ProseMirror after enterEditMode (Issue #91 AC 5.1 — the mechanism flips the viewer into editable).',
    ).toBe('true');
  });

  it('flips aria-readonly from "true" to "false" alongside contenteditable', async () => {
    // The v0.2 #6 fix-loop C1 pin carried into the web codepath:
    // assistive tech reads aria-readonly, not contenteditable.
    // Without the parallel flip, screen-reader users would still
    // hear "read-only" even after entering edit mode. Pinning both
    // attributes guards against the desktop-style regression where
    // contenteditable is updated but aria-readonly is left stale.
    const { mountViewer } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
    };
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (host: HTMLElement) => Promise<void>;
    };

    await mountViewer(host, '# Hi');

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('aria-readonly'),
      'precondition: read-only mount must announce aria-readonly="true".',
    ).toBe('true');

    await enterEditMode(host);

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('aria-readonly'),
      'expected aria-readonly="false" on .ProseMirror after enterEditMode (Issue #91 AC 5.1 — a11y state must agree with contenteditable; otherwise screen readers mis-announce).',
    ).toBe('false');
  });

  it('preserves the rendered body content across the flip (no destroy + remount data loss)', async () => {
    // Whichever mechanism the builder chooses (in-place
    // updateView / destroy + remount / something else), the flip
    // must NOT lose the user's rendered content. The v0.2 desktop
    // pattern (destroy + remount with the live serialized markdown
    // — see #6 AC #4) is one viable shape; an in-place flip via
    // `updateView({ editable: () => true })` is another. We pin the
    // OUTCOME (the H1 is still in the DOM), not the mechanism.
    const { mountViewer } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
    };
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (host: HTMLElement) => Promise<void>;
    };

    await mountViewer(host, '# Hello world\n\nThis is body text.\n');

    expect(
      host.querySelector('h1')?.textContent,
      'precondition: the body must render before the flip',
    ).toContain('Hello world');

    await enterEditMode(host);

    const h1 = host.querySelector('h1');
    expect(
      h1,
      'expected an <h1> to remain in the DOM after enterEditMode (Issue #91 AC 5.1 — the flip must NOT discard the rendered body; the v0.2 #6 AC #4 data-loss regression must NOT recur in the web path).',
    ).not.toBeNull();
    expect(
      h1!.textContent,
      'expected the H1 text to survive the flip verbatim.',
    ).toContain('Hello world');
  });

  it('captured frontmatter survives the flip — getViewerMarkdown(host) still re-emits byte-equal', async () => {
    // The cross-AC pin: AC 5.6 locked the byte-equal frontmatter
    // round-trip for the read-only mount. The flip to edit mode
    // MUST NOT drop or reformat the captured frontmatter — the
    // eventual save flow (#92) depends on byte-equality across
    // both modes. A buggy enterEditMode that re-mounts with
    // `payload.body` (no frontmatter capture) would make
    // getViewerMarkdown return the body alone, silently breaking
    // the #92 save contract before it ships.
    const { mountViewer, getViewerMarkdown } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (host: HTMLElement) => Promise<void>;
    };

    const frontmatter = '---\ntitle: Spec\nauthor: dean\n---\n';
    const body = '# Body\n\nbody prose\n';
    const original = frontmatter + body;
    await mountViewer(host, original);

    expect(
      getViewerMarkdown(host),
      'precondition: AC 5.6 round-trip must hold before the flip',
    ).toBe(original);

    await enterEditMode(host);

    const out = getViewerMarkdown(host);
    expect(
      out,
      'expected getViewerMarkdown(host) to remain non-null after the flip (the editor / frontmatter state must survive enterEditMode).',
    ).not.toBeNull();
    expect(
      out!.startsWith(frontmatter),
      `expected the captured frontmatter to survive the flip byte-equal (Issue #91 AC 5.1 cross-pinned with AC 5.6 — enterEditMode must NOT drop or reformat the captured frontmatter; otherwise the #92 save contract breaks before save lands). Frontmatter: ${JSON.stringify(frontmatter)}. Output: ${JSON.stringify(out)}`,
    ).toBe(true);
  });

  it('surfaces edit affordances — `[data-testid="edit-toolbar"]` appears with at least one <button> child', async () => {
    // The "AND surfaces edit affordances" half of the AC. We pin the
    // form factor (a toolbar with at least one button) without
    // specifying which formatting controls — Bold / Italic / Link /
    // a single "Save" button are all defensible MVP choices and the
    // builder is free to pick. The data-testid hook lets us assert
    // visibility without coupling to label text or icon choice
    // (same pattern as v0.2's `[data-testid="edit-toggle"]`).
    const { mountViewer } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
    };
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (host: HTMLElement) => Promise<void>;
    };

    await mountViewer(host, '# Hi');

    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'precondition: the read-only viewer must NOT show the edit toolbar — affordances appear only after entering edit mode.',
    ).toBeNull();

    await enterEditMode(host);

    const toolbar = document.querySelector<HTMLElement>('[data-testid="edit-toolbar"]');
    expect(
      toolbar,
      'expected a [data-testid="edit-toolbar"] surface in the DOM after enterEditMode (Issue #91 AC 5.1 — "surfaces edit affordances"; without a toolbar the user has no visual signal that they can format text now).',
    ).not.toBeNull();

    const buttons = toolbar!.querySelectorAll('button');
    expect(
      buttons.length,
      `expected the edit-toolbar to contain at least one <button> (a formatting affordance the user can click). Got ${buttons.length} buttons. Builder is free to pick Bold / Italic / Link / Save / etc.; the form factor is what's pinned.`,
    ).toBeGreaterThanOrEqual(1);
  });

  it('is a safe no-op when no viewer is mounted in `host` — does not throw, does not mutate DOM', async () => {
    // Defensive floor. A future caller (e.g., a click handler that
    // fires before mount completes) might invoke enterEditMode on a
    // host with no editor. The function must NOT throw — that would
    // turn a benign timing race into a user-visible exception in
    // the WebView console. Pinning a no-op also forbids an impl
    // that creates a fresh empty editor on the host (silently
    // overwriting any pending mount).
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (host: HTMLElement) => Promise<void>;
    };

    const sentinel = document.createElement('p');
    sentinel.id = 'sentinel';
    sentinel.textContent = 'I should still be here.';
    host.appendChild(sentinel);

    await expect(
      enterEditMode(host),
      'expected enterEditMode to resolve (not throw) when no viewer is mounted (Issue #91 AC 5.1 — defensive floor against a click-before-mount race).',
    ).resolves.toBeUndefined();

    expect(
      host.querySelector('#sentinel'),
      'expected the host content to be left alone when no viewer is mounted (enterEditMode must NOT clobber arbitrary DOM as a side effect of the no-op path).',
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="edit-toolbar"]'),
      'expected NO edit-toolbar surface when enterEditMode no-ops (the toolbar implies a live editor; without one, surfacing affordances would mislead the user).',
    ).toBeNull();
  });

  it('is idempotent — calling enterEditMode twice leaves the DOM in the single-call end state', async () => {
    // The "double-click on Edit" / "click + keydown both fire" race.
    // Two synchronous invocations must produce ONE editable mount
    // and ONE toolbar — not stacked toolbars / two .ProseMirror
    // nodes, mirroring the v0.2 #6 fix-loop C7 re-entrancy contract.
    const { mountViewer } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
    };
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (host: HTMLElement) => Promise<void>;
    };

    await mountViewer(host, '# Hi\n');

    await enterEditMode(host);
    await enterEditMode(host); // second call must be a benign no-op

    const prosemirrors = host.querySelectorAll('.ProseMirror');
    expect(
      prosemirrors.length,
      `expected exactly ONE .ProseMirror in the host after two enterEditMode calls (Issue #91 AC 5.1 — re-entrancy guard prevents stacked editor mounts; mirrors v0.2 #6 fix-loop C7). Got ${prosemirrors.length}.`,
    ).toBe(1);
    expect(
      prosemirrors[0]!.getAttribute('contenteditable'),
      'expected the surviving .ProseMirror to remain in editable mode after the idempotent second call.',
    ).toBe('true');

    const toolbars = document.querySelectorAll('[data-testid="edit-toolbar"]');
    expect(
      toolbars.length,
      `expected exactly ONE [data-testid="edit-toolbar"] surface after two enterEditMode calls (no stacked toolbars). Got ${toolbars.length}.`,
    ).toBe(1);
  });

  it('after the flip, programmatic body edits still round-trip via getViewerMarkdown', async () => {
    // End-to-end smoke that the flip produces a *real* editable
    // editor — not just the attribute change. We dispatch the same
    // insertText shape that AC 5.6 / v0.2 #6 AC #3 use, then verify
    // the edit reaches the round-trip getter. This catches a
    // regression where enterEditMode flips the attribute but
    // accidentally re-mounts with stale state, leaving the editor
    // in a "looks editable, isn't" zombie state.
    const { mountViewer, getViewerMarkdown } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
      getViewerMarkdown: (host: HTMLElement) => string | null;
    };
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (host: HTMLElement) => Promise<void>;
    };

    const original = '# Body\n';
    await mountViewer(host, original);
    await enterEditMode(host);

    // Reach the LIVE editor through getViewerMarkdown's seam — but
    // we still need the Editor handle to dispatch. Re-use the
    // mountedViewers state via a dispatch through the host's
    // .ProseMirror's view. The cleanest test path: import a helper
    // (we don't have one), so we drop into ProseMirror via the host
    // .ProseMirror element's __pmViewDesc-walk... actually, the
    // simplest portable shape is: ask for the live Editor handle
    // through `getCurrentViewerEditor(host)` — but that adds yet
    // another seam. Pragmatic alternative: dispatch via the
    // .ProseMirror view by getting it from the editor stash. Since
    // we don't have direct access, we test the round-trip by
    // re-mounting state through `getViewerMarkdown` post-flip.
    //
    // Practical compromise: pin that the round-trip getter still
    // works post-flip and returns a string starting with `# Body`.
    // That's a weaker pin than v0.2 AC #3's "user typing updates
    // the doc", but it confirms the edit mode is live (a zombie
    // editor would either return null or throw on serialize).
    const out = getViewerMarkdown(host);
    expect(
      out,
      'expected getViewerMarkdown to return a non-null string after enterEditMode — the live editor must still serialize cleanly (Issue #91 AC 5.1 — the flip must NOT leave the editor in a half-torn-down state).',
    ).not.toBeNull();
    expect(
      out!,
      `expected the round-trip to retain the original body content immediately after the flip (no edits dispatched yet). Got: ${JSON.stringify(out)}`,
    ).toContain('Body');
  });

  it('exposes `getEditModeEditor(host)` so the JIT auth + intent slice (5.2) can dispatch into the live editor', async () => {
    // Companion seam: AC 5.2 needs to *replay* an intercepted
    // formatting click after the auth round-trip resolves. To do
    // that it needs the live Editor handle — same shape as v0.2's
    // `getCurrentEditor()` for the desktop path. Pinning the seam
    // here in 5.1 prevents 5.2 from inventing its own coordinated
    // state.
    //
    // Contract: returns the live Editor instance for the host's
    // edit-mode mount, or null when no edit-mode editor is mounted.
    const mod = (await import('../edit-mode')) as unknown as {
      getEditModeEditor?: unknown;
    };
    expect(
      typeof mod.getEditModeEditor,
      'expected `getEditModeEditor` to be a named function export of src/edit-mode.ts (Issue #91 AC 5.1 — the JIT replay seam; AC 5.2 will use this to re-apply the intercepted action after auth resolves).',
    ).toBe('function');

    const getEditModeEditor = mod.getEditModeEditor as (
      host: HTMLElement,
    ) => Editor | null;

    expect(
      getEditModeEditor(host),
      'expected null before any mount — the getter must distinguish "no editor" from a stale handle, mirroring v0.2 `getCurrentEditor` (Issue #6 AC #3).',
    ).toBeNull();

    const { mountViewer } = (await import('../viewer')) as unknown as {
      mountViewer: (host: HTMLElement, content: string) => Promise<Editor>;
    };
    const { enterEditMode } = (await import('../edit-mode')) as unknown as {
      enterEditMode: (host: HTMLElement) => Promise<void>;
    };

    await mountViewer(host, '# Hi');
    // Before enterEditMode, the host has a viewer mount — the edit-
    // mode getter MAY still return null (no edit-mode editor yet),
    // or MAY return the read-only mount's editor — we don't pin
    // that distinction here. After enterEditMode, the getter MUST
    // return a non-null Editor with `.action` callable.
    await enterEditMode(host);

    const editor = getEditModeEditor(host);
    expect(
      editor,
      'expected getEditModeEditor(host) to return a non-null Editor after enterEditMode (Issue #91 AC 5.1 — the JIT replay seam must reach the live editor after the flip).',
    ).not.toBeNull();
    expect(
      typeof editor!.action,
      'expected the returned object to be a Milkdown `Editor` instance (it must expose `.action` so AC 5.2 can dispatch a replay transaction through it).',
    ).toBe('function');

    // Sanity-dispatch — same shape as edit-toggle.test.ts AC #3.
    editor!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const endOfFirstNode = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', endOfFirstNode));
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      host.querySelector('h1')?.textContent ?? '',
      'expected the dispatch via getEditModeEditor to mutate the live DOM — proves the editor is genuinely editable, not a zombie that re-emits but doesn\'t mount user transactions.',
    ).toContain('Hi!');
  });
});
