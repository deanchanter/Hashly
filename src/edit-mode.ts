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
import { _remountAsEditable, _remountAsReadOnly, getViewerMarkdown } from './viewer';
import { parseSpecUrl } from './router';
import { submitSave } from './save-flow';
import {
  clearSaveBanners,
  renderSaveConflict,
  renderSaveError,
  renderSaveSuccess,
} from './save-result';

// Per-host edit-mode editor registry. Doubles as the idempotency
// guard: a second call to `enterEditMode` for a host already in edit
// mode is a no-op (no second remount, no second toolbar). WeakMap so
// hosts removed from the DOM get GC'd.
const editModeEditors = new WeakMap<HTMLElement, Editor>();

// Issue #92 / AC 6.1 — per-host baseSha stash. Set by enterEditMode's
// `opts.baseSha` and read by the Save click handler. WeakMap so hosts
// removed from the DOM get GC'd. Absence (not set, or set to a non-
// string) means "no anchor" — the click handler refuses to save in
// that case (AC 6.4 stale-SHA safe default).
const editModeBaseShas = new WeakMap<HTMLElement, string>();

// Issue #92 / AC 6.1 — per-host in-flight lock. A second click
// while the first POST is still pending is dropped (NOT queued).
// Per-host (not module-global) so independent edit sessions don't
// share a lock; this also matches the per-host editModeEditors /
// editModeBaseShas registries above. When the host is removed
// from the DOM (e.g., a test sets `document.body.innerHTML = ''`),
// the WeakMap entry becomes GC-eligible and the next host gets a
// fresh slot.
const pendingSaves = new WeakMap<HTMLElement, Promise<unknown>>();

const EDIT_TOOLBAR_TESTID = 'edit-toolbar';

// Issue #91 / AC 5.3 — sessionStorage key for the post-auth restore
// flag. Set in attemptEditAction's 401-redirect path; consumed in
// bootstrapWeb's auto-restore path. Exported so the bootstrap reader
// and the writer agree on the literal key without duplicating it.
export const PENDING_EDIT_KEY = 'hashly-pending-edit';

function ensureEditToolbar(host: HTMLElement): void {
  if (document.querySelector(`[data-testid="${EDIT_TOOLBAR_TESTID}"]`)) return;
  const toolbar = document.createElement('div');
  toolbar.setAttribute('data-testid', EDIT_TOOLBAR_TESTID);
  toolbar.className = 'edit-toolbar';

  // Issue #92 / AC 6.1 — Save button is now active. Click handler
  // posts the live editor body + baseSha anchor to /api/save via
  // `submitSave`. The button is scoped to THIS host's toolbar
  // (closure-captured) so a manually-injected stray button with the
  // same testid is ignored.
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.setAttribute('data-testid', 'edit-toolbar-save');
  saveBtn.disabled = false;
  saveBtn.addEventListener('click', () => {
    onSaveClick(host);
  });
  toolbar.appendChild(saveBtn);

  // Issue #91 fix-loop-3 / fix #1 — Inline the toolbar inside the
  // editor host (was: document.body). The fixed-position shape kept
  // colliding with above-fold UI (iter-2 fix #3: header overlap;
  // iter-3 fix #1: post-auth-prompt overlap). Parenting to the host
  // and letting the toolbar live in normal flow eliminates the entire
  // fixed-position collision class. host.prepend so the toolbar sits
  // above the .ProseMirror; if a prompt is also prepended later, the
  // prompt ends up above the toolbar (correct UX: info → action bar).
  host.prepend(toolbar);
}

export interface EnterEditModeOptions {
  // Issue #92 / AC 6.1 — Captured-at-edit-entry SHA for stale-SHA
  // detection (AC 6.4). The Save click handler reads this stash; if
  // absent, the handler refuses to save (AC 6.1 + AC 6.4 safe default).
  baseSha?: string;
}

export async function enterEditMode(
  host: HTMLElement,
  opts: EnterEditModeOptions = {},
): Promise<void> {
  // Idempotency floor: already in edit mode → benign no-op.
  if (editModeEditors.has(host)) return;

  // _remountAsEditable returns null when no viewer is mounted in host
  // — the click-before-mount defensive path. Bail without surfacing
  // affordances so the user isn't misled into thinking there's a live
  // editor to format.
  const editor = await _remountAsEditable(host);
  if (editor === null) return;

  editModeEditors.set(host, editor);
  if (typeof opts.baseSha === 'string' && opts.baseSha.length > 0) {
    editModeBaseShas.set(host, opts.baseSha);
  }
  ensureEditToolbar(host);

  // Issue #158 / AC 4.4 — Cmd+S (Mac) / Ctrl+S (other) triggers the
  // same save path as the toolbar Save button. The per-host
  // `pendingSaves` lock in `onSaveClick` covers both input sources,
  // so rapid Cmd+S during an in-flight save is dropped.
  host.addEventListener('keydown', (ev) => {
    if (!(ev.metaKey || ev.ctrlKey)) return;
    if ((ev.key || '').toLowerCase() !== 's') return;
    ev.preventDefault();
    onSaveClick(host);
  });
}

// Issue #92 / AC 6.1 — Save button click handler. Scoped to the host
// captured at toolbar-mount time. Reads URL coords + live editor body
// + baseSha anchor and POSTs via `submitSave`. Refuses to save when
// any of those are missing (defensive floors).
function onSaveClick(host: HTMLElement): void {
  if (pendingSaves.has(host)) return;
  if (!editModeEditors.has(host)) return; // not in edit mode

  const baseSha = editModeBaseShas.get(host);
  if (typeof baseSha !== 'string' || baseSha.length === 0) {
    // AC 6.4 safe default — no anchor, no save. Without baseSha the
    // worker can't detect upstream conflicts; refusing protects the
    // user from silently overwriting changes they never saw.
    return;
  }

  const parsed = parseSpecUrl(document.URL);
  if ('error' in parsed) return; // can't compose the request

  const content = getViewerMarkdown(host);
  if (content === null) return; // no viewer mounted

  // fix-loop iter-1 / fix #14 — clear stale save-* banners
  // synchronously, BEFORE the fetch. Without this, a user retrying
  // after a failure sees the stale error banner persist for the
  // entire network round-trip; the next renderSave* clears it only
  // when the fetch resolves.
  clearSaveBanners(host);

  // fix-loop iter-1 / fix #7 — in-flight visual state. Query the
  // button at click time (not closure-captured) so a re-mounted
  // toolbar doesn't leave us holding a stale node. Restoration
  // happens in the `finally` so it covers success, structured
  // failure (no-write / conflict / network / other), AND any
  // unexpected throw.
  const saveBtn = document.querySelector<HTMLButtonElement>(
    `[data-testid="edit-toolbar-save"]`,
  );
  const originalText = saveBtn?.textContent ?? 'Save';

  const promise = (async () => {
    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.setAttribute('aria-busy', 'true');
        saveBtn.textContent = 'Saving…';
      }

      const result = await submitSave({
        repo: parsed.repo,
        path: parsed.path,
        ref: parsed.ref,
        content,
        baseSha,
      });
      // Issue #92 / AC 6.3 — render the success banner with the PR URL
      // round-tripped from the worker response.
      // Issue #92 / AC 6.5 — render the conflict banner with a fresh-
      // read getContent so the Copy button captures any post-render
      // edits the user made before clicking.
      // fix-loop iter-1 / fix #2 — wire the remaining error kinds
      // (no-write / network / unauth / other) to renderSaveError.
      // Without this, AC 6.7's literal phrase never reaches the user
      // (worker translates the GitHub 403 correctly, but the click
      // handler discards the message).
      if (result.ok) {
        renderSaveSuccess(host, result.prUrl);
      } else if (result.kind === 'conflict') {
        renderSaveConflict(host, {
          getContent: () => getViewerMarkdown(host) ?? '',
        });
      } else if (result.kind === 'network') {
        renderSaveError(
          host,
          "Couldn't reach the server — please check your connection and try again.",
        );
      } else if (result.kind === 'unauth') {
        renderSaveError(
          host,
          'Your session expired — please sign back in and retry.',
        );
      } else {
        // 'no-write' or 'other' — the worker's message is the
        // user-facing copy. AC 6.7's verbatim phrase round-trips here.
        renderSaveError(host, result.message);
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.setAttribute('aria-busy', 'false');
        saveBtn.textContent = originalText;
      }
      pendingSaves.delete(host);
    }
  })();
  pendingSaves.set(host, promise);
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
// Issue #91 fix-loop-2 / fix #2 + fix-loop-3 / fix #2 — Terminal-state
// return so the bootstrap restore branch can branch on "did edit
// mode actually activate" before rendering the post-auth prompt
// (iter-2), AND so the keydown listener can self-remove on the
// locked terminal too (iter-3, otherwise every keystroke at OS
// autorepeat fires another fetch chain — ~85s of held-down typing
// exhausts GitHub's 5000/hr install rate limit).
//
// Values:
//   - 'success' → 200 + push:true → enterEditMode fired
//   - 'locked'  → 200 + push:false (DETERMINISTIC denial) →
//                 renderViewOnlyLock; keydown listener removes
//   - undefined → everything else (cancelled / redirected / network
//                 error / perms-fetch error / missing-field / 4xx /
//                 5xx). Keeps AC 5.2 / 5.5 defensive-floor tests
//                 (which pin `resolves.toBeUndefined()`) green.
//                 Listener stays attached so transient failures can
//                 be retried by typing again.
export type EditAttemptResult = 'success' | 'locked' | undefined;

// Module-local pending lock — `null` when no attempt is in-flight,
// otherwise the in-flight Promise. A second call while the first is
// pending returns the SAME promise, deduping the fetch. Cleared in
// the finally so consecutive (non-overlapping) attempts always
// re-fetch (the session may have been revoked between attempts).
let pendingAttempt: Promise<EditAttemptResult> | null = null;

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
): Promise<EditAttemptResult> {
  if (pendingAttempt) return pendingAttempt;

  pendingAttempt = (async (): Promise<EditAttemptResult> => {
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
        return undefined;
      }
      if (response.ok) {
        // Issue #91 / AC 5.5 + fix-loop-3 / fix #2 — Tristate access
        // check. 'allowed' unlocks edit mode; 'denied' renders the
        // view-only lock and returns the 'locked' terminal so the
        // keydown listener can self-remove (every subsequent
        // keystroke would otherwise refire the chain). 'unknown'
        // (network error / 4xx / 5xx / missing field) ALSO renders
        // the lock but returns undefined — listener stays attached
        // so transient failures can be retried by typing.
        const access = await checkWriteAccess();
        if (access === 'allowed') {
          await enterEditMode(host);
          return 'success';
        }
        renderViewOnlyLock(host);
        return access === 'denied' ? 'locked' : undefined;
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
        return undefined;
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
      return undefined;
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

// Issue #91 / AC 5.5 + fix-loop-3 / fix #2 — Resolve write access for
// the current spec URL. Three-state result so the keystroke-storm
// fix can distinguish "deterministic deny" (server said push:false)
// from "couldn't determine" (network error, 4xx/5xx, missing field).
// Only the deterministic-deny case warrants removing the JIT keydown
// listener — transient errors should let the user retry.
//
//   - 'allowed' → response is 200 with `permissions.push === true`
//   - 'denied'  → response is 200 with `permissions.push === false`
//   - 'unknown' → any other shape (parse error, network throw, 4xx,
//                 5xx, missing-field, malformed-URL). Caller treats
//                 this as view-only too, but keeps the listener
//                 attached for retries.
async function checkWriteAccess(): Promise<'allowed' | 'denied' | 'unknown'> {
  // Use `document.URL` rather than `window.location.href` so the live
  // document URL is read (history.replaceState updates document.URL
  // even when test fixtures stub out window.location). They agree in
  // production; only diverge in test sandboxes that override location.
  const parsed = parseSpecUrl(document.URL);
  if ('error' in parsed) return 'unknown';
  let response: Response | undefined;
  try {
    response = await fetch(`/api/github/repos/${parsed.repo}`, {
      credentials: 'same-origin',
    });
  } catch {
    return 'unknown';
  }
  if (!response || !response.ok) return 'unknown';
  try {
    const body = (await response.json()) as {
      permissions?: { push?: unknown };
    };
    if (body.permissions?.push === true) return 'allowed';
    if (body.permissions?.push === false) return 'denied';
    return 'unknown';
  } catch {
    return 'unknown';
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
