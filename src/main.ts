import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import '@milkdown/prose/view/style/prosemirror.css';
import './style.css';

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
    })
    .use(commonmark)
    .create();
}

export function bootstrap(): void {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('editor');
  if (!host) {
    console.warn('[hashly] #editor host element not found; mountEditor not auto-invoked');
    return;
  }
  void mountEditor(host, '# Hello');
}

if (import.meta.env.MODE !== 'test') {
  bootstrap();
}
