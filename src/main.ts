import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
  editorViewCtx,
  serializerCtx,
} from '@milkdown/core';
import { parseFrontmatter, type FrontmatterParse } from './frontmatter';
import { commonmark, headingIdGenerator } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import '@milkdown/prose/view/style/prosemirror.css';
import type { EditorView } from '@milkdown/prose/view';
import type { Transaction } from '@milkdown/prose/state';
import './style.css';
import showcase from './fixtures/commonmark-showcase.md?raw';
import prdTemplate from './templates/prd.md?raw';
import visionTemplate from './templates/vision.md?raw';
import taskTemplate from './templates/task.md?raw';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

const TEMPLATES: Record<'prd' | 'vision' | 'task', string> = {
  prd: prdTemplate,
  vision: visionTemplate,
  task: taskTemplate,
};

export type TemplateKind = keyof typeof TEMPLATES;

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
  installBrokenImageFallback(host);
  return editor;
}

// Issue #78 slice 1 — broken-image alt-text fallback.
//
// CSS has no broken-image pseudo-class. The state is observable only
// from JS via the <img>'s `error` event (or `img.complete &&
// img.naturalWidth === 0` for already-failed loads). We attach an
// `error` listener to every <img> Milkdown inserts into the editor's
// .ProseMirror tree; on failure we replace the <img> with a
// <span class="hashly-broken-image">{alt}</span> so the OS "?" glyph
// is gone and the alt text becomes the visible (and a11y-readable)
// fallback. The class is the stable hook for the CSS surface.
//
// Observers are tracked per host so each `mountEditor` call disconnects
// the previous one (otherwise every remount leaks one MutationObserver,
// flagged by the adversarial review).
const HASHLY_BROKEN_IMAGE_OBSERVERS = new WeakMap<
  HTMLElement,
  MutationObserver
>();

function installBrokenImageFallback(host: HTMLElement): void {
  // Disconnect any observer left over from a previous mountEditor call
  // on the same host so the observer count stays bounded across edit
  // toggles, file opens, and template inserts.
  HASHLY_BROKEN_IMAGE_OBSERVERS.get(host)?.disconnect();

  const replaceWithFallback = (img: HTMLImageElement): void => {
    const parent = img.parentNode;
    if (!parent) return;
    const alt = img.getAttribute('alt') ?? '';
    // Empty-alt is the markdown decorative-image idiom (`![](src)`).
    // The image is intentionally invisible to assistive tech, so the
    // fallback should be invisible too — no empty pill, no semantic
    // signal. Just drop the broken <img>.
    if (alt === '') {
      parent.removeChild(img);
      return;
    }
    const span = document.createElement('span');
    span.className = 'hashly-broken-image';
    span.textContent = alt;
    // Accessibility: the fallback stands in for an <img alt="...">, so
    // it must be announced as a graphic with the alt as the accessible
    // name. Without these attributes, a screen reader treats the alt
    // text as inline body prose.
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', alt);
    // Edit-mode safety: the swap happens outside ProseMirror's awareness,
    // so making the span editable would let user keystrokes mutate the
    // DOM in a region PM does not track — those edits would vanish on
    // save (serializer reads from `state.doc`, not the DOM).
    span.setAttribute('contenteditable', 'false');
    parent.replaceChild(span, img);
  };
  // After we replace a broken `<img>` with our `<span>`, ProseMirror's
  // view layer notices the inline-atom node was removed from the
  // paragraph and re-inserts an `<img class="ProseMirror-separator">`
  // synthetic cursor anchor next to the span. AC2 ("OS '?' glyph cannot
  // appear") requires NO `<img>` to remain adjacent to our fallback.
  // We strip ONLY the separators that sit immediately next to a
  // `.hashly-broken-image` span — separators next to working images
  // elsewhere in the same paragraph must survive (mixed paragraphs
  // were previously losing cursor anchors on unrelated images).
  const cleanScopedSeparators = (parent: ParentNode): void => {
    parent.querySelectorAll(':scope > .ProseMirror-separator').forEach((node) => {
      const prev = node.previousElementSibling;
      const next = node.nextElementSibling;
      const adjacentToFallback =
        (prev !== null &&
          (prev as Element).classList?.contains('hashly-broken-image')) ||
        (next !== null &&
          (next as Element).classList?.contains('hashly-broken-image'));
      if (adjacentToFallback) {
        node.remove();
      }
    });
  };
  const replaceWithFallbackAndCleanup = (img: HTMLImageElement): void => {
    const parent = img.parentNode;
    if (!parent) return;
    replaceWithFallback(img);
    if ((parent as ParentNode).querySelectorAll) {
      cleanScopedSeparators(parent as ParentNode);
    }
  };
  const handleImg = (img: HTMLImageElement): void => {
    // Skip ProseMirror's own separator imgs — they're view-layer
    // artifacts, not user content. We'll prune them post-replacement
    // (scoped to the broken-image's parent) when they appear there.
    if (img.classList.contains('ProseMirror-separator')) return;
    // Synchronously broken (image already failed before we wired it).
    if (img.complete && img.naturalWidth === 0 && img.src) {
      replaceWithFallbackAndCleanup(img);
      return;
    }
    img.addEventListener(
      'error',
      () => replaceWithFallbackAndCleanup(img),
      { once: true },
    );
  };
  host.querySelectorAll('img').forEach((img) => handleImg(img as HTMLImageElement));
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
        const el = node as Element;
        if (el.tagName === 'IMG') {
          handleImg(el as HTMLImageElement);
        } else {
          el.querySelectorAll('img').forEach((img) =>
            handleImg(img as HTMLImageElement),
          );
        }
      });
      // Also clean separators that ProseMirror re-inserts as siblings
      // to our fallback span after the initial replacement. The
      // adjacency filter inside `cleanScopedSeparators` keeps anchors
      // around unrelated working images intact.
      m.target.parentElement
        ?.querySelectorAll('.hashly-broken-image')
        .forEach((span) => {
          const p = span.parentNode as ParentNode | null;
          if (p) cleanScopedSeparators(p);
        });
    }
  });
  observer.observe(host, { childList: true, subtree: true });
  HASHLY_BROKEN_IMAGE_OBSERVERS.set(host, observer);
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

// Issue #43 — Sanitize filenames against Unicode RTL / zero-width /
// control codepoints before they land in `document.title` (or any
// other UI surface that could be spoofed). Strips:
//
//   - U+0000..U+001F  C0 controls
//   - U+007F..U+009F  DEL + C1 controls
//   - U+200B..U+200F  zero-width chars + LRM/RLM bidi marks
//   - U+202A..U+202E  bidi embedding/override codepoints
//   - U+2066..U+2069  bidi isolate codepoints
//
// Plain ASCII, accented Latin, and CJK pass through unchanged — the
// stripped ranges target invisible / formatting codepoints, not
// legitimate filename content.
const FILENAME_STRIP_RE =
  /[ --​-‏‪-‮⁦-⁩]/g;

export function sanitizeFilename(name: string): string {
  return name.replace(FILENAME_STRIP_RE, '');
}

// Issue #48 — Frontmatter recognition is implemented in `./frontmatter`
// and re-exported here so existing call sites (`parseFrontmatter` /
// `FrontmatterParse`) keep their import path. The extraction keeps the
// parser usable from web-mode (`src/viewer.ts`) without dragging
// `main.ts`'s Tauri side-effects.
export { parseFrontmatter, type FrontmatterParse };

let currentEditor: Editor | null = null;
let currentEditorMode: EditorMode = 'read';
let currentEditorHost: HTMLElement | null = null;
let currentFileName: string | null = null;
// Issue #7: tracks the on-disk path of the currently open file so Cmd+S
// can save in place. Null when no file is open OR for template-new
// buffers (slice 14 / #49) which route Cmd+S through Save-As instead.
let currentFilePath: string | null = null;
// Issue #48: raw frontmatter block including both `---` fences. Saved
// verbatim ahead of the editor-serialized body so the round-trip is
// byte-equal (no YAML serializer involved). Null when the opened doc
// has no frontmatter or the YAML failed to parse.
let currentFrontmatter: string | null = null;

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
    // Issue #48 cross-slice fix: `host.innerHTML = ''` wipes the
    // frontmatter panel that handleFileOpened / newFromTemplate
    // appended. Re-render it from `currentFrontmatter` so the
    // metadata stays visible across mode toggles. Re-parse from the
    // raw block (which is preserved verbatim for byte-equal save).
    if (currentFrontmatter !== null) {
      const reparsed = parseFrontmatter(currentFrontmatter);
      if (reparsed.parsed) {
        renderFrontmatterPanel(host, reparsed.parsed);
      }
    }
    let next: Editor;
    try {
      next = await mountEditor(host, md, nextMode);
    } catch (e) {
      // Issue #36 / #37: mountEditor rejection inside toggleEditMode
      // used to leave a blank pane + enabled button + stale label.
      // Now we render a user-visible error and keep the toggle UI
      // honest — no editor is mounted, so the label / aria reflect
      // a state the user can act on (the file-error surface stands
      // in for a doc).
      console.error('[hashly] toggleEditMode: mountEditor rejected', e);
      currentEditorMode = 'read';
      syncEditToggleUi();
      renderFileError(
        host,
        "Couldn't switch modes — the document failed to mount.",
      );
      return;
    }
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

// Issue #35 / #37 — handleFileOpened symmetry with toggleEditMode.
// The destroy + mount sequence is the same shape; the same defenses
// (sync disable, null currentEditor before mount, re-entrancy guard,
// try/finally, render-on-error) apply.
let fileOpenInFlight = false;

export async function handleFileOpened(payload: FileOpened, host: HTMLElement): Promise<void> {
  if (fileOpenInFlight) return;
  fileOpenInFlight = true;
  if (editToggleButton) editToggleButton.disabled = true;
  try {
    if (currentEditor) {
      try {
        await currentEditor.destroy();
      } catch {
        /* swallow — destroy may reject if the editor was already torn down */
      }
    }
    // Null the reference BEFORE the new mount await. If mountEditor
    // rejects, module state stays clean (no dangling pointer to the
    // destroyed editor that subsequent .action() calls would try to
    // reach through).
    currentEditor = null;
    host.innerHTML = '';
    currentFileName = sanitizeFilename(payload.name);
    currentFilePath = payload.path;
    clearDirty();
    // Issue #48 — strip frontmatter before mounting; re-emit on save.
    const fm = parseFrontmatter(payload.content);
    currentFrontmatter = fm.frontmatter;
    if (fm.parsed) {
      renderFrontmatterPanel(host, fm.parsed);
    }
    let editor: Editor;
    try {
      editor = await mountEditor(host, fm.body);
    } catch (e) {
      console.error('[hashly] handleFileOpened: mountEditor rejected', e);
      renderFileError(
        host,
        "Couldn't open this document — the editor failed to mount.",
        currentFilePath ?? undefined,
      );
      return;
    }
    currentEditor = editor;
    currentEditorMode = 'read';
    currentEditorHost = host;
    syncEditToggleUi();
  } finally {
    fileOpenInFlight = false;
    if (editToggleButton) editToggleButton.disabled = false;
  }
}

// Issue #48 — render a metadata panel above the editor showing the
// parsed frontmatter as key/value pairs. Read-mode minimum (plain
// styling per the AC); edit-mode editing of the frontmatter via a
// fenced-code-style region is a follow-up.
function renderFrontmatterPanel(
  host: HTMLElement,
  parsed: Record<string, unknown>,
): void {
  const panel = document.createElement('aside');
  panel.setAttribute('data-testid', 'frontmatter-panel');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Document metadata');
  panel.className = 'hashly-frontmatter-panel';
  for (const [key, value] of Object.entries(parsed)) {
    const row = document.createElement('div');
    row.className = 'hashly-frontmatter-panel__row';
    const k = document.createElement('span');
    k.className = 'hashly-frontmatter-panel__key';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'hashly-frontmatter-panel__value';
    v.textContent = formatFrontmatterValue(value);
    row.appendChild(k);
    row.appendChild(v);
    panel.appendChild(row);
  }
  host.appendChild(panel);
}

function formatFrontmatterValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatFrontmatterValue).join(', ');
  }
  // Object — render as inline JSON. Edge-case for nested YAML; the
  // panel's job is "show the keys to the user", not pretty-print.
  try {
    return JSON.stringify(value);
  } catch {
    return '[object]';
  }
}

// Cross-slice guard: every OPEN path (File > Open, Finder
// double-click, File > New From Template) destroys the current
// editor and replaces it. If the current buffer is dirty, that
// silently discards the user's edits — the close-guard's protection
// is bypassable by any of three trivial actions. The guard wraps
// each entry point with the same Save / Don't Save / Cancel prompt.
//
// Returns `true` when the caller should proceed with the open;
// `false` when the user chose Cancel OR the save attempt failed
// (sticky-dirty after save = "the file isn't safely on disk yet,
// don't lose the edits by opening something else").
export async function guardOpenAgainstDirty(): Promise<boolean> {
  if (!isDirty()) return true;
  const choice = await confirmUnsavedClose(currentFileName);
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  // 'save' — try to save; only proceed if dirty actually cleared.
  await saveCurrent();
  return !isDirty();
}

// Issue #49 — slice 14: open a new unsaved buffer from a baked-in
// template. Hydrates `{{author}}` / `{{date}}` placeholders before
// mounting; opens in edit mode with dirty=true and currentFilePath=null
// so the next Cmd+S routes through Save-As.
export async function newFromTemplate(
  kind: TemplateKind,
  host: HTMLElement,
): Promise<void> {
  if (fileOpenInFlight) return;
  if (!(await guardOpenAgainstDirty())) return;
  fileOpenInFlight = true;
  if (editToggleButton) editToggleButton.disabled = true;
  try {
    const template = TEMPLATES[kind];
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let author = 'Author';
    try {
      const fromInvoke = await invoke<string>('get_current_user');
      if (typeof fromInvoke === 'string' && fromInvoke.length > 0) {
        author = fromInvoke;
      }
    } catch {
      // Non-Tauri / failed lookup — keep the literal fallback.
    }
    const hydrated = template
      .replace(/\{\{author\}\}/g, author)
      .replace(/\{\{date\}\}/g, today);

    if (currentEditor) {
      try {
        await currentEditor.destroy();
      } catch {
        /* swallow */
      }
    }
    currentEditor = null;
    host.innerHTML = '';
    currentFileName = `Untitled ${kind}.md`;
    currentFilePath = null; // Save-As path
    clearDirty();
    const fm = parseFrontmatter(hydrated);
    currentFrontmatter = fm.frontmatter;
    if (fm.parsed) {
      renderFrontmatterPanel(host, fm.parsed);
    }
    let editor: Editor;
    try {
      editor = await mountEditor(host, fm.body, 'edit');
    } catch (e) {
      console.error('[hashly] newFromTemplate: mountEditor rejected', e);
      renderFileError(host, "Couldn't open template — the editor failed to mount.");
      return;
    }
    currentEditor = editor;
    currentEditorMode = 'edit';
    currentEditorHost = host;
    syncEditToggleUi();
    // Mark dirty from frame zero so the user sees the bullet and the
    // close-guard catches an accidental close.
    markDirty();
  } finally {
    fileOpenInFlight = false;
    if (editToggleButton) editToggleButton.disabled = false;
  }
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
    // Issue #49 — slice 14: Save-As routing. Cmd+S on a path-less
    // buffer (template-new) opens the native save picker. If the
    // user cancels, the buffer stays dirty + unsaved (no invoke).
    // If the user picks a path, we set currentFilePath and fall
    // through to the in-place save path below.
    let chosen: string | null;
    try {
      chosen = await saveDialog({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        defaultPath: currentFileName ?? 'Untitled.md',
      });
    } catch (e) {
      console.error('[hashly] saveCurrent: save dialog failed', e);
      return;
    }
    if (!chosen) return; // user cancelled — dirty stays sticky
    currentFilePath = chosen;
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
  // Issue #48 — re-emit the raw frontmatter block (verbatim, including
  // fences) ahead of the editor body so the round-trip is byte-equal.
  const finalContent = (currentFrontmatter ?? '') + md;
  try {
    await invoke('save_md_file', { path: currentFilePath, content: finalContent });
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

// Issue #27 — keyboard escape from edit mode. Tab is captured by
// ProseMirror for natural list-indent ergonomics (matches every
// markdown editor the persona has used); Escape is the explicit
// keyboard escape that blurs the editor and focuses the toggle
// button. Read mode is exempt (read-mode editor isn't the focus
// source for editing).
let escapeHandlerInstalled = false;

export function installEscapeHandler(target: Document = document): void {
  if (escapeHandlerInstalled) return;
  if (typeof document === 'undefined') return;
  escapeHandlerInstalled = true;
  target.addEventListener('keydown', (e: Event) => {
    const ev = e as KeyboardEvent;
    if (ev.key !== 'Escape') return;
    if (currentEditorMode !== 'edit') return;
    if (!editToggleButton) return;
    editToggleButton.focus();
  });
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
  if (!(await guardOpenAgainstDirty())) return;
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
  installEscapeHandler();
  void installCloseGuard().catch(() => {
    /* non-Tauri envs — close guard is a no-op there */
  });
  void listen<void>('menu-open-file', () => {
    const editorHost = document.getElementById('editor');
    if (editorHost) {
      void openFileViaDialog(editorHost);
    }
  }).catch(() => { /* listen rejects in non-Tauri envs (e.g. plain browser / vitest) — acceptable */ });
  // Issue #5 — Finder double-click / Open With > Hashly. Rust emits
  // `file-opened-by-os` with the file path string from RunEvent::Opened
  // (see src-tauri/src/lib.rs). The frontend reads the file via the
  // same hardened `read_md_file` seam used by File > Open and routes
  // through handleFileOpened — so the security model (canonicalize +
  // allow-list, #44) applies identically to OS-initiated opens.
  // Issue #49 — File > New From Template menu wire-up. Rust emits
  // `new-from-template` with a string payload (`"prd"` / `"vision"` /
  // `"task"`); we hydrate + mount.
  void listen<string>('new-from-template', async (event) => {
    const editorHost = document.getElementById('editor');
    if (!editorHost) return;
    const kind = event.payload;
    if (kind !== 'prd' && kind !== 'vision' && kind !== 'task') return;
    await newFromTemplate(kind, editorHost);
  }).catch(() => { /* non-Tauri envs — acceptable */ });
  void listen<string>('file-opened-by-os', async (event) => {
    const editorHost = document.getElementById('editor');
    if (!editorHost) return;
    const path = event.payload;
    if (typeof path !== 'string' || !path) return;
    if (!(await guardOpenAgainstDirty())) return;
    try {
      const payload = await invoke<FileOpened>('read_md_file', { path });
      await handleFileOpened(payload, editorHost);
    } catch {
      renderFileError(
        editorHost,
        "Can't open this file — it doesn't look like text.",
        path,
      );
    }
  }).catch(() => { /* non-Tauri envs — acceptable */ });
  const host = document.getElementById('editor');
  if (!host) {
    console.warn('[hashly] #editor host element not found; mountEditor not auto-invoked');
    return;
  }
  void mountEditor(host, showcase)
    .then((editor) => {
      currentEditor = editor;
      currentEditorMode = 'read';
      currentEditorHost = host;
      if (editToggleButton) editToggleButton.disabled = false;
    })
    .catch((e) => {
      // Issue #31 — preventive observability. The bootstrap mount is
      // reliable in practice (Milkdown's `.create()` doesn't throw on
      // valid markdown showcase fixtures), but a silent rejection
      // would leave the toggle permanently disabled with zero user
      // signal. Console-only is sufficient per the issue body — the
      // mount is dev/build infrastructure rather than user content.
      console.error('[hashly] bootstrap: showcase mountEditor rejected', e);
    });
}

if (import.meta.env.MODE !== 'test') {
  bootstrap();
}
