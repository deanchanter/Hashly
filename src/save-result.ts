// Issue #92 / AC 6.7 — Save-result banner family.
//
// Mirrors the renderViewOnlyLock (AC 5.5) / renderPostAuthPrompt (AC
// 5.3) pattern: a small, idempotent DOM mutator that prepends a banner
// to a host element so the message sits ABOVE the editor body.
//
// Pinned testid: `save-error`. Conflict (AC 6.5) and success (AC 6.3)
// banners get their own testids in their own slices.

const SAVE_ERROR_TESTID = 'save-error';

export function renderSaveError(host: HTMLElement, message: string): void {
  // Idempotent — drop any existing save-error banner first so a retry
  // replaces rather than stacks.
  const existing = host.querySelectorAll(`[data-testid="${SAVE_ERROR_TESTID}"]`);
  existing.forEach((el) => el.remove());

  const banner = document.createElement('div');
  banner.setAttribute('data-testid', SAVE_ERROR_TESTID);
  banner.setAttribute('role', 'alert');
  banner.className = 'hashly-save-error';
  banner.textContent = message;

  // Prepend so the banner sits above the editor body.
  host.prepend(banner);
}
