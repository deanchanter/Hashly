import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
  editorViewCtx,
  serializerCtx,
} from '@milkdown/core';
import { commonmark, headingIdGenerator } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import '@milkdown/prose/view/style/prosemirror.css';
import type { EditorView } from '@milkdown/prose/view';
import type { Transaction } from '@milkdown/prose/state';
import './style.css';
import showcase from './fixtures/commonmark-showcase.md?raw';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export type EditorMode = 'read' | 'edit';

export async function mountEditor(
  host: HTMLElement,
  content: string,
  mode: EditorMode = 'read',
): Promise<Editor> {
  // Per-mount arming flag for dirty tracking. The dispatchTransaction
  // wrapper closes over this so transactions Milkdown/ProseMirror fire
  // during initial setup (before the mount is "settled") cannot flip
  // dirty. We arm it on the next macrotask after `.create()` resolves —
  // by then the plugin lifecycle has played out and any further
  // docChanged transaction is user-driven.
  const armRef = { armed: false };
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, content);
      ctx.update(editorViewOptionsCtx, (prev) =>
        mode === 'edit'
          ? {
              ...prev,
              editable: () => true,
              attributes: { 'aria-readonly': 'false', 'tabindex': '0' },
              // Issue #7 / #33: install dirty-tracking dispatchTransaction
              // wrapper ONLY in edit mode. Read-mode mounts get NO wrapper,
              // so a programmatic `view.dispatch(tr)` (which ProseMirror
              // does not block even when `editable: () => false`) cannot
              // signal dirty — first defensive layer against the #33
              // write-handle bypass.
              dispatchTransaction(this: EditorView, tr: Transaction) {
                this.updateState(this.state.apply(tr));
                if (armRef.armed && tr.docChanged) {
                  markDirty();
                }
              },
            }
          : {
              ...prev,
              editable: () => false,
              attributes: { 'aria-readonly': 'true', 'tabindex': '0' },
            },
      );
      const seenHeadingIds = new Map<string, number>();
      const nodeIdCache = new WeakMap<object, string>();
      ctx.set(headingIdGenerator.key, (node) => {
        const cached = nodeIdCache.get(node);
        if (cached) return cached;
        if (node.attrs?.id) {
          nodeIdCache.set(node, node.attrs.id);
          return node.attrs.id;
        }
        const base = node.textContent.toLowerCase().trim().replace(/\s+/g, '-');
        const count = seenHeadingIds.get(base) ?? 0;
        seenHeadingIds.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        nodeIdCache.set(node, id);
        return id;
      });
    })
    .use(commonmark)
    .use(gfm)
    .create();
  if (mode === 'edit') {
    // Arm on the next macrotask. Mount-time setup transactions resolve
    // synchronously / in microtasks during `.create()`; a 0-ms timer is
    // a coarse-but-reliable boundary between "mount setup" and "user
    // edits".
    setTimeout(() => {
      armRef.armed = true;
    }, 0);
  }
  return editor;
}

let dragDropGuardInstalled = false;

export function installDragDropGuard(target: Window | Document = window): void {
  if (dragDropGuardInstalled) return;
  dragDropGuardInstalled = true;
  const stop = (e: Event) => {
    e.preventDefault();
  };
  target.addEventListener('dragover', stop);
  target.addEventListener('drop', stop);
}

export interface FileOpened {
  path: string;
  name: string;
  content: string;
}

let currentEditor: Editor | null = null;
let currentEditorMode: EditorMode = 'read';
let currentEditorHost: HTMLElement | null = null;
let currentFileName: string | null = null;
// Issue #7: tracks the on-disk path of the currently open file so Cmd+S
// can save in place. Null when no file is open OR for template-new
// buffers (slice 14 / #49) which route Cmd+S through Save-As instead.
let currentFilePath: string | null = null;

export function getCurrentEditor(): Editor | null {
  return currentEditor;
}

// Issue #7: dirty-bit + title-bullet state. The bit flips true on any
// edit-mode transaction with `docChanged` (see mountEditor's
// dispatchTransaction wrapper) and resets to false on file-open.
let dirty = false;

export function isDirty(): boolean {
  return dirty;
}

function syncDirtyUi(): void {
  if (typeof document === 'undefined') return;
  const base = currentFileName ? `${currentFileName} — Hashly` : 'Hashly';
  document.title = dirty ? `• ${base}` : base;
}

function markDirty(): void {
  if (dirty) return;
  dirty = true;
  syncDirtyUi();
}

function clearDirty(): void {
  dirty = false;
  syncDirtyUi();
}

let toggleInFlight = false;

async function toggleEditMode(): Promise<void> {
  if (toggleInFlight) return;
  const editor = currentEditor;
  const host = currentEditorHost;
  if (!editor || !host) return;
  toggleInFlight = true;
  if (editToggleButton) editToggleButton.disabled = true;
  try {
    let md: string;
    try {
      md = editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const serializer = ctx.get(serializerCtx);
        return serializer(view.state.doc);
      });
    } catch {
      return;
    }
    const nextMode: EditorMode = currentEditorMode === 'read' ? 'edit' : 'read';
    try {
      await editor.destroy();
    } catch {
      /* swallow — destroy may reject if the editor was already torn down */
    }
    currentEditor = null;
    host.innerHTML = '';
    const next = await mountEditor(host, md, nextMode);
    currentEditor = next;
    currentEditorMode = nextMode;
    currentEditorHost = host;
    syncEditToggleUi();
    if (nextMode === 'edit') {
      next.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.focus();
      });
    } else if (editToggleButton) {
      // Re-enable BEFORE focus — jsdom (per HTML spec) refuses to focus
      // a disabled element. The `finally` block re-enables idempotently.
      editToggleButton.disabled = false;
      editToggleButton.focus();
    }
  } finally {
    toggleInFlight = false;
    if (editToggleButton) editToggleButton.disabled = false;
  }
}

let editToggleInstalled = false;
let editToggleButton: HTMLButtonElement | null = null;

const EDIT_TOGGLE_LABEL_READ = 'Edit';
const EDIT_TOGGLE_LABEL_EDIT = 'Read';

function syncEditToggleUi(): void {
  if (!editToggleButton) return;
  editToggleButton.setAttribute(
    'aria-pressed',
    currentEditorMode === 'edit' ? 'true' : 'false',
  );
  editToggleButton.textContent =
    currentEditorMode === 'edit' ? EDIT_TOGGLE_LABEL_EDIT : EDIT_TOGGLE_LABEL_READ;
}

function installEditToggle(): void {
  if (editToggleInstalled) return;
  if (typeof document === 'undefined') return;
  editToggleInstalled = true;
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-testid', 'edit-toggle');
  button.setAttribute('aria-pressed', 'false');
  button.className = 'hashly-edit-toggle';
  button.textContent = EDIT_TOGGLE_LABEL_READ;
  button.disabled = true;
  button.addEventListener('click', () => {
    void toggleEditMode();
  });
  editToggleButton = button;
  document.body.appendChild(button);
}

export async function handleFileOpened(payload: FileOpened, host: HTMLElement): Promise<void> {
  if (currentEditor) {
    try {
      await currentEditor.destroy();
    } catch {
      /* swallow — destroy may reject if the editor was already torn down */
    }
  }
  host.innerHTML = '';
  currentFileName = payload.name;
  currentFilePath = payload.path;
  clearDirty();
  const editor = await mountEditor(host, payload.content);
  currentEditor = editor;
  currentEditorMode = 'read';
  currentEditorHost = host;
  syncEditToggleUi();
  if (editToggleButton) editToggleButton.disabled = false;
}

// Issue #7 — slice 2: serialize the current editor doc and write it to
// `currentFilePath` via the `save_md_file` Tauri command. On success,
// clear dirty. On failure, log and leave dirty sticky-true so the user
// still sees the title-bar bullet warning. The blocking save-failure
// dialog from spec.md is deferred until #50 (ACL extension) lands the
// `dialog:allow-message` capability.
//
// `saveCurrent` does NOT take an editor argument — it serializes the
// internal `currentEditor` handle. That's the frontend half of #33's
// write-handle-bypass hardening: no caller hands a write-capable
// handle to the save path; the save path serializes the handle the
// module already owns and ships a `&str` over IPC.
export async function saveCurrent(): Promise<void> {
  if (currentFilePath === null) {
    // Save-As path is deferred to slice 14 (#49 templates pair with
    // it). For this slice, Cmd+S on a path-less buffer is a no-op.
    return;
  }
  // Issue #33 save-time mode guard. The dirty-bit-side defense
  // (read-mode mounts get no dispatchTransaction wrapper) blocks the
  // dirty SIGNAL but not the OUTCOME — a programmatic mutation in read
  // mode (e.g. via getCurrentEditor() in devtools, or via a future UI
  // component that misuses the editor handle) leaves view state
  // mutated. Without this guard, sticky-dirty + read-mode-mutation +
  // Cmd+S would persist the read-mode mutation. The persona walkthrough
  // in spec.md shows the user-Cmd+S path explicitly happening in edit
  // mode ("they fix the line in WYSIWYG, hit Cmd+S"); refusing read-
  // mode saves matches the documented workflow. Slice 8 (#8 unsaved-
  // on-close) covers the close-with-unsaved-edits path so users don't
  // lose work; this guard only refuses the explicit read-mode Cmd+S.
  if (currentEditorMode !== 'edit') return;
  const editor = currentEditor;
  if (!editor) return;
  let md: string;
  try {
    md = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serializer = ctx.get(serializerCtx);
      return serializer(view.state.doc);
    });
  } catch (e) {
    console.error('[hashly] save: serialization failed', e);
    return;
  }
  try {
    await invoke('save_md_file', { path: currentFilePath, content: md });
    clearDirty();
  } catch (e) {
    // Sticky-dirty on failure. The user's edits are still unsaved;
    // the title-bar bullet must keep warning them. Slice paired with
    // #50 will add a blocking dialog on top of this log line.
    console.error('[hashly] save: invoke failed', e);
  }
}

// Issue #8 — slice 3: unsaved-changes-on-close dialog. The modal lives
// in the WebView (Tauri 2's plugin-dialog only natively supports
// 2-button confirms; 3-button "Save / Don't Save / Cancel" requires a
// custom modal). The HTML5 `<dialog role="alertdialog">` element gives
// modal behavior for free + screen-reader-correct semantics.
export function confirmUnsavedClose(
  filename: string | null,
): Promise<'save' | 'discard' | 'cancel'> {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.className = 'hashly-close-confirm';

    const message = document.createElement('p');
    message.className = 'hashly-close-confirm__message';
    const docPhrase = filename ?? 'this untitled document';
    message.textContent = `Do you want to save the changes you made in ${docPhrase}?`;
    dialog.appendChild(message);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'hashly-close-confirm__buttons';

    const make = (label: string, action: 'save' | 'discard' | 'cancel') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.action = action;
      btn.addEventListener('click', () => {
        if (dialog.parentElement) dialog.parentElement.removeChild(dialog);
        resolve(action);
      });
      return btn;
    };
    // Order matches macOS-native unsaved-changes prompt:
    // Save (default) | Don't Save | Cancel.
    buttonRow.appendChild(make('Save', 'save'));
    buttonRow.appendChild(make("Don't Save", 'discard'));
    buttonRow.appendChild(make('Cancel', 'cancel'));
    dialog.appendChild(buttonRow);

    document.body.appendChild(dialog);
  });
}

// Issue #8 decision function. Pure(-ish) — all side-effects come in
// through injected deps, so the test can supply mocks. The runtime
// wiring is in `installCloseGuard` below.
export interface CloseRequestDeps {
  event: { preventDefault: () => void };
  isDirty: () => boolean;
  currentFilename: () => string | null;
  confirm: (filename: string | null) => Promise<'save' | 'discard' | 'cancel'>;
  save: () => Promise<void>;
  destroy: () => Promise<void>;
}

export async function handleCloseRequest(deps: CloseRequestDeps): Promise<void> {
  if (!deps.isDirty()) {
    // Clean: let the close proceed. No preventDefault, no destroy
    // (the OS-level close handler does its job).
    return;
  }
  deps.event.preventDefault();
  const choice = await deps.confirm(deps.currentFilename());
  if (choice === 'cancel') return; // window stays open
  if (choice === 'discard') {
    await deps.destroy();
    return;
  }
  // 'save'
  await deps.save();
  // Critical UX pin (#8 verify): only destroy if the save actually
  // cleared dirty. saveCurrent swallows invoke rejections and leaves
  // dirty sticky-true; in that case we MUST NOT close — otherwise
  // the user picks Save, the save fails, and the window closes anyway,
  // silently losing work. The save-failure dialog (paired with #50
  // ACL extension) will give the user a Save As… escape later; until
  // then, sticky-dirty + no-destroy is the safe default.
  if (!deps.isDirty()) {
    await deps.destroy();
  }
}

let closeGuardInstalled = false;

export async function installCloseGuard(): Promise<void> {
  if (closeGuardInstalled) return;
  closeGuardInstalled = true;
  // Lazy-import the Tauri window API so non-Tauri envs (Vitest+jsdom)
  // don't blow up on the import. Same pattern as the menu-open-file
  // listener in `bootstrap`.
  let getCurrentWindow: typeof import('@tauri-apps/api/window').getCurrentWindow;
  try {
    ({ getCurrentWindow } = await import('@tauri-apps/api/window'));
  } catch {
    return;
  }
  try {
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      await handleCloseRequest({
        event,
        isDirty,
        currentFilename: () => currentFileName,
        confirm: confirmUnsavedClose,
        save: saveCurrent,
        destroy: () => win.destroy(),
      });
    });
  } catch {
    // listen rejects in non-Tauri envs — acceptable.
  }
}

let saveHandlerInstalled = false;

export function installSaveHandler(target: Document = document): void {
  if (saveHandlerInstalled) return;
  if (typeof document === 'undefined') return;
  saveHandlerInstalled = true;
  target.addEventListener('keydown', (e: Event) => {
    const ev = e as KeyboardEvent;
    // Accept Cmd+S (Mac) and Ctrl+S (cross-platform). Hashly is
    // mac-only per CLAUDE.md but the test surface (jsdom) and any
    // future cross-platform contributor benefits from accepting both.
    if (ev.key !== 's') return;
    if (!ev.metaKey && !ev.ctrlKey) return;
    ev.preventDefault();
    void saveCurrent();
  });
}

export async function openFileViaDialog(host: HTMLElement): Promise<void> {
  const selected = await openDialog({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (!selected || Array.isArray(selected)) return;
  try {
    const payload = await invoke<FileOpened>('read_md_file', { path: selected });
    await handleFileOpened(payload, host);
  } catch (e) {
    renderFileError(host, "Can't open this file — it doesn't look like text.", String(selected));
  }
}

export function renderFileError(host: HTMLElement, message: string, path?: string): void {
  host.innerHTML = '';
  const alert = document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.className = 'hashly-file-error';
  const heading = document.createElement('p');
  heading.className = 'hashly-file-error__message';
  heading.textContent = message;
  alert.appendChild(heading);
  if (path) {
    const detail = document.createElement('p');
    detail.className = 'hashly-file-error__path';
    detail.textContent = path;
    alert.appendChild(detail);
  }
  host.appendChild(alert);
  document.title = 'Hashly';
}

export function bootstrap(): void {
  if (typeof document === 'undefined') return;
  installDragDropGuard();
  installEditToggle();
  installSaveHandler();
  void installCloseGuard().catch(() => {
    /* non-Tauri envs — close guard is a no-op there */
  });
  void listen<void>('menu-open-file', () => {
    const editorHost = document.getElementById('editor');
    if (editorHost) {
      void openFileViaDialog(editorHost);
    }
  }).catch(() => { /* listen rejects in non-Tauri envs (e.g. plain browser / vitest) — acceptable */ });
  const host = document.getElementById('editor');
  if (!host) {
    console.warn('[hashly] #editor host element not found; mountEditor not auto-invoked');
    return;
  }
  void mountEditor(host, showcase).then((editor) => {
    currentEditor = editor;
    currentEditorMode = 'read';
    currentEditorHost = host;
    if (editToggleButton) editToggleButton.disabled = false;
  });
}

if (import.meta.env.MODE !== 'test') {
  bootstrap();
}
