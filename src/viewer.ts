// Issue #90 / AC 4.4 — Read-only Milkdown viewer mount for the web
// codepath.
//
// `mountViewer(host, content)` is the web counterpart of v0.2's
// `mountEditor(host, content, 'read')`. It mounts the supplied markdown
// into `host` as a read-only Milkdown editor with the v0.2 polish
// (commonmark + gfm presets, frontmatter stripped before mount). It
// deliberately does NOT import from `src/main.ts` because that module
// pulls in `@tauri-apps/*` at the top level — the viewer is the
// non-Tauri entry point and must stay loadable in a plain browser.

import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
} from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import '@milkdown/prose/view/style/prosemirror.css';
import './style.css';
import { parseFrontmatter } from './frontmatter';

export async function mountViewer(
  host: HTMLElement,
  content: string,
): Promise<Editor> {
  // Strip frontmatter so the YAML fences don't render as a thematic
  // break / setext-underlined heading inside the editor body.
  const { body } = parseFrontmatter(content);

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, body);
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: () => false,
        attributes: {
          'aria-readonly': 'true',
          'role': 'textbox',
          'tabindex': '0',
          'contenteditable': 'false',
        },
      }));
    })
    .use(commonmark)
    .use(gfm)
    .create();
  return editor;
}
