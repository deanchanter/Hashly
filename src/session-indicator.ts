// Issue #91 / AC 5.4 — Session indicator (avatar) + sign-out.
//
// `mountSessionIndicator(host)` queries `/api/session-status`. On a
// 200 with `{user: {login, avatar_url}}` it appends the user's avatar
// img + a sign-out button to `host` (the AC 4.5 viewer-header). On
// 401 it's a no-op (anonymous viewer state — no avatar, no button).
//
// The sign-out button calls `POST /auth/logout`. On 200 it removes the
// avatar + button AND reverts the editor (host element `#editor`) to
// read-only via `exitEditMode`. On non-2xx the UI stays as-is — the
// session is still live server-side; the UI must not falsely claim
// success.
//
// Defensive: the avatar URL flows from KV → session-status → DOM. We
// allow only `https:` schemes (GitHub avatars are always https). Same
// shape as Issue #90 fix #1's URL-scheme sanitizer.

import { exitEditMode } from './edit-mode';

interface SessionStatusUser {
  login: string;
  avatar_url: string;
}

interface SessionStatusResponse {
  ok?: boolean;
  user?: SessionStatusUser;
}

const AVATAR_TESTID = 'session-avatar';
const SIGN_OUT_TESTID = 'sign-out';

function isSafeAvatarUrl(value: string): boolean {
  // Only https:// — GitHub serves avatars exclusively over HTTPS, and
  // anything else (data:, javascript:, vbscript:, http:) is either
  // illegitimate or downgrade-attackable.
  const trimmed = value.trim();
  return /^https:\/\//i.test(trimmed);
}

export async function mountSessionIndicator(host: HTMLElement): Promise<void> {
  let response: Response | undefined;
  try {
    response = await fetch('/api/session-status', {
      credentials: 'same-origin',
    });
  } catch {
    // Network error — no avatar, no button (anonymous fallback).
    return;
  }
  // Defensive against undefined responses (test fixtures without a
  // mock for this endpoint return undefined from `vi.fn()`).
  if (!response || !response.ok) return;

  let body: SessionStatusResponse;
  try {
    body = (await response.json()) as SessionStatusResponse;
  } catch {
    return;
  }
  const user = body.user;
  if (!user || typeof user.avatar_url !== 'string') return;

  const wrapper = document.createElement('div');
  wrapper.className = 'session-indicator';
  wrapper.setAttribute('data-testid', 'session-indicator');

  if (isSafeAvatarUrl(user.avatar_url)) {
    const img = document.createElement('img');
    img.setAttribute('data-testid', AVATAR_TESTID);
    img.src = user.avatar_url;
    img.alt = user.login ?? 'Signed-in user';
    img.className = 'session-indicator__avatar';
    // Issue #91 fix-loop-1 / fix #8 — onerror fallback to initials
    // badge. Without this, a 404 / network error / image-deleted
    // avatar renders as the browser's default broken-image glyph,
    // making the app look broken.
    img.addEventListener('error', () => {
      const initial = (user.login?.[0] ?? '?').toUpperCase();
      const fallback = document.createElement('span');
      fallback.setAttribute('data-testid', 'avatar-fallback');
      fallback.className = 'session-indicator__avatar session-indicator__avatar--fallback';
      fallback.textContent = initial;
      img.replaceWith(fallback);
    });
    wrapper.appendChild(img);
  }

  const signOutBtn = document.createElement('button');
  signOutBtn.type = 'button';
  signOutBtn.setAttribute('data-testid', SIGN_OUT_TESTID);
  signOutBtn.className = 'session-indicator__sign-out';
  signOutBtn.textContent = 'Sign out';
  signOutBtn.addEventListener('click', () => {
    void handleSignOutClick(wrapper);
  });
  wrapper.appendChild(signOutBtn);

  host.appendChild(wrapper);
}

async function handleSignOutClick(wrapper: HTMLElement): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    // Network error — leave the UI alone (session still live server-side).
    return;
  }
  if (!response.ok) return;

  // Remove the indicator from the DOM (avatar img + sign-out button).
  if (wrapper.parentElement) {
    wrapper.parentElement.removeChild(wrapper);
  }
  // Issue #91 fix-loop-1 / fix #7 — clear stale signed-in banners.
  // The view-only-lock + post-auth-prompt are anchored to the prior
  // session; surviving past sign-out misleads anonymous users into
  // thinking they still have access state.
  document
    .querySelectorAll('[data-testid="view-only-lock"], [data-testid="post-auth-prompt"]')
    .forEach((el) => el.parentElement?.removeChild(el));
  // Revert the editor to read-only if it was in edit mode. AC 5.4
  // pins the editor host as `#editor` — the bootstrap convention.
  const editorHost = document.getElementById('editor');
  if (editorHost) {
    await exitEditMode(editorHost);
  }
}
