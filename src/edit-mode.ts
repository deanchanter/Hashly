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
import { _remountAsEditable, _remountAsReadOnly } from './viewer';
import { parseSpecUrl } from './router';

// Per-host edit-mode editor registry. Doubles as the idempotency
// guard: a second call to `enterEditMode` for a host already in edit
// mode is a no-op (no second remount, no second toolbar). WeakMap so
// hosts removed from the DOM get GC'd.
const editModeEditors = new WeakMap<HTMLElement, Editor>();

const EDIT_TOOLBAR_TESTID = 'edit-toolbar';

// Issue #91 / AC 5.3 — sessionStorage key for the post-auth restore
// flag. Set in attemptEditAction's 401-redirect path; consumed in
// bootstrapWeb's auto-restore path. Exported so the bootstrap reader
// and the writer agree on the literal key without duplicating it.
export const PENDING_EDIT_KEY = 'hashly-pending-edit';

function ensureEditToolbar(): void {
  if (document.querySelector(`[data-testid="${EDIT_TOOLBAR_TESTID}"]`)) return;
  const toolbar = document.createElement('div');
  toolbar.setAttribute('data-testid', EDIT_TOOLBAR_TESTID);
  toolbar.className = 'edit-toolbar';

  // MVP affordance: a single Save button. AC 5.1 only pins the form
  // factor (toolbar with at least one <button>); the actual save flow
  // lands in #92, so this stays a placeholder for now.
  //
  // Issue #91 fix-loop-1 / fix #6 — disabled until #92 lands so a
  // click doesn't look broken. aria-disabled mirrors the .disabled
  // property so screen readers announce the state; title gives
  // hovering users the rationale.
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.setAttribute('data-testid', 'edit-toolbar-save');
  saveBtn.disabled = true;
  saveBtn.setAttribute('aria-disabled', 'true');
  saveBtn.title = 'Save flow ships in #92 — disabled for now.';
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

// Issue #91 / AC 5.4 — sign-out reverse mechanism. AC 5.1 was
// explicitly one-way (no exitEditMode in the web JIT flow); AC 5.4's
// sign-out introduces the reverse so a signing-out user doesn't get
// stranded in edit mode without a session.
//
// Mirrors enterEditMode's destroy + remount pattern via the symmetric
// `_remountAsReadOnly` viewer helper, so the captured frontmatter
// survives byte-equal (AC 5.6 cross-pin). Removes the WeakMap entry
// so a subsequent enterEditMode reactivates cleanly. Removes the
// edit-toolbar from the DOM. Safe no-op when no edit-mode editor is
// mounted (defensive floor: a stray sign-out from anonymous state must
// not throw).
export async function exitEditMode(host: HTMLElement): Promise<void> {
  if (!editModeEditors.has(host)) return;
  await _remountAsReadOnly(host);
  editModeEditors.delete(host);
  const toolbar = document.querySelector(
    `[data-testid="${EDIT_TOOLBAR_TESTID}"]`,
  );
  if (toolbar?.parentElement) toolbar.parentElement.removeChild(toolbar);
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

export interface AttemptEditOptions {
  // Issue #91 fix-loop-1 / fix #5 — Distinguish the first-time JIT
  // attempt (user-typed → redirect → stash flag) from the post-auth
  // restore path (bootstrap consumed the flag → re-enter edit mode).
  // On the RESTORE path a 401 means the user clicked back from the
  // GitHub auth screen WITHOUT signing in: re-stashing the flag
  // and redirecting again would put them in an infinite loop. The
  // restore path instead surfaces an "auth cancelled" banner and
  // stays put.
  isRestore?: boolean;
}

export async function attemptEditAction(
  host: HTMLElement,
  options: AttemptEditOptions = {},
): Promise<void> {
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
        // Issue #91 / AC 5.5 — Check write access before unlocking edit
        // mode. The user has a live session but may be read-only on
        // this repo (e.g., a non-collaborator, or a collaborator with
        // read-only perms). The frontend hits GET /api/github/repos/
        // {owner}/{repo} (worker proxy carries the access token) and
        // inspects `permissions.push`. Fail-safe: only an explicit
        // `push: true` unlocks; anything else (push:false, missing
        // field, non-2xx, network error) keeps the editor read-only
        // and surfaces the view-only-lock banner.
        const canEdit = await checkWriteAccess();
        if (canEdit) {
          await enterEditMode(host);
        } else {
          renderViewOnlyLock(host);
        }
        return;
      }
      // 401 / 5xx / any non-2xx → treat as unauthed.
      //
      // Issue #91 fix-loop-1 / fix #5 — Branch on the restore flag.
      // First-time path: stash + redirect (AC 5.2 / 5.3 contract).
      // Restore path: render an "auth cancelled" banner instead — the
      // user just clicked back from GitHub without auth'ing; bouncing
      // them back to /auth/start would loop forever.
      if (options.isRestore) {
        renderAuthCancelledBanner(host);
        return;
      }
      //
      // Issue #91 / AC 5.3 — Stash a one-shot pending-edit flag in
      // sessionStorage BEFORE the redirect lands so bootstrapWeb can
      // detect "we just returned from auth" on the next page load and
      // auto-flip into edit mode + show the "your edit was paused"
      // prompt. sessionStorage is per-tab and persists across the
      // auth round-trip; the flag is consumed (cleared) on the
      // restore path so reloads of the same tab don't re-trigger.
      try {
        sessionStorage.setItem(PENDING_EDIT_KEY, '1');
      } catch {
        // sessionStorage can throw in private browsing / quota-full
        // edge cases. The redirect still proceeds; the user just
        // won't get the auto-restore.
      }
      const returnParam = encodeURIComponent(window.location.href);
      window.location.assign(`/auth/start?return=${returnParam}`);
    } finally {
      pendingAttempt = null;
    }
  })();

  return pendingAttempt;
}

// Issue #91 fix-loop-1 / fix #5 — auth-cancelled banner. Shown when
// the post-auth restore path detects the user landed back without a
// live session (clicked back, denied install on GitHub, etc.). Lets
// the user retry deliberately rather than getting bounced through an
// infinite redirect loop.
const AUTH_CANCELLED_TESTID = 'auth-cancelled';

function renderAuthCancelledBanner(host: HTMLElement): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`[data-testid="${AUTH_CANCELLED_TESTID}"]`)) return;
  const banner = document.createElement('div');
  banner.setAttribute('data-testid', AUTH_CANCELLED_TESTID);
  banner.setAttribute('role', 'status');
  banner.className = 'hashly-auth-cancelled';
  banner.textContent =
    "Sign-in cancelled — you didn't sign in. Try editing again to retry.";
  host.prepend(banner);
}

// Issue #91 / AC 5.5 — Resolve write access for the current spec URL.
// Returns `true` only on an explicit `permissions.push === true` from
// the worker proxy; everything else (missing field, non-2xx, network
// error, malformed JSON) returns `false`. Fail-safe: never unlock
// without confirmation.
async function checkWriteAccess(): Promise<boolean> {
  // Use `document.URL` rather than `window.location.href` so the live
  // document URL is read (history.replaceState updates document.URL
  // even when test fixtures stub out window.location). They agree in
  // production; only diverge in test sandboxes that override location.
  const parsed = parseSpecUrl(document.URL);
  if ('error' in parsed) return false;
  let response: Response | undefined;
  try {
    response = await fetch(`/api/github/repos/${parsed.repo}`, {
      credentials: 'same-origin',
    });
  } catch {
    return false;
  }
  if (!response || !response.ok) return false;
  try {
    const body = (await response.json()) as {
      permissions?: { push?: unknown };
    };
    return body.permissions?.push === true;
  } catch {
    return false;
  }
}

// Issue #91 / AC 5.5 — View-only banner. Surfaces when the user has a
// live session but no push access on the repo. Doesn't replace the
// editor; the user keeps reading the rendered markdown. Idempotent —
// a second call with an existing banner re-uses it (no stacking).
const VIEW_ONLY_LOCK_TESTID = 'view-only-lock';

function renderViewOnlyLock(host: HTMLElement): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`[data-testid="${VIEW_ONLY_LOCK_TESTID}"]`)) return;
  const banner = document.createElement('div');
  banner.setAttribute('data-testid', VIEW_ONLY_LOCK_TESTID);
  banner.setAttribute('role', 'status');
  banner.className = 'hashly-view-only-lock';
  banner.textContent =
    "View-only — you don't have write access to this repo. Ask the dev to add you.";
  // Issue #91 fix-loop-1 / fix #4 — banner ABOVE the editor body so
  // the user sees it without scrolling past the rendered markdown.
  host.prepend(banner);
}
