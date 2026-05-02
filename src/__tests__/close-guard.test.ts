import { describe, it, expect, beforeEach, vi } from 'vitest';
import { editorViewCtx } from '@milkdown/core';
import type { Editor } from '@milkdown/core';

// Issue #8 — Unsaved-changes-on-close dialog (slice 3 / v0.2).
//
// AC (verbatim from the issue):
//   - Closing the window (red button or Cmd+W) with a dirty document shows
//     a native "Save / Don't Save / Cancel" dialog.
//   - Save  writes to disk and closes.
//   - Don't Save discards and closes.
//   - Cancel keeps the window open with edits intact.
//   - Closing a clean document closes immediately, no prompt.
//
// Implementation note encoded by these pins: Tauri 2's dialog plugin
// (`tauri-plugin-dialog v2.7`) only natively supports 2-button confirms
// (`ask` / `confirm` map to `message` and return `Promise<boolean>`).
// A 3-button "Save / Don't Save / Cancel" requires a custom WebView modal —
// implemented as an HTML5 `<dialog role="alertdialog">` with three
// buttons. The modal lives entirely in the WebView; it is invoked from
// `getCurrentWindow().onCloseRequested(...)`. The PRD note "Standard
// macOS behavior — use Tauri's close-requested event + native dialog"
// is satisfied by the close-requested event + a styled-native-looking
// modal — true 3-button native is unavailable in plugin v2.7.
//
// Pinned testable seams (named exports of `src/main.ts`):
//   - `confirmUnsavedClose(filename: string | null): Promise<'save' | 'discard' | 'cancel'>`
//     — renders the modal, returns the user's choice. Resolves to
//     'cancel' if the modal is dismissed (Esc, click outside).
//   - `handleCloseRequest(deps): Promise<void>` — pure decision function
//     wired to onCloseRequested. Takes injected deps so the test can
//     pass mocks instead of touching the real Tauri/window APIs.

describe('Issue #8 — `confirmUnsavedClose` named export renders 3-button modal', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('exposes a `confirmUnsavedClose` function returning a Promise', async () => {
    const mod = (await import('../main')) as unknown as { confirmUnsavedClose?: unknown };
    expect(
      typeof mod.confirmUnsavedClose,
      'expected `confirmUnsavedClose` to be exported as a function from src/main.ts (Issue #8 — slice 3 close-guard).',
    ).toBe('function');
  });

  it('renders a [role="alertdialog"] with three buttons whose labels are "Save", "Don\'t Save", and "Cancel"', async () => {
    const { confirmUnsavedClose } = (await import('../main')) as unknown as {
      confirmUnsavedClose: (filename: string | null) => Promise<'save' | 'discard' | 'cancel'>;
    };

    // Fire the modal (don't await — it stays open until a button is
    // clicked). We assert against the rendered DOM, then resolve.
    const promise = confirmUnsavedClose('spec.md');

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(
      dialog,
      'expected a [role="alertdialog"] element in the DOM after confirmUnsavedClose was invoked (Issue #8 — modal must be ARIA-labelled as alertdialog so screen readers announce it).',
    ).not.toBeNull();

    const buttons = Array.from(dialog!.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim() ?? '');
    expect(
      labels,
      `expected exactly three buttons labeled "Save", "Don't Save", "Cancel" inside the alertdialog. Got: ${JSON.stringify(labels)}`,
    ).toEqual(['Save', "Don't Save", 'Cancel']);

    // Defensive pin: the dialog must mention the filename so the user
    // knows WHICH document has unsaved changes (matches macOS native
    // unsaved-changes prompts: "Do you want to save the changes you
    // made in <filename>?").
    expect(
      dialog!.textContent ?? '',
      `expected the alertdialog body to mention the filename "spec.md" (Issue #8 — the user must know WHICH file is at risk). Got: ${JSON.stringify(dialog!.textContent)}`,
    ).toContain('spec.md');

    // Resolve the promise by clicking Cancel so the test cleans up.
    const cancelBtn = buttons.find((b) => b.textContent?.trim() === 'Cancel')!;
    cancelBtn.click();
    const choice = await promise;
    expect(choice).toBe('cancel');
  });

  it('handles a null filename by showing a generic "this document" wording (template-new buffer)', async () => {
    // Slice 14 (#49) opens an unsaved buffer with no path / no filename.
    // The close guard must still work — substitute a generic phrase.
    const { confirmUnsavedClose } = (await import('../main')) as unknown as {
      confirmUnsavedClose: (filename: string | null) => Promise<'save' | 'discard' | 'cancel'>;
    };

    const promise = confirmUnsavedClose(null);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(
      dialog.textContent ?? '',
      'expected the alertdialog body to fall back to a generic phrase (e.g. "this document" or "this untitled document") when filename is null.',
    ).toMatch(/document|untitled/i);

    dialog.querySelector<HTMLButtonElement>('button')!.click(); // any button to resolve
    await promise;
  });

  it('clicking "Save" resolves the promise with "save"', async () => {
    const { confirmUnsavedClose } = (await import('../main')) as unknown as {
      confirmUnsavedClose: (filename: string | null) => Promise<'save' | 'discard' | 'cancel'>;
    };

    const promise = confirmUnsavedClose('a.md');
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const saveBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Save',
    )!;
    saveBtn.click();
    expect(await promise).toBe('save');
  });

  it('clicking "Don\'t Save" resolves the promise with "discard"', async () => {
    const { confirmUnsavedClose } = (await import('../main')) as unknown as {
      confirmUnsavedClose: (filename: string | null) => Promise<'save' | 'discard' | 'cancel'>;
    };

    const promise = confirmUnsavedClose('a.md');
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const discardBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === "Don't Save",
    )!;
    discardBtn.click();
    expect(await promise).toBe('discard');
  });

  it('clicking "Cancel" resolves the promise with "cancel"', async () => {
    const { confirmUnsavedClose } = (await import('../main')) as unknown as {
      confirmUnsavedClose: (filename: string | null) => Promise<'save' | 'discard' | 'cancel'>;
    };

    const promise = confirmUnsavedClose('a.md');
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const cancelBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel',
    )!;
    cancelBtn.click();
    expect(await promise).toBe('cancel');
  });

  it('removes the alertdialog from the DOM after resolution', async () => {
    // Cleanup pin: the modal must NOT linger after resolution. A
    // regression that leaves the dialog mounted would stack on the
    // next close attempt and confuse the user.
    const { confirmUnsavedClose } = (await import('../main')) as unknown as {
      confirmUnsavedClose: (filename: string | null) => Promise<'save' | 'discard' | 'cancel'>;
    };

    const promise = confirmUnsavedClose('a.md');
    const dialog = document.querySelector('[role="alertdialog"]')!;
    dialog.querySelector<HTMLButtonElement>('button')!.click();
    await promise;

    expect(
      document.querySelector('[role="alertdialog"]'),
      'expected the alertdialog to be removed from the DOM after the user picks an option (Issue #8 — leaving it mounted stacks on the next close attempt).',
    ).toBeNull();
  });
});

describe('Issue #8 — `handleCloseRequest` decision function', () => {
  // The decision function is a pure(-ish) async function with injected
  // deps. Tests pin the four state machines:
  //
  //   1. clean        →  no preventDefault, no save, no destroy call.
  //   2. dirty + save →  preventDefault, await saveCurrent, then destroy
  //                      iff save cleared dirty; if save failed, do NOT
  //                      destroy (user keeps their work).
  //   3. dirty + discard → preventDefault, no save, destroy.
  //   4. dirty + cancel  → preventDefault, no save, no destroy.

  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('exposes a `handleCloseRequest` function from src/main.ts', async () => {
    const mod = (await import('../main')) as unknown as { handleCloseRequest?: unknown };
    expect(
      typeof mod.handleCloseRequest,
      'expected `handleCloseRequest` to be exported from src/main.ts (Issue #8 — pure decision function with injected deps).',
    ).toBe('function');
  });

  it('clean document → does not preventDefault, does not save, does not destroy', async () => {
    const { handleCloseRequest } = (await import('../main')) as unknown as {
      handleCloseRequest: (deps: {
        event: { preventDefault: () => void };
        isDirty: () => boolean;
        currentFilename: () => string | null;
        confirm: (f: string | null) => Promise<'save' | 'discard' | 'cancel'>;
        save: () => Promise<void>;
        destroy: () => Promise<void>;
      }) => Promise<void>;
    };

    const event = { preventDefault: vi.fn() };
    const isDirty = vi.fn(() => false);
    const confirm = vi.fn(async () => 'cancel' as const);
    const save = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});

    await handleCloseRequest({
      event,
      isDirty,
      currentFilename: () => 'x.md',
      confirm,
      save,
      destroy,
    });

    expect(event.preventDefault, 'clean → no preventDefault').not.toHaveBeenCalled();
    expect(confirm, 'clean → no confirm prompt').not.toHaveBeenCalled();
    expect(save, 'clean → no save').not.toHaveBeenCalled();
    expect(destroy, 'clean → no destroy (the OS handles the close)').not.toHaveBeenCalled();
  });

  it('dirty + Save → preventDefault, save called, destroy called only if save cleared dirty', async () => {
    const { handleCloseRequest } = (await import('../main')) as unknown as {
      handleCloseRequest: (deps: {
        event: { preventDefault: () => void };
        isDirty: () => boolean;
        currentFilename: () => string | null;
        confirm: (f: string | null) => Promise<'save' | 'discard' | 'cancel'>;
        save: () => Promise<void>;
        destroy: () => Promise<void>;
      }) => Promise<void>;
    };

    const event = { preventDefault: vi.fn() };
    let dirtyState = true;
    const isDirty = vi.fn(() => dirtyState);
    const confirm = vi.fn(async () => 'save' as const);
    const save = vi.fn(async () => {
      dirtyState = false; // simulate successful save
    });
    const destroy = vi.fn(async () => {});

    await handleCloseRequest({
      event,
      isDirty,
      currentFilename: () => 'x.md',
      confirm,
      save,
      destroy,
    });

    expect(event.preventDefault, 'dirty → preventDefault always').toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      destroy,
      'save succeeded (dirty cleared) → destroy called',
    ).toHaveBeenCalledTimes(1);
  });

  it('dirty + Save BUT save fails (dirty stays sticky) → preventDefault + save called but destroy NOT called', async () => {
    // Critical UX pin: a failed save must NOT close the window.
    // Otherwise the user picks Save, the save fails (e.g. read-only
    // filesystem, permission denied), the window closes anyway, and
    // the work is silently lost. Sticky-dirty + no-destroy is the
    // safe default until the save-failure dialog (paired with #50
    // ACL extension) lands and gives the user a Save As… escape.
    const { handleCloseRequest } = (await import('../main')) as unknown as {
      handleCloseRequest: (deps: {
        event: { preventDefault: () => void };
        isDirty: () => boolean;
        currentFilename: () => string | null;
        confirm: (f: string | null) => Promise<'save' | 'discard' | 'cancel'>;
        save: () => Promise<void>;
        destroy: () => Promise<void>;
      }) => Promise<void>;
    };

    const event = { preventDefault: vi.fn() };
    const isDirty = vi.fn(() => true); // stays sticky-true through the save attempt
    const confirm = vi.fn(async () => 'save' as const);
    const save = vi.fn(async () => {
      // saveCurrent swallows invoke rejections (logs to console) and
      // leaves dirty sticky-true. So `save` resolves but isDirty()
      // still returns true.
    });
    const destroy = vi.fn(async () => {});

    await handleCloseRequest({
      event,
      isDirty,
      currentFilename: () => 'x.md',
      confirm,
      save,
      destroy,
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      destroy,
      'save failed (dirty still true) → destroy MUST NOT be called (otherwise user loses work).',
    ).not.toHaveBeenCalled();
  });

  it('dirty + Don\'t Save → preventDefault, no save, destroy called', async () => {
    const { handleCloseRequest } = (await import('../main')) as unknown as {
      handleCloseRequest: (deps: {
        event: { preventDefault: () => void };
        isDirty: () => boolean;
        currentFilename: () => string | null;
        confirm: (f: string | null) => Promise<'save' | 'discard' | 'cancel'>;
        save: () => Promise<void>;
        destroy: () => Promise<void>;
      }) => Promise<void>;
    };

    const event = { preventDefault: vi.fn() };
    const isDirty = vi.fn(() => true);
    const confirm = vi.fn(async () => 'discard' as const);
    const save = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});

    await handleCloseRequest({
      event,
      isDirty,
      currentFilename: () => 'x.md',
      confirm,
      save,
      destroy,
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(save, 'discard path → save NOT called').not.toHaveBeenCalled();
    expect(destroy, 'discard path → destroy called').toHaveBeenCalledTimes(1);
  });

  it('dirty + Cancel → preventDefault, no save, no destroy (window stays open)', async () => {
    const { handleCloseRequest } = (await import('../main')) as unknown as {
      handleCloseRequest: (deps: {
        event: { preventDefault: () => void };
        isDirty: () => boolean;
        currentFilename: () => string | null;
        confirm: (f: string | null) => Promise<'save' | 'discard' | 'cancel'>;
        save: () => Promise<void>;
        destroy: () => Promise<void>;
      }) => Promise<void>;
    };

    const event = { preventDefault: vi.fn() };
    const isDirty = vi.fn(() => true);
    const confirm = vi.fn(async () => 'cancel' as const);
    const save = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});

    await handleCloseRequest({
      event,
      isDirty,
      currentFilename: () => 'x.md',
      confirm,
      save,
      destroy,
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(save, 'cancel → no save').not.toHaveBeenCalled();
    expect(destroy, 'cancel → no destroy; window stays open').not.toHaveBeenCalled();
  });
});
