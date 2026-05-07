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
  editorViewCtx,
  serializerCtx,
} from '@milkdown/core';
import { commonmark, headingIdGenerator } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import '@milkdown/prose/view/style/prosemirror.css';
import './style.css';
import { parseFrontmatter } from './frontmatter';
import { installBrokenImageFallback } from './broken-image-fallback';

// Issue #91 / AC 5.6 — Per-host viewer state for byte-equal frontmatter
// round-trips. We capture the raw frontmatter block at mount time so
// `getViewerMarkdown` can prepend it verbatim (no YAML re-emit, no
// trim) ahead of the live ProseMirror body. Keyed by the host element
// so multiple mounts in the same DOM stay independent.
const mountedViewers = new WeakMap<
  HTMLElement,
  { editor: Editor; frontmatter: string | null }
>();

// Issue #91 / AC 5.6 — Capture the frontmatter-shaped prefix even when
// the YAML inside is malformed. `parseFrontmatter` returns
// `{frontmatter: null, body: original}` on YAML errors so the read-view
// metadata panel doesn't render — but for the round-trip getter we
// still want the original `---\n...\n---\n` block to come back out
// byte-equal, since Milkdown's serializer would otherwise re-emit the
// fences as `***` (thematic break) and escape characters like `[` to
// `\[`. When `parseFrontmatter` succeeds, we use its capture verbatim;
// when it returns null but the structural fences are present, we
// fall back to a structural slice with no YAML validation.
function captureFrontmatterPrefix(text: string): {
  frontmatter: string | null;
  body: string;
} {
  const parsed = parseFrontmatter(text);
  if (parsed.frontmatter !== null) {
    return { frontmatter: parsed.frontmatter, body: parsed.body };
  }
  if (text.startsWith('---\n')) {
    const closingFenceRe = /\n---[ \t]*\n/;
    const match = closingFenceRe.exec(text);
    if (match && match.index >= 4) {
      const fenceEnd = match.index + match[0].length;
      return {
        frontmatter: text.slice(0, fenceEnd),
        body: text.slice(fenceEnd),
      };
    }
  }
  return { frontmatter: null, body: text };
}

export async function mountViewer(
  host: HTMLElement,
  content: string,
): Promise<Editor> {
  // Strip frontmatter so the YAML fences don't render as a thematic
  // break / setext-underlined heading inside the editor body.
  const { frontmatter, body } = captureFrontmatterPrefix(content);

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
  mountedViewers.set(host, { editor, frontmatter });
  return editor;
}

// Issue #91 / AC 5.6 — Round-trip getter. Returns the markdown buffer
// currently represented by the viewer mounted in `host`: the captured
// raw frontmatter (verbatim, including fences and any trailing
// whitespace) prepended to the live ProseMirror body serialized via
// Milkdown's `serializerCtx`. Returns `null` when no viewer is mounted
// in `host` so a "save before mount" misuse fails loudly.
export function getViewerMarkdown(host: HTMLElement): string | null {
  const entry = mountedViewers.get(host);
  if (!entry) return null;
  const body = entry.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const serializer = ctx.get(serializerCtx);
    return serializer(view.state.doc);
  });
  return (entry.frontmatter ?? '') + body;
}

// Issue #91 / AC 5.1 — Edit-mode remount seam. Tears down the
// read-only editor for `host` and remounts a fresh editable Milkdown
// editor on the same host with the live serialized body, preserving
// the captured raw frontmatter byte-equal so AC 5.6's round-trip
// contract carries through. v0.2 desktop's `toggleEditMode` chose
// destroy-then-remount over in-place `editable: () => true` because
// some Milkdown plugin lifecycles don't re-evaluate the editable
// getter; same call here.
//
// Returns the new Editor on success, or `null` when no viewer is
// mounted in `host` (the safe-no-op floor for AC 5.1's defensive
// click-before-mount path). This is internal-but-exported so
// `src/edit-mode.ts` can drive the flip without re-implementing the
// mount config; the leading underscore signals "viewer-internal seam,
// not part of the public viewer API."
export async function _remountAsEditable(
  host: HTMLElement,
): Promise<Editor | null> {
  const entry = mountedViewers.get(host);
  if (!entry) return null;

  const body = entry.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const serializer = ctx.get(serializerCtx);
    return serializer(view.state.doc);
  });

  try {
    await entry.editor.destroy();
  } catch {
    /* swallow — Milkdown teardown can throw `removeEventListener is
       not defined` under jsdom; the new mount overwrites whatever
       remains. */
  }
  // Clear any zombie .ProseMirror nodes the destroy left behind so
  // the new editor mounts cleanly.
  host.replaceChildren();

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, body);
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: () => true,
        attributes: {
          'aria-readonly': 'false',
          'role': 'textbox',
          'tabindex': '0',
          'contenteditable': 'true',
        },
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
  sanitizeUrlAttributes(host);
  installBrokenImageFallback(host);
  // Preserve the captured frontmatter byte-equal across the flip
  // (AC 5.6 cross-pin).
  mountedViewers.set(host, { editor, frontmatter: entry.frontmatter });
  return editor;
}

// Issue #91 / AC 5.4 — Read-only remount seam. Symmetric to
// `_remountAsEditable`: tears down the editable editor and remounts as
// read-only on the same host with the live serialized body, preserving
// the captured frontmatter byte-equal. Used by `exitEditMode` (the
// reverse of AC 5.1's enterEditMode) so the sign-out flow can revert
// to anonymous viewer state without re-fetching the spec.
//
// Returns the new Editor on success, or `null` when no viewer is
// mounted in `host` (defensive floor — exitEditMode is a no-op when
// nothing's there to revert).
export async function _remountAsReadOnly(
  host: HTMLElement,
): Promise<Editor | null> {
  const entry = mountedViewers.get(host);
  if (!entry) return null;

  const body = entry.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const serializer = ctx.get(serializerCtx);
    return serializer(view.state.doc);
  });

  try {
    await entry.editor.destroy();
  } catch {
    /* swallow — see _remountAsEditable for rationale */
  }
  host.replaceChildren();

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
  mountedViewers.set(host, { editor, frontmatter: entry.frontmatter });
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

function normalizeUrlForSchemeMatch(value: string): string {
  // Strip zero-width chars (ZWSP, ZWNJ, ZWJ, BOM) that browsers ignore
  // when resolving the scheme but a naive regex would not.
  const stripped = value.replace(/[​‌‍﻿]/g, '');
  // Percent-decode once. Malformed sequences (e.g. lone `%`) throw —
  // treat as suspicious by returning the stripped form so scheme match
  // falls through to the disallowed branch if it was a scheme attempt.
  let decoded: string;
  try {
    decoded = decodeURIComponent(stripped);
  } catch {
    decoded = stripped;
  }
  return decoded.trim().toLowerCase();
}

function isSafeUrl(value: string): boolean {
  // Relative URLs (no scheme — `#section`, `./foo.md`, `foo.md`) are
  // safe. Detect a scheme by the same shape browsers use: optional
  // leading whitespace, then `[a-zA-Z][a-zA-Z0-9+.-]*:`. Normalize
  // first so zero-width and percent-encoded smuggling can't bypass.
  const normalized = normalizeUrlForSchemeMatch(value);
  const match = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (!match) return true; // no scheme → relative → safe
  return SAFE_URL_SCHEMES.has(match[1]! + ':');
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
