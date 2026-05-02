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

// ---------------------------------------------------------------------------
// Issue #7 — Cmd+S save flow (slice 2 / v0.2). The dirty-indicator half above
// pinned the read side of dirty tracking. The block below pins the WRITE
// side: a `saveCurrent()` async function and a `Cmd+S` (`metaKey + 's'`)
// keydown handler that drives it, both wiring through to the Rust
// `save_md_file` Tauri command via `invoke('save_md_file', { path, content })`.
//
// Scope notes for this slice:
//
//   - The save-failure BLOCKING ERROR DIALOG from spec.md is explicitly
//     deferred to a later slice that pairs with #50 (ACL extension for
//     `dialog:allow-message`). For this slice the failure path surfaces
//     via `console.error` and leaves `dirty` sticky-true. Tests pin the
//     sticky-dirty contract; the dialog test arrives with the dialog.
//
//   - The Save-As path (`currentFilePath === null`, e.g. template-new
//     buffer from #49) is deferred to slice 14. For now, Cmd+S on a
//     pathless buffer must NOT call invoke and must NOT clear dirty —
//     the buffer stays dirty and unsaved until a path is established.
//
//   - The `getMarkdown()` serialization happens via the editor's own
//     `serializerCtx`, the same way `toggleEditMode` already does it.
//     `saveCurrent()` does not require an externally-obtained
//     write-capable editor handle (#33 structural pin on the frontend
//     side; the Rust side already pins the IPC boundary).
// ---------------------------------------------------------------------------

describe('Issue #7 — `saveCurrent` named export + Cmd+S keydown wiring', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('exposes a named `saveCurrent` export that returns Promise<void>', async () => {
    // Pinned testable seam: `saveCurrent(): Promise<void>` is exported
    // as a named function from `src/main.ts`. It serializes the current
    // editor doc, invokes the `save_md_file` Tauri command with the
    // `currentFilePath` + serialized content, and resolves on success
    // (clearing dirty) or on failure (logging + leaving dirty sticky).
    //
    // Without this seam, save can only be tested through synthetic
    // keydown events — a brittle path that confuses save-flow regressions
    // with keybinding regressions. The named export gives reviewers a
    // single function to grep for and exercise.
    const mod = (await import('../main')) as unknown as {
      saveCurrent?: unknown;
    };
    expect(
      typeof mod.saveCurrent,
      'expected `saveCurrent` to be exported as a function from src/main.ts (Issue #7 — slice 2 save flow).',
    ).toBe('function');
  });

  it('saveCurrent() with currentFilePath set invokes save_md_file with the file path and serialized markdown, then clears dirty', async () => {
    // The central success path: open → edit → saveCurrent() → invoke is
    // called once with `{ path, content }`, dirty clears.
    const invokeMock = vi.fn(async () => undefined);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened, getCurrentEditor, isDirty, saveCurrent } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        isDirty: () => boolean;
        saveCurrent: () => Promise<void>;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    await handleFileOpened(
      { path: '/tmp/hashly-tests/doc.md', name: 'doc.md', content: '# Doc\n' },
      host,
    );

    // Toggle to edit + dispatch a real edit so dirty flips.
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));
    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const end = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', end));
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(isDirty(), 'precondition: dirty must be true after the edit').toBe(true);

    await saveCurrent();

    expect(
      invokeMock,
      'expected saveCurrent() to call invoke exactly once (Issue #7 — slice 2 save AC).',
    ).toHaveBeenCalledTimes(1);
    const call = invokeMock.mock.calls[0] as unknown as [string, { path: string; content: string }];
    expect(
      call[0],
      'expected invoke command name to be `save_md_file` (Issue #7 — matches Rust command registered via invoke_handler).',
    ).toBe('save_md_file');
    expect(
      call[1].path,
      'expected invoke args.path to be the currentFilePath set on file-open (Issue #7 — slice 2 in-place save uses the file\'s original path).',
    ).toBe('/tmp/hashly-tests/doc.md');
    const sentContent = call[1].content;
    expect(
      typeof sentContent,
      'expected invoke args.content to be a string (Issue #7 — Rust seam takes &str; the content must be already-serialized).',
    ).toBe('string');
    expect(
      sentContent.length,
      'expected invoke args.content to be non-empty (the editor had content; an empty save would silently truncate the file on disk).',
    ).toBeGreaterThan(0);
    // Substantive content pin: the edit we made (`!`) should be in
    // the serialized output. Without this, an impl that always sends
    // the original `defaultValueCtx` content would pass the type/length
    // checks above but defeat the round-trip AC.
    expect(
      sentContent,
      `expected the serialized content to reflect the in-memory edit ("!"); a regression that sends the on-load content would defeat the round-trip AC. Got content=${JSON.stringify(sentContent)}`,
    ).toContain('!');

    expect(
      isDirty(),
      'expected isDirty() === false after a successful save (Issue #7 — slice 2 AC: "After a successful save, the dirty indicator clears").',
    ).toBe(false);
    expect(
      document.title.startsWith(DIRTY_PREFIX),
      `expected document.title to NOT carry the dirty bullet after a successful save. Got: ${JSON.stringify(document.title)}`,
    ).toBe(false);
    // Belt: filename is still in the title.
    expect(
      document.title,
      `expected the title to still reflect the filename after save. Got: ${JSON.stringify(document.title)}`,
    ).toContain('doc.md');

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });

  it('saveCurrent() leaves dirty sticky-true when invoke rejects (failure does not clear dirty)', async () => {
    // The failure-path contract for THIS slice (the blocking dialog
    // arrives later with #50): an invoke rejection must NOT clear
    // dirty. The user's edits are still unsaved; the title bullet
    // must still warn them.
    const invokeMock = vi.fn(async () => {
      throw new Error('save_md_file failed: outside the allowed root');
    });
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened, getCurrentEditor, isDirty, saveCurrent } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        isDirty: () => boolean;
        saveCurrent: () => Promise<void>;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/hashly-tests/fail.md', name: 'fail.md', content: '# Fail\n' },
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
    expect(isDirty()).toBe(true);

    // The contract: saveCurrent does NOT throw on Rust-side failure
    // (matches openFileViaDialog's no-crash AC). The error surfaces
    // through console.error / non-blocking inline indicator instead.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      saveCurrent(),
      'expected saveCurrent() to RESOLVE (not throw) when invoke rejects (Issue #7 — failure path surfaces via console/inline, not via uncaught exception).',
    ).resolves.not.toThrow();
    errSpy.mockRestore();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(
      isDirty(),
      'expected isDirty() to REMAIN true after a failed save (Issue #7 — sticky-on-failure semantics; the user\'s edits are still unsaved and the title must warn them).',
    ).toBe(true);
    expect(
      document.title.startsWith(DIRTY_PREFIX),
      `expected document.title to STILL carry the dirty bullet after a failed save. Got: ${JSON.stringify(document.title)}`,
    ).toBe(true);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });

  it('saveCurrent() with NO currentFilePath (template-new buffer / pre-open) does NOT call invoke and does NOT clear dirty', async () => {
    // The Save-As deferred path: a buffer with no on-disk path (the
    // post-#49 template-new flow, or any pre-open state). For this
    // slice, Cmd+S on a path-less buffer is a no-op. Slice 14 routes
    // it through Save-As (`save:allow-save` ACL + native picker).
    //
    // Pinning the no-op now prevents an impl that defaults `path` to
    // a falsy / placeholder string and writes to e.g. `/Hashly` or
    // `./untitled.md` — both of which would either fail in the Rust
    // allow-list check or silently litter the user's home dir.
    const invokeMock = vi.fn(async () => undefined);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, isDirty, saveCurrent } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      isDirty: () => boolean;
      saveCurrent: () => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    // No handleFileOpened — currentFilePath is null.

    await saveCurrent();

    expect(
      invokeMock,
      'expected invoke to NOT be called when there is no currentFilePath (Issue #7 — Save-As path is deferred to slice 14; pre-open Cmd+S is a no-op for v0.2).',
    ).not.toHaveBeenCalled();
    expect(
      isDirty(),
      'expected isDirty() to remain false (no edits, nothing to save).',
    ).toBe(false);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });

  it('Cmd+S keydown (metaKey + s) on the document drives saveCurrent() exactly once', async () => {
    // The keybinding wire-up: a single `keydown` listener installed in
    // bootstrap() catches Cmd+S (Mac) and Ctrl+S (cross-platform). The
    // listener calls `e.preventDefault()` (so the WebView's default
    // "Save Page As" doesn't fire) and dispatches saveCurrent().
    const invokeMock = vi.fn(async () => undefined);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

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
      { path: '/tmp/hashly-tests/key.md', name: 'key.md', content: '# K\n' },
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
    expect(isDirty()).toBe(true);

    // Synthesize Cmd+S. Use a cancelable event so preventDefault is
    // observable — without preventDefault, a non-Tauri fallback (a
    // browser's Save Page As) would fire alongside our save.
    const ev = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);

    // The handler is async (fires saveCurrent() in the background).
    // Wait for the microtask queue + the invoke microtask.
    await new Promise((r) => setTimeout(r, 30));

    expect(
      ev.defaultPrevented,
      'expected the Cmd+S keydown handler to call preventDefault() (Issue #7 — without preventDefault, the WebView\'s default "Save Page As" can fire alongside Hashly\'s save).',
    ).toBe(true);

    expect(
      invokeMock,
      'expected Cmd+S to drive exactly one invoke call (Issue #7 — slice 2 keybinding wire-up).',
    ).toHaveBeenCalledTimes(1);
    const cmdSentByKey = (invokeMock.mock.calls[0] as unknown as [string, unknown])[0];
    expect(cmdSentByKey).toBe('save_md_file');

    expect(
      isDirty(),
      'expected isDirty() to clear after the Cmd+S-driven save resolved successfully.',
    ).toBe(false);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });

  it('Ctrl+S keydown (ctrlKey + s, no metaKey) ALSO drives saveCurrent() — cross-platform parity', async () => {
    // Mac users press Cmd+S; non-Mac users press Ctrl+S. Hashly is
    // mac-only per CLAUDE.md but the dev surface (vitest + jsdom)
    // and any future cross-platform contributor should still be able
    // to exercise save. Rather than gate on userAgent, we accept
    // either modifier. The cost is one extra branch in the handler;
    // the benefit is a stable test surface.
    const invokeMock = vi.fn(async () => undefined);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened, getCurrentEditor } = (await import(
      '../main'
    )) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
      getCurrentEditor: () => Editor | null;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/hashly-tests/c.md', name: 'c.md', content: '# C\n' },
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

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 30));

    expect(
      invokeMock,
      'expected Ctrl+S to also drive a save call (cross-platform parity).',
    ).toHaveBeenCalledTimes(1);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });

  it('saveCurrent() in READ mode does NOT call invoke even when dirty is sticky-true (Issue #33 save-time mode guard)', async () => {
    // Adversarial-review finding: the dirty-bit-side defense from
    // mountEditor (read-mode mounts get no dispatchTransaction wrapper)
    // only blocks the dirty *signal*, not the *outcome*. Without a
    // save-time mode guard, a sequence of (a) edit-mode → type → dirty=true,
    // (b) toggle back to read (dirty stays sticky), (c) programmatic
    // dispatch in read mode mutates view state, (d) Cmd+S — would
    // persist the read-mode mutation. The dispatchTransaction defense
    // didn't fire (read mode = no wrapper), so the user has no signal,
    // and saveCurrent happily serializes the now-mutated read-mode view.
    //
    // Closing the attack: saveCurrent must refuse to save when mode
    // isn't 'edit'. The persona walkthrough in spec.md shows the
    // user-Cmd+S path explicitly happening in edit mode ("they fix the
    // line in WYSIWYG, hit Cmd+S"); refusing read-mode saves matches
    // the documented workflow and closes the structural gap #33
    // names. (#33 is named for the write-handle bypass; the spec at
    // line 88 says it must be enforced once save exists.)
    const invokeMock = vi.fn(async () => undefined);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened, getCurrentEditor, isDirty, saveCurrent } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        isDirty: () => boolean;
        saveCurrent: () => Promise<void>;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/hashly-tests/m.md', name: 'm.md', content: '# M\n' },
      host,
    );

    // Edit-mode → type → dirty=true.
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));
    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const end = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', end));
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(isDirty(), 'precondition: dirty true after edit').toBe(true);

    // Toggle back to read. Dirty stays sticky-true.
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));
    expect(
      host.querySelector<HTMLElement>('.ProseMirror')?.getAttribute('contenteditable'),
      'precondition: editor must be in read mode after toggle-back',
    ).toBe('false');
    expect(isDirty(), 'precondition: dirty stays sticky-true through toggle-back').toBe(true);

    // Programmatic mutation in read mode — the #33 attack. The
    // dispatchTransaction wrapper is NOT installed (read mode),
    // so dirty stays whatever it was; view state is mutated.
    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const end = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('PWNED', end));
    });
    await new Promise((r) => setTimeout(r, 30));

    // Cmd+S in read mode. Save-time mode guard MUST refuse.
    await saveCurrent();

    expect(
      invokeMock,
      'expected saveCurrent() to NOT call invoke when mode is "read" (Issue #33 — save-time mode guard closes the read-mode-mutation-then-save attack vector). Without this guard, a programmatic mutation in read mode would be persisted by Cmd+S.',
    ).not.toHaveBeenCalled();

    // Sticky-dirty preserved — the user's prior real edits are still
    // unsaved and the title still warns. (This is correct: the read-
    // mode save was refused, but the actual edit-mode dirty is real
    // and shouldn't be cleared.)
    expect(
      isDirty(),
      'expected isDirty() to remain true after a refused read-mode save (the prior edit-mode edits are still unsaved).',
    ).toBe(true);
    expect(
      document.title.startsWith(DIRTY_PREFIX),
      `expected document.title to STILL carry the dirty bullet after a refused read-mode save. Got: ${JSON.stringify(document.title)}`,
    ).toBe(true);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });

  it('plain `s` keydown (no modifier) does NOT drive saveCurrent', async () => {
    // Defensive pin: a regression that listens on `key === 's'`
    // without the modifier check would fire on every literal 's'
    // typed in the editor. That would either spam invoke or — worse —
    // double-write the file on every keystroke.
    const invokeMock = vi.fn(async () => undefined);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      handleFileOpened: (
        payload: { path: string; name: string; content: string },
        host: HTMLElement,
      ) => Promise<void>;
    };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/hashly-tests/n.md', name: 'n.md', content: '# N\n' },
      host,
    );

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 30));

    expect(
      invokeMock,
      'expected a plain `s` keydown (no modifier) to NOT drive save (Issue #7 — modifier check is non-negotiable; without it, every literal `s` typed would fire a save).',
    ).not.toHaveBeenCalled();

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });
});
