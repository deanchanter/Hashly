// Issue #91 / AC 5.1 — Web edit-mode toggle.
//
// `enterEditMode(host)` flips a mounted read-only viewer (Issue #90 /
// AC 4.4) into an editable Milkdown buffer and surfaces a formatting
// toolbar. v0.2 desktop's `toggleEditMode` shape carried over: destroy
// the read-only editor, remount the same body with `editable: () =>
// true` (delegated to `_remountAsEditable` in `src/viewer.ts` so the
// captured frontmatter survives byte-equal — AC 5.6 cross-pin).
//
// Pinned contract (see `src/__tests__/edit-mode-toggle.test.ts`):
// 1. .ProseMirror flips contenteditable false → true and aria-readonly
//    true → false on the same host.
// 2. The rendered body content survives the flip (no data loss).
// 3. AC 5.6 byte-equal frontmatter still re-emits via
//    `getViewerMarkdown(host)`.
// 4. A `[data-testid="edit-toolbar"]` element appears with at least one
//    <button> child.
// 5. Safe no-op when no viewer is mounted: returns a resolved promise
//    without throwing or mutating the DOM.
// 6. Idempotent: a second sequential call leaves exactly one
//    .ProseMirror and one toolbar.
// 7. After the flip, the live editor accepts dispatches (not a zombie
//    that re-emits but doesn't take transactions).
//
// `getEditModeEditor(host)` is the JIT replay seam AC 5.2 uses to
// re-apply intercepted formatting actions after auth resolves; same
// shape as v0.2 desktop's `getCurrentEditor()`.

import type { Editor } from '@milkdown/core';
import { _remountAsEditable } from './viewer';

// Per-host edit-mode editor registry. Doubles as the idempotency
// guard: a second call to `enterEditMode` for a host already in edit
// mode is a no-op (no second remount, no second toolbar). WeakMap so
// hosts removed from the DOM get GC'd.
const editModeEditors = new WeakMap<HTMLElement, Editor>();

const EDIT_TOOLBAR_TESTID = 'edit-toolbar';

function ensureEditToolbar(): void {
  if (document.querySelector(`[data-testid="${EDIT_TOOLBAR_TESTID}"]`)) return;
  const toolbar = document.createElement('div');
  toolbar.setAttribute('data-testid', EDIT_TOOLBAR_TESTID);
  toolbar.className = 'edit-toolbar';

  // MVP affordance: a single Save button. AC 5.1 only pins the form
  // factor (toolbar with at least one <button>); the actual save flow
  // lands in #92, so this stays a placeholder for now.
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.setAttribute('data-testid', 'edit-toolbar-save');
  toolbar.appendChild(saveBtn);

  document.body.appendChild(toolbar);
}

export async function enterEditMode(host: HTMLElement): Promise<void> {
  // Idempotency floor: already in edit mode → benign no-op.
  if (editModeEditors.has(host)) return;

  // _remountAsEditable returns null when no viewer is mounted in host
  // — the click-before-mount defensive path. Bail without surfacing
  // affordances so the user isn't misled into thinking there's a live
  // editor to format.
  const editor = await _remountAsEditable(host);
  if (editor === null) return;

  editModeEditors.set(host, editor);
  ensureEditToolbar();
}

export function getEditModeEditor(host: HTMLElement): Editor | null {
  return editModeEditors.get(host) ?? null;
}

// Issue #91 / AC 5.2 — JIT auth pause-and-redirect.
//
// Behavior pinned by `src/__tests__/jit-auth.test.ts`:
//   1. fetch('/api/session-status', { credentials: 'same-origin' })
//   2a. 200       → await enterEditMode(host); no redirect.
//   2b. non-2xx   → window.location.assign('/auth/start?return=<encoded current href>'); no flip.
//   2c. network error → resolve, do NOT throw (defensive floor).
//   3. Sync-race idempotent — two synchronous calls share ONE fetch
//      and ONE flip via a module-local pending-promise lock. This
//      addresses the AC 5.1 heads-up: WeakMap-based idempotency in
//      enterEditMode breaks against synchronous re-entrancy because
//      the first call's first await releases control before the
//      WeakMap.set lands.
//
// Module-local pending lock — `null` when no attempt is in-flight,
// otherwise the in-flight Promise. A second call while the first is
// pending returns the SAME promise, deduping the fetch. Cleared in
// the finally so consecutive (non-overlapping) attempts always
// re-fetch (the session may have been revoked between attempts).
let pendingAttempt: Promise<void> | null = null;

export async function attemptEditAction(host: HTMLElement): Promise<void> {
  if (pendingAttempt) return pendingAttempt;

  pendingAttempt = (async () => {
    try {
      let response: Response;
      try {
        response = await fetch('/api/session-status', {
          credentials: 'same-origin',
        });
      } catch {
        // Network error (TypeError on offline / DNS down) — defensive
        // floor: resolve without rejecting so the WebView console
        // doesn't surface an unhandled rejection. We don't redirect
        // either: a transient network blip shouldn't bounce the user
        // through the auth flow.
        return;
      }
      if (response.ok) {
        await enterEditMode(host);
        return;
      }
      // 401 / 5xx / any non-2xx → treat as unauthed → pause-and-redirect.
      // Pause = do NOT call enterEditMode so the read-only DOM stays
      // read-only. The full current href (including `?repo=...&path=
      // ...&ref=...`) round-trips through encodeURIComponent so the
      // post-auth callback can land back on the same spec.
      const returnParam = encodeURIComponent(window.location.href);
      window.location.assign(`/auth/start?return=${returnParam}`);
    } finally {
      pendingAttempt = null;
    }
  })();

  return pendingAttempt;
}
