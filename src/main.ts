import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import './style.css';

Editor.make()
  .config((ctx) => {
    ctx.set(rootCtx, '#editor');
    ctx.set(defaultValueCtx, '# Hello');
    ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => false }));
  })
  .use(commonmark)
  .create();
