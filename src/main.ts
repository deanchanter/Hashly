import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/core';
import { commonmark, headingIdGenerator } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import '@milkdown/prose/view/style/prosemirror.css';
import './style.css';
import showcase from './fixtures/commonmark-showcase.md?raw';

export async function mountEditor(host: HTMLElement, content: string): Promise<Editor> {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, content);
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: () => false,
        attributes: { 'aria-readonly': 'true', 'tabindex': '0' },
      }));
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

export function bootstrap(): void {
  if (typeof document === 'undefined') return;
  installDragDropGuard();
  const host = document.getElementById('editor');
  if (!host) {
    console.warn('[hashly] #editor host element not found; mountEditor not auto-invoked');
    return;
  }
  void mountEditor(host, showcase);
}

if (import.meta.env.MODE !== 'test') {
  bootstrap();
}
