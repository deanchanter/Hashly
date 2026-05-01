import { describe, it, expect, beforeEach, vi } from 'vitest';
import { editorViewCtx } from '@milkdown/core';
import type { Editor } from '@milkdown/core';

// Issue #7 — Dirty indicator + Cmd+S save (slice 2 / v0.2).
//
// This file pins the dirty-indicator half of #7. The save half lands in
// follow-up tests once dirty tracking is in place. The two halves are
// separated because dirty tracking is a Milkdown-listener / dispatchTx
// concern that lives entirely in the frontend, while save is a
// frontend↔Rust IPC pair — testing them together would conflate two
// unrelated regression classes.
//
// Pinned visual marker (per slice 2 AC + team-lead note "assert against
// the specific marker form, don't leave it loose"): dirty state is
// reflected in `document.title` carrying a leading `• ` prefix. So:
//
//   - clean:  `filename.md — Hashly`     (no prefix; matches the existing
//                                         title format from #4)
//   - dirty:  `• filename.md — Hashly`   (U+2022 BULLET, then a single
//                                         space, then the existing title)
//
// Why a title-bar bullet: it is the platform-native UX for "doc has
// unsaved changes" on every Mac document app the persona uses (TextEdit,
// Pages, BBEdit, Numbers all use a dot-in-the-titlebar variant). The dot
// is also screen-reader-discoverable (it reads "bullet"), which is more
// accessible than a colour-only or icon-only signal. We pin the U+2022
// codepoint verbatim — a future copy-edit to e.g. an asterisk would
// either break the platform metaphor or land in a different spec note.
//
// Pinned testable seam: `isDirty(): boolean` is exported as a named
// function from `src/main.ts`. It returns the live dirty state — true
// when the in-memory doc has been edited since the last load/save,
// false otherwise. Without this seam, the #33 save-guard test (next AC)
// would have to string-parse the document title, which is fragile and
// couples two unrelated test classes.

const DIRTY_PREFIX = '• '; // "• " — bullet + space

describe('Issue #7 — `isDirty` named export', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('exposes a named `isDirty` export that returns boolean', async () => {
    // RED until `isDirty` is a named function export of src/main.ts.
    // The "returns boolean" half pins that the function is callable
    // (not a getter property) — a regression that exposes `isDirty`
    // as a `let isDirty: boolean` mutable export would technically
    // typecheck but would not be a function call.
    const mod = (await import('../main')) as unknown as {
      isDirty?: unknown;
    };
    expect(
      typeof mod.isDirty,
      'expected `isDirty` to be exported as a function from src/main.ts (Issue #7).',
    ).toBe('function');

    const result = (mod.isDirty as () => boolean)();
    expect(
      typeof result,
      'expected isDirty() to return a boolean (Issue #7 — the dirty bit is the gate for the #33 save guard and the #7 save handler; non-boolean returns are a contract violation).',
    ).toBe('boolean');
  });

  it('returns false before any mount has happened (no doc → not dirty)', async () => {
    // The semantic floor: with no doc loaded, there's nothing to be
    // dirty about. Pinning false here also forbids a "default true"
    // implementation (e.g. `let isDirty = true; export const isDirty
    // = () => true`) that would falsely report dirty before any edit.
    const { isDirty } = (await import('../main')) as unknown as {
      isDirty: () => boolean;
    };
    expect(
      isDirty(),
      'expected isDirty() === false before any mount (Issue #7 — the dirty bit must be initialized to false; a default-true impl would block save on the very first frame and confuse the user).',
    ).toBe(false);
  });
});

describe('Issue #7 — dirty indicator on file-open / clean baseline', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('handleFileOpened leaves document.title WITHOUT the `• ` prefix and isDirty === false', async () => {
    // Loading a doc from disk is the canonical clean state. The title
    // must reflect the file but NOT the dirty bullet — the user just
    // opened it; they haven't changed anything.
    const { handleFileOpened, isDirty } = (await import('../main')) as unknown as {
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
      isDirty: () => boolean;
    };

    await handleFileOpened(
      { path: '/tmp/spec.md', name: 'spec.md', content: '# Hello' },
      host,
    );

    expect(
      document.title.startsWith(DIRTY_PREFIX),
      `expected document.title to NOT start with the dirty bullet ${JSON.stringify(DIRTY_PREFIX)} after a fresh handleFileOpened (Issue #7 — opening a file is the canonical clean state). Got: ${JSON.stringify(document.title)}`,
    ).toBe(false);
    expect(
      isDirty(),
      'expected isDirty() === false after handleFileOpened — the doc was just loaded, nothing has been edited (Issue #7).',
    ).toBe(false);
    // Belt: the existing #4 title contract still holds.
    expect(
      document.title,
      'expected the existing #4 title contract to remain — `<filename> — Hashly` shape with the file name.',
    ).toContain('spec.md');
  });

  it('toggling read→edit (without typing) does NOT mark the doc dirty', async () => {
    // The toggle destroys + re-mounts the editor to flip mode. That
    // re-mount internally serializes the current doc and feeds it as
    // the new editor's initial value — that should NOT count as an
    // edit. Without this pin, every toggle would falsely mark dirty
    // and Cmd+S would write the file even when the user only looked
    // at it.
    const { bootstrap, handleFileOpened, isDirty } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
      isDirty: () => boolean;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    await handleFileOpened(
      { path: '/tmp/h.md', name: 'h.md', content: '# Hello' },
      host,
    );

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: must be in edit mode after the toggle click',
    ).toBe('true');

    expect(
      isDirty(),
      'expected isDirty() === false after toggling read→edit WITHOUT any typing (Issue #7 — toggle is not an edit; flagging dirty here would defeat #33 save-mode-guard interactions).',
    ).toBe(false);
    expect(
      document.title.startsWith(DIRTY_PREFIX),
      `expected document.title to NOT carry the dirty bullet after a no-edit toggle. Got: ${JSON.stringify(document.title)}`,
    ).toBe(false);
  });
});

describe('Issue #7 — typing in edit mode flips dirty', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('after dispatching insertText in edit mode, isDirty === true and title gains the `• ` prefix', async () => {
    // The central AC. Dispatching a text-insertion transaction is the
    // jsdom-stable proxy for "the user typed" (jsdom does not synthesize
    // ProseMirror's beforeinput pipeline reliably; we use the same
    // technique as edit-toggle.test.ts AC #3). After the dispatch, both
    // observable surfaces (the title bullet and the isDirty() return)
    // must agree on dirty=true. Pinning both halves catches a regression
    // that updates the title without flipping the bit (or vice versa).
    const { bootstrap, handleFileOpened, getCurrentEditor, isDirty } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        isDirty: () => boolean;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    await handleFileOpened(
      { path: '/tmp/h.md', name: 'h.md', content: '# Hello' },
      host,
    );

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: must be in edit mode',
    ).toBe('true');
    expect(
      isDirty(),
      'precondition: isDirty must be false at the moment of typing (otherwise this test is not exercising the read→edit→type transition)',
    ).toBe(false);

    // Dispatch the edit. Wait long enough for any listener / dispatchTx
    // wrapper to fire and update the dirty state.
    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const endOfFirstNode = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', endOfFirstNode));
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 30));

    expect(
      isDirty(),
      'expected isDirty() === true after dispatching an edit transaction in edit mode (Issue #7 — the central dirty-tracking AC).',
    ).toBe(true);

    expect(
      document.title.startsWith(DIRTY_PREFIX),
      `expected document.title to start with the dirty bullet ${JSON.stringify(DIRTY_PREFIX)} after the edit (Issue #7). Got: ${JSON.stringify(document.title)}`,
    ).toBe(true);
    // The file-name half of the title must still be present — the
    // bullet PREFIXES, it does not REPLACE.
    expect(
      document.title,
      `expected the file name "h.md" to remain in the title alongside the dirty bullet (Issue #7 — bullet is a prefix, not a replacement). Got: ${JSON.stringify(document.title)}`,
    ).toContain('h.md');
  });

  it('after typing then toggling edit→read, dirty state PERSISTS (toggle does not save)', async () => {
    // Toggling back to read mode is NOT save. Dirty must remain true
    // until a successful save explicitly clears it. Without this pin,
    // a user who edits and then accidentally toggles back to read
    // would lose their dirty signal and miss the unsaved-on-close
    // dialog (#8) when they shut down.
    const { bootstrap, handleFileOpened, getCurrentEditor, isDirty } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        isDirty: () => boolean;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/h.md', name: 'h.md', content: '# Hello' },
      host,
    );

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));

    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const end = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', end));
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(isDirty(), 'precondition: dirty must be true before toggling back').toBe(true);

    toggle.click();
    await new Promise((r) => setTimeout(r, 80));

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: toggling back must put us in read mode',
    ).toBe('false');
    expect(
      isDirty(),
      'expected isDirty() to REMAIN true after toggling edit→read with unsaved edits (Issue #7 — toggle does not save; dirty persists across mode flips until #7 save handler clears it).',
    ).toBe(true);
    expect(
      document.title.startsWith(DIRTY_PREFIX),
      `expected document.title to STILL start with the dirty bullet after toggle-back (Issue #7). Got: ${JSON.stringify(document.title)}`,
    ).toBe(true);
  });
});

describe('Issue #7 — dirty resets on file-open boundary', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('opening a different file resets dirty to false (cross-file boundary; loses unsaved edits is the user accepting the open)', async () => {
    // The cross-file-boundary case: the user has unsaved edits on file A,
    // then File>Open lands them on file B. File B is fresh-from-disk —
    // its dirty state must be false. The lost edits on file A are the
    // user's call (slice #8 unsaved-on-close dialog can intercept the
    // close path; opening a different file is conceptually the same as
    // closing-without-saving). Pinning this guards against a regression
    // that leaks A's dirty state into B's session.
    const { bootstrap, handleFileOpened, getCurrentEditor, isDirty } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        isDirty: () => boolean;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    // File A: open + edit → dirty.
    await handleFileOpened(
      { path: '/tmp/A.md', name: 'A.md', content: '# A' },
      host,
    );
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));
    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const end = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', end));
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(isDirty(), 'precondition: file A must be dirty after edit').toBe(true);

    // File B: fresh open replaces the editor. Dirty must reset.
    await handleFileOpened(
      { path: '/tmp/B.md', name: 'B.md', content: '# B' },
      host,
    );

    expect(
      isDirty(),
      'expected isDirty() === false after opening file B (Issue #7 — fresh file-open is the canonical clean state; A\'s dirty bit must NOT leak into B\'s session).',
    ).toBe(false);
    expect(
      document.title.startsWith(DIRTY_PREFIX),
      `expected document.title to NOT start with the dirty bullet after opening file B. Got: ${JSON.stringify(document.title)}`,
    ).toBe(false);
    expect(
      document.title,
      `expected the title to reflect file B's name. Got: ${JSON.stringify(document.title)}`,
    ).toContain('B.md');
  });
});

describe('Issue #33 / #7 — programmatic view.dispatch in READ mode does NOT flip dirty', () => {
  // This is the dirty-bit-side defensive countermeasure for #33's "write-
  // handle bypass" threat. The save-time mode guard (refuse to write when
  // mode is 'read') is the second layer; this is the first. If the dirty
  // tracking only fires for edit-mode mounts, a programmatic dispatch in
  // read mode goes through ProseMirror's view but never reaches the dirty
  // listener — so even if the save guard is somehow bypassed, the user
  // would see a clean title and Cmd+S would treat the doc as already-saved
  // (it has nothing to write).
  //
  // Implementation hint for the builder (non-binding): only install the
  // dirty-tracking dispatchTransaction wrapper / listenerCtx subscription
  // for edit-mode mounts. Read-mode editors get NO wrapper, so a
  // `view.dispatch(tr)` from a malicious caller mutates state but cannot
  // signal dirty.

  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('dispatching insertText against the read-mode editor does NOT flip isDirty', async () => {
    const { bootstrap, handleFileOpened, getCurrentEditor, isDirty } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        isDirty: () => boolean;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    await handleFileOpened(
      { path: '/tmp/r.md', name: 'r.md', content: '# Read' },
      host,
    );

    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: editor must be mounted in READ mode (default on file-open per #6 AC #2)',
    ).toBe('false');
    expect(
      isDirty(),
      'precondition: dirty must start false on a fresh read-mode mount',
    ).toBe(false);

    // Programmatic bypass: dispatch a text-insertion transaction directly
    // against the view. ProseMirror does NOT block programmatic dispatches
    // even when `editable: () => false` — that's the #33 threat.
    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const end = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('BYPASS', end));
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(
      isDirty(),
      'expected isDirty() to REMAIN false after a programmatic dispatch in read mode (Issue #33 + #7 — the dirty-tracking listener must NOT be installed on read-mode mounts; this is the first defensive layer against the getCurrentEditor write-handle bypass).',
    ).toBe(false);
    expect(
      document.title.startsWith(DIRTY_PREFIX),
      `expected document.title to NOT carry the dirty bullet after a read-mode programmatic dispatch (Issue #33). Got: ${JSON.stringify(document.title)}`,
    ).toBe(false);
  });
});
