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
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, content);
      ctx.update(editorViewOptionsCtx, (prev) =>
        mode === 'edit'
          ? {
              ...prev,
              editable: () => true,
              attributes: { 'aria-readonly': 'false', 'tabindex': '0' },
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

export function getCurrentEditor(): Editor | null {
  return currentEditor;
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
  host.innerHTML = '';
  document.title = `${payload.name} — Hashly`;
  const editor = await mountEditor(host, payload.content);
  currentEditor = editor;
  currentEditorMode = 'read';
  currentEditorHost = host;
  syncEditToggleUi();
  if (editToggleButton) editToggleButton.disabled = false;
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
