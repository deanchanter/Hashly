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
        attributes: { 'aria-readonly': 'true' },
      }));
    })
    .use(commonmark)
    .create();
}

if (typeof document !== 'undefined') {
  const host = document.getElementById('editor');
  if (host) {
    void mountEditor(host, '# Hello');
  }
}
