import { describe, it, expect, beforeEach, vi } from 'vitest';
import { editorViewCtx } from '@milkdown/core';
import type { Editor } from '@milkdown/core';

// Cross-slice critical (final adversarial review of milestone PR #70):
// the OPEN paths (File > Open / Finder double-click / File > New From
// Template) silently destroyed a dirty buffer. The close-guard from
// slice 3 only protected the close path — opening a different doc
// while dirty ALSO loses work. The fix wraps each entry point with
// `guardOpenAgainstDirty()`: prompt Save / Don't Save / Cancel; on
// save-failure (sticky dirty), do NOT proceed with the open.
//
// Tests pin the four state-machine branches per entry point:
//   - clean  → proceed (no prompt)
//   - dirty + cancel  → DO NOT proceed
//   - dirty + discard → proceed
//   - dirty + save (success) → proceed; current buffer is replaced
//   - dirty + save (failure) → DO NOT proceed
// Pinned for openFileViaDialog (the most-used entry); the other two
// entries (file-opened-by-os listener, newFromTemplate) share the
// helper so behavioral coverage transfers structurally.

describe('Issue: cross-slice — OPEN paths must not silently discard a dirty buffer', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'editor';
    document.body.appendChild(host);
    document.title = 'Hashly';
  });

  it('exports `guardOpenAgainstDirty` returning Promise<boolean>', async () => {
    const mod = (await import('../main')) as unknown as { guardOpenAgainstDirty?: unknown };
    expect(typeof mod.guardOpenAgainstDirty).toBe('function');
  });

  it('clean buffer → guardOpenAgainstDirty returns true without prompting', async () => {
    const { bootstrap, guardOpenAgainstDirty } = (await import('../main')) as unknown as {
      bootstrap: () => void;
      guardOpenAgainstDirty: () => Promise<boolean>;
    };
    bootstrap();
    await new Promise((r) => setTimeout(r, 100));

    const proceed = await guardOpenAgainstDirty();
    expect(proceed, 'clean buffer must proceed without prompt').toBe(true);
    expect(
      document.querySelector('[role="alertdialog"]'),
      'no modal must render for a clean buffer',
    ).toBeNull();
  });

  it('dirty buffer + Cancel → guardOpenAgainstDirty returns false; subsequent OPEN does not invoke read', async () => {
    const invokeMock = vi.fn(async () => undefined);
    const openMock = vi.fn(async () => '/tmp/should-not-open.md');
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: openMock,
      save: vi.fn(async () => null),
    }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened, getCurrentEditor, openFileViaDialog } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        openFileViaDialog: (host: HTMLElement) => Promise<void>;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/a.md', name: 'a.md', content: '# A\n' },
      host,
    );

    // Edit so dirty=true.
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="edit-toggle"]')!;
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));
    getCurrentEditor()!.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const end = (view.state.doc.firstChild?.content.size ?? 0) + 1;
      view.dispatch(view.state.tr.insertText('!', end));
    });
    await new Promise((r) => setTimeout(r, 30));

    // Trigger File > Open. The unsaved-changes prompt renders;
    // click Cancel.
    const openPromise = openFileViaDialog(host);
    // Wait one microtask for the modal to mount.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(
      dialog,
      'expected the unsaved-changes prompt to render before openFileViaDialog reads the file.',
    ).not.toBeNull();
    const cancelBtn = Array.from(dialog!.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel',
    )!;
    cancelBtn.click();
    await openPromise;

    expect(
      openMock,
      'expected the file-picker to NOT have been opened after Cancel.',
    ).not.toHaveBeenCalled();
    expect(
      invokeMock.mock.calls.filter((c) => (c as unknown as [string])[0] === 'read_md_file').length,
      'expected NO read_md_file invoke after Cancel — the current buffer must remain.',
    ).toBe(0);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });

  it('dirty buffer + Don\'t Save → guardOpenAgainstDirty returns true; OPEN proceeds, buffer is replaced', async () => {
    const invokeMock = vi.fn(async (cmd: string, args: unknown) => {
      if (cmd === 'read_md_file') {
        const a = args as { path: string };
        return {
          path: a.path,
          name: 'b.md',
          content: '# B\n',
        };
      }
      return undefined;
    });
    const openMock = vi.fn(async () => '/tmp/b.md');
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: openMock,
      save: vi.fn(async () => null),
    }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened, getCurrentEditor, openFileViaDialog, isDirty } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        openFileViaDialog: (host: HTMLElement) => Promise<void>;
        isDirty: () => boolean;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/a.md', name: 'a.md', content: '# A\n' },
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

    const openPromise = openFileViaDialog(host);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const discardBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === "Don't Save",
    )!;
    discardBtn.click();
    await openPromise;
    await new Promise((r) => setTimeout(r, 100));

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(
      invokeMock.mock.calls.filter((c) => (c as unknown as [string])[0] === 'read_md_file').length,
      'expected exactly one read_md_file invoke after Don\'t Save.',
    ).toBe(1);
    expect(
      isDirty(),
      'expected the new file to load with isDirty()===false (the dirty signal travelled with the discarded buffer).',
    ).toBe(false);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });

  it('dirty buffer + Save (success) → guardOpenAgainstDirty triggers save, then proceeds with open', async () => {
    let saveCalls = 0;
    const invokeMock = vi.fn(async (cmd: string, args: unknown) => {
      if (cmd === 'save_md_file') {
        saveCalls++;
        return undefined; // success
      }
      if (cmd === 'read_md_file') {
        const a = args as { path: string };
        return {
          path: a.path,
          name: 'b.md',
          content: '# B\n',
        };
      }
      return undefined;
    });
    const openMock = vi.fn(async () => '/tmp/b.md');
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: openMock,
      save: vi.fn(async () => null),
    }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened, getCurrentEditor, openFileViaDialog } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        openFileViaDialog: (host: HTMLElement) => Promise<void>;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/a.md', name: 'a.md', content: '# A\n' },
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

    const openPromise = openFileViaDialog(host);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const saveBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Save',
    )!;
    saveBtn.click();
    await openPromise;
    await new Promise((r) => setTimeout(r, 100));

    expect(saveCalls, 'expected exactly one save_md_file invoke before the open').toBe(1);
    expect(openMock, 'expected open picker to fire after the save resolved').toHaveBeenCalledTimes(1);
    expect(
      invokeMock.mock.calls.filter((c) => (c as unknown as [string])[0] === 'read_md_file').length,
      'expected the new file to be loaded after the save resolved.',
    ).toBe(1);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });

  it('dirty buffer + Save (FAILS) → guardOpenAgainstDirty does NOT proceed (sticky dirty preserves edits)', async () => {
    const invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === 'save_md_file') {
        throw new Error('save_md_file failed: outside the allowed root');
      }
      return undefined;
    });
    const openMock = vi.fn(async () => '/tmp/should-not-open.md');
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: openMock,
      save: vi.fn(async () => null),
    }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { bootstrap, handleFileOpened, getCurrentEditor, openFileViaDialog, isDirty } =
      (await import('../main')) as unknown as {
        bootstrap: () => void;
        handleFileOpened: (
          payload: { path: string; name: string; content: string },
          host: HTMLElement,
        ) => Promise<void>;
        getCurrentEditor: () => Editor | null;
        openFileViaDialog: (host: HTMLElement) => Promise<void>;
        isDirty: () => boolean;
      };

    bootstrap();
    await new Promise((r) => setTimeout(r, 100));
    await handleFileOpened(
      { path: '/tmp/a.md', name: 'a.md', content: '# A\n' },
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

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const openPromise = openFileViaDialog(host);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const saveBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Save',
    )!;
    saveBtn.click();
    await openPromise;
    errSpy.mockRestore();

    expect(
      openMock,
      'expected the file-picker to NOT have been opened after a failed save (sticky dirty).',
    ).not.toHaveBeenCalled();
    expect(
      invokeMock.mock.calls.filter((c) => (c as unknown as [string])[0] === 'read_md_file').length,
      'expected NO read_md_file invoke after the save failed.',
    ).toBe(0);
    expect(
      isDirty(),
      'expected dirty to remain true after the failed save — the edits are still in the buffer.',
    ).toBe(true);

    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-dialog');
    vi.doUnmock('@tauri-apps/api/event');
  });
});
