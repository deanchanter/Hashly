import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
} from '@milkdown/core';
import { installBrokenImageFallback } from './broken-image-fallback';
import { commonmark, headingIdGenerator } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import '@milkdown/prose/view/style/prosemirror.css';
import type { EditorView } from '@milkdown/prose/view';
import type { Transaction } from '@milkdown/prose/state';
import './style.css';
import { parseFrontmatter, type FrontmatterParse } from './frontmatter';
import { parseSpecUrl } from './router';
import { fetchSpec } from './fetch-spec';
import { renderLanding } from './landing';
import { renderViewerHeader, setEditButtonEnabled } from './viewer-header';
import { renderViewerError } from './viewer-error';
import { mountViewer } from './viewer';
import { attemptEditAction, PENDING_EDIT_KEY } from './edit-mode';
import { mountSessionIndicator } from './session-indicator';
import { showBanner, type BannerHandle } from './ui/banner';

export type EditorMode = 'read' | 'edit';

export { parseFrontmatter, type FrontmatterParse };

export async function mountEditor(
  host: HTMLElement,
  content: string,
  mode: EditorMode = 'read',
): Promise<Editor> {
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
              dispatchTransaction(this: EditorView, tr: Transaction) {
                this.updateState(this.state.apply(tr));
                if (armRef.armed && tr.docChanged) {
                  // dirty tracking is intentionally a no-op in web mode —
                  // there is no document.title bullet, no Cmd+S, and
                  // edits are flushed to GitHub via the explicit Save
                  // button. The wrapper is preserved as a hook for
                  // future signaling (e.g. unsaved-edit prompt).
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
    setTimeout(() => {
      armRef.armed = true;
    }, 0);
  }
  installBrokenImageFallback(host);
  return editor;
}

export function bootstrap(): void {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('editor');
  if (!host) {
    console.warn('[hashly] #editor host element not found; mountEditor not auto-invoked');
    return;
  }
  const headerHost = document.getElementById('viewer-header') ?? host;
  void bootstrapWeb(host, headerHost, window.location.href);
}

async function bootstrapWeb(
  host: HTMLElement,
  headerHost: HTMLElement,
  href: string,
): Promise<void> {
  // Web surfaces (landing / viewer-header) own their own wordmark.
  // The static `.hashly-titlebar` from the v0.2 desktop chrome would
  // stack a second branded header if it shipped through, so it gets
  // stripped on bootstrap.
  document.querySelectorAll('.hashly-titlebar').forEach((el) => el.remove());
  const parsed = parseSpecUrl(href);
  if ('error' in parsed) {
    renderLanding(host, parsed.error);
    return;
  }
  renderViewerHeader(headerHost, parsed, () => {
    void attemptEditAction(host);
  });

  // Issue #158 / AC 4.9 — visible loading indicator while the spec
  // fetch is in flight. Dismissed before mountViewer (success) or
  // before renderViewerError (failure).
  let loadingBanner: BannerHandle | null = showBanner(host, {
    kind: 'info',
    message: 'Loading spec…',
  });
  const dismissLoading = (): void => {
    if (loadingBanner) {
      try { loadingBanner.dismiss(); } catch { /* noop */ }
      loadingBanner = null;
    }
  };

  let result: Awaited<ReturnType<typeof fetchSpec>>;
  try {
    result = await fetchSpec(parsed.repo, parsed.ref, parsed.path);
  } finally {
    dismissLoading();
  }
  if (!result.ok) {
    // Issue #158 / AC 4.8 — failure surface includes retry + back
    // affordances and updates document.title (#108).
    document.title = `Couldn't load spec — Hashly`;
    renderViewerError(host, result, {
      onRetry: () => {
        void bootstrapWeb(host, headerHost, href);
      },
      onBack: () => {
        renderLanding(host, 'Paste a GitHub spec URL to get started.');
      },
    });
    return;
  }
  try {
    await mountViewer(host, result.content);
  } catch (e) {
    console.error('[hashly] bootstrapWeb: mountViewer rejected', e);
    return;
  }
  document.title = `${parsed.path} — Hashly`;
  setEditButtonEnabled(headerHost, true);
  void mountSessionIndicator(headerHost);

  // Keydown trigger for the JIT auth flow — secondary entry point
  // (the Edit button is primary). Filters to content-modifying keys
  // and self-removes after the verdict is deterministic so OS auto-
  // repeat can't refire the JIT chain per key.
  const keydownHandler = (event: KeyboardEvent): void => {
    if (!isContentModifyingKey(event)) return;
    event.preventDefault();
    void (async () => {
      const result = await attemptEditAction(host);
      if (result === 'success' || result === 'locked') {
        host.removeEventListener('keydown', keydownHandler);
      }
    })();
  };
  host.addEventListener('keydown', keydownHandler);

  // Post-auth restore — the user just returned from the OAuth round-
  // trip; consume the one-shot pending-edit flag, auto-flip into edit
  // mode, and surface the "your edit was paused" prompt.
  let pending: string | null = null;
  try {
    pending = sessionStorage.getItem(PENDING_EDIT_KEY);
  } catch {
    // sessionStorage may throw in private-mode / quota-full edge cases.
  }
  if (pending !== null) {
    try {
      sessionStorage.removeItem(PENDING_EDIT_KEY);
    } catch {
      /* swallow */
    }
    const result = await attemptEditAction(host, { isRestore: true });
    if (result === 'success') {
      renderPostAuthPrompt(host);
    }
    if (result === 'success' || result === 'locked') {
      host.removeEventListener('keydown', keydownHandler);
    }
  }
}

// Keys that count as "the user is starting to edit." Modifiers and
// navigation keys are excluded so keyboard users can move around the
// read-only viewer without triggering the JIT auth flow.
function isContentModifyingKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (
    event.key === 'Backspace' ||
    event.key === 'Delete' ||
    event.key === 'Enter'
  ) {
    return true;
  }
  if (event.key.length === 1) return true;
  return false;
}

function renderPostAuthPrompt(host: HTMLElement): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('[data-testid="post-auth-prompt"]')) return;
  const prompt = document.createElement('div');
  prompt.setAttribute('data-testid', 'post-auth-prompt');
  prompt.setAttribute('role', 'status');
  prompt.className = 'hashly-post-auth-prompt';
  prompt.textContent =
    "You're signed in. Please redo your edit — we couldn't restore the original action.";
  host.prepend(prompt);
}

if (import.meta.env.MODE !== 'test') {
  bootstrap();
}
