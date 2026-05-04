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
import { commonmark, headingIdGenerator } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import '@milkdown/prose/view/style/prosemirror.css';
import './style.css';
import { parseFrontmatter } from './frontmatter';
import { installBrokenImageFallback } from './broken-image-fallback';

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
      // Critical fix #4 — heading ID disambiguation. Mirrors the v0.2
      // `mountEditor` block (issue #17) so duplicate-text headings get
      // GitHub-compatible `section`, `section-1`, `section-2` suffixes
      // and in-doc anchor links resolve to the rendered headings.
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
  sanitizeUrlAttributes(host);
  installBrokenImageFallback(host);
  return editor;
}

// Critical fix #1 — XSS scheme rejection. Milkdown's commonmark + gfm
// presets pass URI schemes through verbatim, so a public-repo markdown
// file can embed `[click](javascript:...)` / `![x](data:...)` and the
// click executes attacker JS on the viewer's origin. We post-process
// the rendered DOM with a positive scheme allowlist: relative URLs,
// `http:`, `https:`, and `mailto:` survive; everything else has the
// dangerous attribute stripped. The element stays in the DOM (renders
// as inert text) so the surrounding prose is unaffected.
const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function isSafeUrl(value: string): boolean {
  // Relative URLs (no scheme — `#section`, `./foo.md`, `foo.md`) are
  // safe. Detect a scheme by the same shape browsers use: optional
  // leading whitespace, then `[a-zA-Z][a-zA-Z0-9+.-]*:`.
  const trimmed = value.trim();
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!match) return true; // no scheme → relative → safe
  return SAFE_URL_SCHEMES.has(match[1]!.toLowerCase() + ':');
}

function sanitizeUrlAttributes(host: HTMLElement): void {
  host.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (!isSafeUrl(href)) {
      a.removeAttribute('href');
    }
  });
  host.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (!isSafeUrl(src)) {
      img.removeAttribute('src');
    }
  });
}
