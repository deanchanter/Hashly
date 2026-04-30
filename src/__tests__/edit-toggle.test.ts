import { describe, it, expect, beforeEach, vi } from 'vitest';
import { editorViewCtx } from '@milkdown/core';
import type { Editor } from '@milkdown/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read style.css from disk rather than via Vite's `?raw` import. Reason:
// Vite 7 + Vitest 4 strip CSS imports through their CSS plugin BEFORE
// the `?raw` query is honored, returning an empty string. `fs.readFileSync`
// at test time produces the actual file bytes, matching the pattern used
// by `src-tauri/tests/frontend.rs` (the cargo-side static contract).
//
// Path is resolved relative to the test file so it works regardless of
// the cwd Vitest is launched from.
const STYLE_CSS_PATH = resolve(__dirname, '..', 'style.css');
const readStyleCss = (): string => readFileSync(STYLE_CSS_PATH, 'utf-8');

// Issue #6 — Read ↔ Edit toggle (WYSIWYG edit mode).
//
// AC #1: A visible toggle (button or menu item) switches between read-only
// and editable Milkdown.
//
// We pin the contract as a DOM <button> reachable via `[data-testid="edit-toggle"]`.
// Background:
//   - "Menu item" — i.e. a Tauri native menu item — cannot be exercised under
//     jsdom (Tauri's native menu APIs short-circuit / reject in non-Tauri
//     environments). The in-window button form is the testable contract; the
//     builder may ALSO wire a Tauri menu item alongside it, but the button is
//     what this test pins.
//   - The selector `[data-testid="edit-toggle"]` is a deliberate test-stable
//     hook. It lets the builder choose the visible label ("Edit", "Edit
//     mode", a pencil icon, etc.) without breaking the test, while still
//     pinning a reachable element. A semantic anchor (e.g. `aria-label`)
//     would also work, but we pin `data-testid` to keep the contract
//     orthogonal to label copy decisions.
//   - We pin `<button>` (not e.g. `<div role="button">`) so click + Enter +
//     Space activation come for free from the platform — preserving keyboard
//     accessibility without further wiring.

describe('Issue #6 AC #1 — visible read↔edit toggle button', () => {
  beforeEach(() => {
    // Reset module graph so `bootstrap()`'s module-level flags
    // (`dragDropGuardInstalled`, etc.) start fresh per test, matching the
    // pattern used by `src/__tests__/bootstrap.test.ts`.
    vi.resetModules();
    document.body.innerHTML = '<div id="editor"></div>';
    document.title = 'Hashly';
  });

  it('after bootstrap, the document contains a [data-testid="edit-toggle"] <button>', async () => {
    const { bootstrap } = (await import('../main')) as unknown as {
      bootstrap: () => void;
    };
    bootstrap();
    // Same wait pattern as `bootstrap.test.ts` — Milkdown's mount completes
    // across multiple macrotask boundaries in jsdom; 100 ms is empirically
    // safe and matches the prior art in this repo.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const toggle = document.querySelector<HTMLElement>('[data-testid="edit-toggle"]');
    expect(
      toggle,
      'expected a `[data-testid="edit-toggle"]` element after bootstrap (Issue #6 AC #1 — the toggle is the visible entry point to edit mode).',
    ).not.toBeNull();
    expect(
      toggle!.tagName,
      'expected the toggle to be a <button> so click + Enter/Space activation work natively (Issue #6 AC #1).',
    ).toBe('BUTTON');
    expect(
      toggle!.hasAttribute('disabled'),
      'expected the toggle to NOT be disabled by default — without an enabled toggle, the user has no path into edit mode (Issue #6 AC #1).',
    ).toBe(false);
  });

  it('clicking the toggle flips the .ProseMirror root from contenteditable="false" to "true"', async () => {
    const { bootstrap } = (await import('../main')) as unknown as {
      bootstrap: () => void;
    };
    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const editor = document.getElementById('editor')!;
    const proseMirror = editor.querySelector<HTMLElement>('.ProseMirror');
    expect(
      proseMirror,
      'precondition: editor must be mounted with a .ProseMirror root before the toggle is exercised',
    ).not.toBeNull();
    expect(
      proseMirror!.getAttribute('contenteditable'),
      'precondition: default state must be contenteditable="false" (Issue #6 AC #2 — read-only on open)',
    ).toBe('false');

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]');
    expect(
      toggle,
      'precondition: the [data-testid="edit-toggle"] button must exist before this test can exercise it',
    ).not.toBeNull();

    toggle!.click();
    // Allow ProseMirror's view-options update (or re-mount, depending on
    // implementation choice) to propagate before re-querying the DOM.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const proseMirrorAfter = editor.querySelector<HTMLElement>('.ProseMirror');
    expect(
      proseMirrorAfter,
      'expected a .ProseMirror root to remain after the toggle (the editor must still be mounted in edit mode — Issue #6 AC #1).',
    ).not.toBeNull();
    expect(
      proseMirrorAfter!.getAttribute('contenteditable'),
      'expected contenteditable="true" after clicking the toggle (Issue #6 AC #1 — the toggle puts the editor into edit mode).',
    ).toBe('true');
  });

  it('clicking the toggle a second time flips back to contenteditable="false"', async () => {
    const { bootstrap } = (await import('../main')) as unknown as {
      bootstrap: () => void;
    };
    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const editor = document.getElementById('editor')!;
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]');
    expect(
      toggle,
      'precondition: the [data-testid="edit-toggle"] button must exist',
    ).not.toBeNull();

    toggle!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      editor.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: first click must put the editor in edit mode',
    ).toBe('true');

    toggle!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      editor.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'expected contenteditable="false" after a second click (Issue #6 AC #1 — the toggle is bidirectional; once entered, edit mode must be exitable back to read mode).',
    ).toBe('false');
  });
});

// Issue #6 AC #2: Default state on file open is read-only.
//
// The two facets of this AC:
//   (a) `handleFileOpened` (the surface used by both File>Open and the
//       Tauri `menu-open-file` event listener) must mount the editor in
//       read-only mode regardless of any prior application state.
//   (b) Specifically, if the user has toggled into edit mode and THEN
//       opens a different file, the new file must come up read-only —
//       not inherit the "edit" mode from the prior session. This is the
//       cross-state boundary case that "default on file open" pins; it
//       guards against a regression that leaks `currentEditorMode` across
//       file boundaries.
//
// Both tests pin BOTH `contenteditable="false"` (keyboard-editability) and
// `aria-readonly="true"` (screen-reader announcement) on the new
// `.ProseMirror` root, matching the dual-attribute pattern established in
// `main.test.ts` for AC #3 of issue #18 / #21.

describe('Issue #6 AC #2 — default state on file open is read-only', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('handleFileOpened mounts the new editor in read-only mode (contenteditable="false", aria-readonly="true")', async () => {
    const { handleFileOpened } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    await handleFileOpened(
      { path: '/tmp/spec.md', name: 'spec.md', content: '# Spec' },
      host,
    );

    const pm = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pm,
      'precondition: a .ProseMirror root must be present after handleFileOpened',
    ).not.toBeNull();
    expect(
      pm!.getAttribute('contenteditable'),
      'expected contenteditable="false" on the .ProseMirror root after handleFileOpened (Issue #6 AC #2 — default-on-file-open is read-only).',
    ).toBe('false');
    expect(
      pm!.getAttribute('aria-readonly'),
      'expected aria-readonly="true" on the .ProseMirror root after handleFileOpened so screen readers announce read-only state (Issue #6 AC #2 + #21 a11y pin).',
    ).toBe('true');
  });

  it('after toggling to edit mode and then opening a different file, the new file is read-only (cross-state boundary)', async () => {
    // The interesting case: the user is mid-edit on file A and opens file
    // B. File B must come up read-only — the edit mode must NOT leak across
    // the file boundary. Without this contract, a contributor could ship an
    // impl that keeps `currentEditorMode = 'edit'` and the user lands inside
    // an editable view of someone else's file with no explicit handoff.
    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };
    bootstrap();
    // Wait long enough for the initial showcase mount to settle.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Step 1: enter edit mode on the initial doc.
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]');
    expect(toggle, 'precondition: toggle button must exist').not.toBeNull();
    toggle!.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: after the toggle click we must be in edit mode (otherwise this test is not exercising the cross-state case)',
    ).toBe('true');

    // Step 2: open a different file. The contract: the new file must come
    // up read-only.
    await handleFileOpened(
      { path: '/tmp/other.md', name: 'other.md', content: '# Brand New File' },
      host,
    );

    const pmNew = host.querySelector<HTMLElement>('.ProseMirror');
    expect(
      pmNew,
      'expected a .ProseMirror root after the second handleFileOpened (the new file must mount)',
    ).not.toBeNull();
    expect(
      pmNew!.getAttribute('contenteditable'),
      'expected contenteditable="false" on the freshly-opened file (Issue #6 AC #2 — default-on-file-open must be read-only EVEN WHEN the prior session was in edit mode; the mode must NOT leak across file boundaries).',
    ).toBe('false');
    expect(
      pmNew!.getAttribute('aria-readonly'),
      'expected aria-readonly="true" on the freshly-opened file (Issue #6 AC #2 — read-only a11y state is part of the on-open contract).',
    ).toBe('true');
  });

  it('after the cross-state file open, clicking the toggle correctly enters edit mode (the toggle is rebound to the new editor)', async () => {
    // Subtle but important: when handleFileOpened destroys the prior editor
    // and mounts a new one, the toggle button's click handler MUST end up
    // pointing at the new editor — otherwise a click no-ops or, worse,
    // tries to dispatch on a destroyed editor and throws. We pin this by
    // entering edit mode on file A, opening file B (now read-only — see
    // the test above), then clicking the toggle and asserting file B
    // becomes editable. This catches the "toggle holds a stale editor
    // reference" regression class.
    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };
    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;

    // Enter edit on file A.
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Open file B (resets to read mode per the test above).
    await handleFileOpened(
      { path: '/tmp/B.md', name: 'B.md', content: '# B' },
      host,
    );
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: file B must be read-only after open',
    ).toBe('false');

    // Click toggle on file B — must enter edit mode for file B's editor.
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'expected file B to enter edit mode after the toggle click — i.e. the toggle is rebound to the new editor instance after handleFileOpened, not still wired to the destroyed prior editor (Issue #6 AC #2 cross-state correctness).',
    ).toBe('true');
  });
});

// Issue #6 AC #3: In edit mode, user can type and the document updates
// in-memory.
//
// Driving a real keystroke against a contenteditable + ProseMirror under
// jsdom is unreliable — jsdom does not synthesize the beforeinput /
// MutationObserver pipeline ProseMirror uses to convert key events into
// transactions. The robust approximation is to dispatch a ProseMirror
// transaction directly via Milkdown's documented `editor.action(ctx =>
// ctx.get(editorViewCtx).dispatch(...))` API. This is the same path the
// production app exercises when slash commands, paste handlers, or any
// other plugin inserts text — so a passing test here proves the same
// mechanism that real typing flows through.
//
// We need a handle to the current Editor instance to dispatch. The
// test-stable surface for that is a small read-only getter exported from
// `src/main.ts`:
//
//   export function getCurrentEditor(): Editor | null
//
// It returns the module-scoped editor the toggle / handleFileOpened
// already track. No new state — pure accessor.

describe('Issue #6 AC #3 — in edit mode, user can type and the doc updates in-memory', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('exposes a `getCurrentEditor` named export that returns null before any mount', async () => {
    // RED until src/main.ts exports `getCurrentEditor`. The "returns null
    // before any mount" half pins the contract that the getter is a
    // read-only window into module state, NOT a side-effecting "create
    // editor on demand" factory — without that pin a regression that
    // returns a fresh empty Editor would silently break every other test
    // that expects null on miss.
    const mod = (await import('../main')) as unknown as {
      getCurrentEditor?: unknown;
    };
    expect(
      typeof mod.getCurrentEditor,
      'expected `getCurrentEditor` to be a named function export of src/main.ts (Issue #6 AC #3)',
    ).toBe('function');

    const editor = (mod.getCurrentEditor as () => Editor | null)();
    expect(
      editor,
      'expected getCurrentEditor() to return null before any mount has happened (Issue #6 AC #3 — the getter must be a read-only accessor, not a factory).',
    ).toBeNull();
  });

  it('after handleFileOpened, getCurrentEditor returns the live Editor instance', async () => {
    const { handleFileOpened, getCurrentEditor } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
      getCurrentEditor: () => Editor | null;
    };

    await handleFileOpened(
      { path: '/tmp/x.md', name: 'x.md', content: '# Hello' },
      host,
    );

    const editor = getCurrentEditor();
    expect(
      editor,
      'expected getCurrentEditor() to return a non-null Editor after handleFileOpened (Issue #6 AC #3 — the getter must track the same instance handleFileOpened mounts).',
    ).not.toBeNull();
    // Sanity: it really is a Milkdown Editor — `.action()` is the canonical
    // method on the Editor class.
    expect(
      typeof (editor as Editor).action,
      'expected the returned object to be a Milkdown `Editor` instance (it must expose the `.action()` method used to dispatch ctx-scoped operations).',
    ).toBe('function');
  });

  it('after entering edit mode, dispatching an insertText transaction updates the visible DOM', async () => {
    // The end-to-end AC #3 test:
    //   1. Open a file (read mode, default).
    //   2. Click the toggle → edit mode.
    //   3. Get the current Editor and dispatch `tr.insertText('!', endOfH1)`.
    //   4. The H1's text content must reflect the inserted character.
    //
    // We assert on the visible H1 (not on a serialized markdown round-trip)
    // because the AC's wording — "the document updates" — is observable in
    // the DOM. If the dispatch silently no-op'd, the H1 text would be
    // unchanged, which is the regression we want to catch. We pin the
    // ASCII character "!" to avoid any encoding-related flakiness in jsdom.
    const { handleFileOpened, bootstrap, getCurrentEditor } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
      bootstrap: () => void;
      getCurrentEditor: () => Editor | null;
    };

    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    await handleFileOpened(
      { path: '/tmp/h.md', name: 'h.md', content: '# Hello' },
      host,
    );

    // Enter edit mode.
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: the editor must be in edit mode before we can test that "user can type"',
    ).toBe('true');

    const editor = getCurrentEditor();
    expect(
      editor,
      'precondition: getCurrentEditor() must return the live editor after the toggle click (the toggle re-mount swaps the tracked editor — getCurrentEditor must point at the NEW one, not the destroyed prior instance)',
    ).not.toBeNull();

    // Dispatch an insertText transaction at the end of the H1's text. The
    // H1 is a single inline-content node; its text fragment ends at
    // `view.state.doc.content.size - 1` (one past the last text position
    // counts as the H1 end before its closing token). To stay
    // implementation-agnostic, we just append at the very end of the doc
    // by using `tr.insertText(text)` without a `from` argument — when no
    // position is given, ProseMirror inserts at the current selection,
    // which on initial mount is at the doc start. We instead position
    // explicitly at `endOfH1 = doc.firstChild!.content.size + 1` to land
    // inside the H1 just before its close — that way the assertion below
    // ("h1 contains 'Hello!'") is unambiguous.
    editor!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const firstChild = view.state.doc.firstChild;
      // firstChild is the H1 paragraph-equivalent; its content size = number
      // of text characters inside. Insert one position past content.size
      // (i.e. just before the closing token) places the new char at the
      // H1's end.
      const endOfFirstNode = (firstChild?.content.size ?? 0) + 1;
      const tr = view.state.tr.insertText('!', endOfFirstNode);
      view.dispatch(tr);
    });

    // Allow ProseMirror's view-update microtasks to flush.
    await Promise.resolve();
    await Promise.resolve();

    const h1 = host.querySelector('h1');
    expect(
      h1,
      'expected an <h1> to remain in the DOM after the dispatch (Issue #6 AC #3 — the edit must mutate, not destroy, the heading)',
    ).not.toBeNull();
    expect(
      h1!.textContent ?? '',
      'expected the H1 text to include the inserted "!" character (Issue #6 AC #3 — typing in edit mode must update the document in-memory; the DOM is the observable surface).',
    ).toContain('Hello!');
  });
});

// Issue #6 AC #4: Switching back to read mode preserves the in-memory
// edits (does not discard them or reload from disk).
//
// This is the round-trip / data-loss test. The implementation choice for
// edit mode is "destroy + re-mount with new mode" (AC #1's slice), and
// AC #4 is the assertion that round-tripping through that destroy+mount
// preserves user edits via Milkdown's `serializerCtx`. A regression that
// re-mounts using the ORIGINAL `payload.content` instead of the live
// markdown would silently delete the user's typing on toggle-back —
// arguably the worst possible UX bug for a "just made a quick edit" flow.
//
// We exercise THREE round-trip patterns:
//   1. Type a single character, toggle back: the character is preserved.
//   2. Type, toggle back to read, toggle to edit again: the edits are
//      still there at the second edit-mode entry (proves no "reload from
//      disk" on either toggle direction).
//   3. After preserving edits across one round-trip, the toggle in the
//      now-restored read view STILL works — this catches the regression
//      where preserving the markdown breaks the toggle's editor reference.

describe('Issue #6 AC #4 — toggling back to read mode preserves in-memory edits', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('typed character is preserved after toggling edit → read (single round-trip)', async () => {
    const { handleFileOpened, bootstrap, getCurrentEditor } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
      bootstrap: () => void;
      getCurrentEditor: () => Editor | null;
    };

    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    await handleFileOpened(
      { path: '/tmp/h.md', name: 'h.md', content: '# Hello' },
      host,
    );

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;

    // Enter edit mode.
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: must be in edit mode before typing',
    ).toBe('true');

    // Type "!" at end of H1.
    const editorEdit = getCurrentEditor()!;
    editorEdit.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const endOfFirstNode = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', endOfFirstNode));
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      host.querySelector('h1')?.textContent ?? '',
      'precondition: the edit must take effect in edit mode (otherwise this is testing AC #3 not AC #4)',
    ).toContain('Hello!');

    // Toggle back to read mode.
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: a second toggle click must return to read mode',
    ).toBe('false');

    // The edited character must still be present in the DOM. Without
    // serializer-based round-tripping, this would revert to "Hello" — i.e.
    // the original payload.content — discarding the user's edit.
    const h1 = host.querySelector('h1');
    expect(
      h1,
      'expected an <h1> in the read-mode DOM after toggle-back',
    ).not.toBeNull();
    expect(
      h1!.textContent ?? '',
      'expected the in-memory edit ("Hello!") to survive the read-mode toggle (Issue #6 AC #4 — the worst possible regression here is silently losing user edits; pin it hard).',
    ).toContain('Hello!');
    // Negative pin: the original "Hello" without "!" must NOT be the only
    // content — guards against an impl that re-mounts with payload.content.
    expect(
      h1!.textContent ?? '',
      'expected the H1 to NOT have reverted to the original "Hello" without the inserted "!" (Issue #6 AC #4 — this is the data-loss regression we are pinning).',
    ).not.toMatch(/^Hello\s*$/);
  });

  it('edits persist across a full edit→read→edit round-trip (no "reload from disk" on either direction)', async () => {
    // This sharpens the AC: AC #4 says "switching BACK to read mode
    // preserves edits". The natural follow-up question — and a plausible
    // regression class — is whether the NEXT toggle (read→edit) would
    // reload from the original payload.content. We pin it by entering
    // edit a SECOND time after the first round-trip and asserting the
    // edit is still there.
    const { handleFileOpened, bootstrap, getCurrentEditor } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
      bootstrap: () => void;
      getCurrentEditor: () => Editor | null;
    };

    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    await handleFileOpened(
      { path: '/tmp/h.md', name: 'h.md', content: '# Hello' },
      host,
    );

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;

    // Round 1: toggle to edit, type, toggle back.
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const endOfFirstNode = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', endOfFirstNode));
    });
    await Promise.resolve();
    await Promise.resolve();
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      host.querySelector('h1')?.textContent ?? '',
      'precondition: round 1 must end in read mode showing "Hello!"',
    ).toContain('Hello!');

    // Round 2: toggle to edit AGAIN.
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: a third toggle click must re-enter edit mode',
    ).toBe('true');

    expect(
      host.querySelector('h1')?.textContent ?? '',
      'expected the second edit-mode entry to STILL show "Hello!" (Issue #6 AC #4 — the toggle must NEVER reload from `payload.content`; the live in-memory doc is the source of truth on every toggle).',
    ).toContain('Hello!');
  });

  it('after a preserve-then-toggle-back round-trip, the toggle still works (no stale editor reference)', async () => {
    // After serializing-and-re-mounting, the module-scoped currentEditor
    // points at a NEW Editor instance. The toggle's click handler must
    // continue to dispatch against the live editor on subsequent clicks
    // (i.e. it can't have captured the original editor reference in a
    // closure). This test pins that contract by exercising 3 toggles in
    // a row after a single edit, asserting we end up in the expected
    // mode after each.
    const { handleFileOpened, bootstrap, getCurrentEditor } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
      bootstrap: () => void;
      getCurrentEditor: () => Editor | null;
    };

    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    await handleFileOpened(
      { path: '/tmp/h.md', name: 'h.md', content: '# Hello' },
      host,
    );

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    const pmAttr = () =>
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable');

    // → edit
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(pmAttr(), 'click 1: edit').toBe('true');

    // type
    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const endOfFirstNode = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', endOfFirstNode));
    });
    await Promise.resolve();
    await Promise.resolve();

    // → read (with edits)
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(pmAttr(), 'click 2: read (with edits preserved)').toBe('false');
    expect(host.querySelector('h1')?.textContent ?? '').toContain('Hello!');

    // → edit (no stale reference; must re-enter edit mode)
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      pmAttr(),
      'click 3: edit again — without rebinding to the new editor instance after the previous round-trip, this click would no-op or throw (Issue #6 AC #4 implication).',
    ).toBe('true');
    expect(host.querySelector('h1')?.textContent ?? '').toContain('Hello!');
  });
});

// =============================================================================
// FIX-LOOP TESTS — reviewer findings (C1–C7) on top of the AC #1–#4 baseline.
// =============================================================================

// C1 — Button reflects mode (label + aria-pressed).
//
// The reviewer noted: a toggle that visibly says "Edit" while the user is
// ALREADY in edit mode is a UX confusion (and an accessibility bug — a
// screen reader will announce the wrong action). The contract pinned here:
//   - Initial / read mode: `aria-pressed="false"` AND the textContent
//     identifies "Edit" as the next action.
//   - Edit mode: `aria-pressed="true"` AND textContent has CHANGED from
//     the read-mode label (we don't pin the exact string — "Read",
//     "View", "Done" are all defensible — but it must differ).
//   - Toggling back: both attributes return to their initial values.
// Folded-in: the `aria-readonly` attribute on the .ProseMirror root must
// flip alongside `contenteditable` (security non-critical: an inert
// `aria-readonly="true"` in edit mode would cause screen readers to
// silently mis-announce). Pinned in the same describe because it's the
// same toggle event.

describe('Issue #6 fix-loop C1 — toggle button reflects mode (aria-pressed + textContent)', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="editor"></div>';
    document.title = 'Hashly';
  });

  it('initial state: aria-pressed="false" and a non-empty textContent (read-mode label)', async () => {
    const { bootstrap } = (await import('../main')) as unknown as {
      bootstrap: () => void;
    };
    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]');
    expect(toggle, 'precondition: toggle button must exist').not.toBeNull();
    expect(
      toggle!.getAttribute('aria-pressed'),
      'expected aria-pressed="false" on initial mount (read mode is the unpressed/inactive state of the toggle — required so screen readers announce the correct toggle state; Issue #6 fix-loop C1).',
    ).toBe('false');
    expect(
      (toggle!.textContent ?? '').trim().length,
      'expected the toggle to have non-empty textContent so users can identify its action (Issue #6 fix-loop C1).',
    ).toBeGreaterThan(0);
  });

  it('after one click (entering edit mode): aria-pressed="true", textContent has changed, and .ProseMirror has aria-readonly="false"', async () => {
    const { bootstrap } = (await import('../main')) as unknown as {
      bootstrap: () => void;
    };
    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const editor = document.getElementById('editor')!;
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    const initialLabel = (toggle.textContent ?? '').trim();
    expect(
      initialLabel.length,
      'precondition: the initial label must be non-empty so the change-on-click assertion is meaningful',
    ).toBeGreaterThan(0);

    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(
      toggle.getAttribute('aria-pressed'),
      'expected aria-pressed="true" after click (edit mode is the pressed/active state of the toggle; Issue #6 fix-loop C1).',
    ).toBe('true');

    const editLabel = (toggle.textContent ?? '').trim();
    expect(
      editLabel,
      `expected the toggle textContent to CHANGE after entering edit mode (read-mode label was ${JSON.stringify(initialLabel)}, but it remained the same after click — users cannot tell what the next action is). Pin via change-on-click rather than a specific string so the builder can pick "Read" / "View" / "Done" freely. Issue #6 fix-loop C1.`,
    ).not.toBe(initialLabel);

    // Folded-in non-critical: aria-readonly must flip alongside
    // contenteditable. Without this, screen readers announce read-only
    // even though the user is now editing.
    const pm = editor.querySelector<HTMLElement>('.ProseMirror');
    expect(pm, 'precondition: .ProseMirror must remain in DOM after toggle').not.toBeNull();
    expect(
      pm!.getAttribute('aria-readonly'),
      'expected aria-readonly="false" on the .ProseMirror root in edit mode (folded-in security non-critical: the a11y state must agree with contenteditable; Issue #6 fix-loop C1 + non-critical S4).',
    ).toBe('false');
  });

  it('after two clicks (returning to read mode): aria-pressed flips back to "false" and textContent restores', async () => {
    const { bootstrap } = (await import('../main')) as unknown as {
      bootstrap: () => void;
    };
    bootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    const initialLabel = (toggle.textContent ?? '').trim();

    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(
      toggle.getAttribute('aria-pressed'),
      'expected aria-pressed="false" after returning to read mode — the toggle state is symmetric (Issue #6 fix-loop C1).',
    ).toBe('false');
    expect(
      (toggle.textContent ?? '').trim(),
      'expected the textContent to restore to the initial read-mode label after returning to read mode (Issue #6 fix-loop C1 — the toggle must not get stuck in the "edit" label after exiting edit mode).',
    ).toBe(initialLabel);
  });
});

// C3 — Cursor: `text` in edit mode.
//
// Read mode already pins `.ProseMirror { cursor: default }` (issue #15).
// In edit mode the user is typing — the cursor must be the I-beam (text)
// so the affordance matches. Without this, hovering an editable doc still
// shows the arrow cursor, which is genuinely confusing.
//
// Why a static-contract test on style.css rather than a runtime
// `getComputedStyle` assertion: jsdom's getComputedStyle implementation
// historically gaps on attribute selectors (`[contenteditable="true"]`),
// returning the value for the bare class rule instead. A static check
// against the file source avoids the jsdom ambiguity AND guards against
// a contributor commenting out the rule (we strip comments before
// matching, same defense as the cargo `frontend.rs` pins).

describe('Issue #6 fix-loop C3 — cursor is `text` in edit mode (CSS contract)', () => {
  // Strip /* ... */ and // comments from CSS — CSS only has /* */ per
  // spec, but the helper handles both safely. We then strip ALL whitespace
  // so a contributor's choice of formatting / line breaks does not break
  // the assertion.
  const stripCssComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const compact = (s: string): string => s.replace(/\s+/g, '');

  it('src/style.css contains a rule scoped to .ProseMirror[contenteditable="true"] (or analogous) with cursor: text', () => {
    const stripped = stripCssComments(readStyleCss());
    const norm = compact(stripped);

    // Accept either order of the compound selector. ProseMirror's edit
    // mode flips contenteditable to "true"; the rule must apply only
    // then, not in read mode (so the existing `.ProseMirror { cursor:
    // default }` rule continues to govern read mode).
    const hasOrderA = norm.includes('[contenteditable="true"].ProseMirror{cursor:text');
    const hasOrderB = norm.includes('.ProseMirror[contenteditable="true"]{cursor:text');
    // Single-quoted attribute selectors are also valid CSS.
    const hasOrderASingle = norm.includes("[contenteditable='true'].ProseMirror{cursor:text");
    const hasOrderBSingle = norm.includes(".ProseMirror[contenteditable='true']{cursor:text");

    expect(
      hasOrderA || hasOrderB || hasOrderASingle || hasOrderBSingle,
      `expected src/style.css to contain a rule like \`.ProseMirror[contenteditable="true"] { cursor: text; ... }\` so the I-beam shows in edit mode (Issue #6 fix-loop C3). The bare \`.ProseMirror { cursor: default }\` rule must continue to govern read mode — only the edit-mode rule needs adding. After comment-strip and whitespace-strip, style.css contained:\n${norm}`,
    ).toBe(true);
  });

  it('the edit-mode cursor rule has higher specificity than the read-mode rule (so edit mode wins)', () => {
    // The read-mode rule is `.ProseMirror { cursor: default }` (specificity
    // 0,0,1,0). The edit-mode rule must have higher specificity to win
    // when both apply. `[contenteditable="true"].ProseMirror` is 0,0,2,0,
    // which IS higher. We pin the form factor by asserting the edit
    // selector contains BOTH `.ProseMirror` AND `[contenteditable=...]`
    // (it's a compound, not a sibling/descendant rule that might lose to
    // an unrelated read-mode rule update). Without this, a contributor
    // could ship `.ProseMirror.editable { cursor: text }` which has the
    // same specificity as the read-mode rule and depends on source
    // ordering — fragile.
    const stripped = stripCssComments(readStyleCss());
    const norm = compact(stripped);

    // Find the substring containing the edit-mode rule (one of four forms
    // accepted in the prior test). Pull out the selector part — chars up
    // to the next `{`.
    const candidates = [
      '[contenteditable="true"].ProseMirror{',
      '.ProseMirror[contenteditable="true"]{',
      "[contenteditable='true'].ProseMirror{",
      ".ProseMirror[contenteditable='true']{",
    ];
    const found = candidates.find((c) => norm.includes(c));
    expect(
      found,
      'precondition: one of the four expected edit-mode selector forms must be present (failure here means the prior test should have caught it; this is a sanity check)',
    ).toBeDefined();
    // Both `.ProseMirror` and `[contenteditable=...]` must appear in the
    // selector before the `{` — i.e. compound, not a longer chain that
    // could include read-mode-equivalent specificity.
    const sel = found!.slice(0, -1); // drop trailing `{`
    expect(
      sel.includes('.ProseMirror') && sel.includes('contenteditable'),
      `expected the edit-mode cursor selector to be a compound of .ProseMirror AND [contenteditable=...] for higher specificity than the read-mode rule (Issue #6 fix-loop C3 — without this, source ordering decides which rule wins). Got selector: ${sel}`,
    ).toBe(true);
  });
});
