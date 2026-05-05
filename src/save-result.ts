// Issue #92 — Save-result banner family.
//
// Mirrors the renderViewOnlyLock (AC 5.5) / renderPostAuthPrompt (AC
// 5.3) pattern: small, idempotent DOM mutators that prepend a banner
// to a host element so the message sits ABOVE the editor body.
//
// Pinned testids:
//   - `save-error`    (AC 6.7)
//   - `save-success`  (AC 6.3)
//   - `save-conflict` (AC 6.5)
//
// The save-* family is mutually exclusive — only one banner from this
// family may be visible at a time. Each renderer clears the others
// before prepending its own.

const SAVE_ERROR_TESTID = 'save-error';
const SAVE_SUCCESS_TESTID = 'save-success';
const SAVE_CONFLICT_TESTID = 'save-conflict';

// AC 6.5 — VERBATIM user-facing copy. Issue #92 AC body locks this
// phrase (lowercase + semicolon).
const CONFLICT_PHRASE =
  'your edit and an upstream change overlap; please reload';

function clearSaveBanners(host: HTMLElement): void {
  host
    .querySelectorAll(
      `[data-testid="${SAVE_ERROR_TESTID}"], [data-testid="${SAVE_SUCCESS_TESTID}"], [data-testid="${SAVE_CONFLICT_TESTID}"]`,
    )
    .forEach((el) => el.remove());
}

export function renderSaveError(host: HTMLElement, message: string): void {
  clearSaveBanners(host);

  const banner = document.createElement('div');
  banner.setAttribute('data-testid', SAVE_ERROR_TESTID);
  banner.setAttribute('role', 'alert');
  banner.className = 'hashly-save-error';
  banner.textContent = message;

  host.prepend(banner);
}

export function renderSaveSuccess(host: HTMLElement, prUrl: string): void {
  clearSaveBanners(host);

  const banner = document.createElement('div');
  banner.setAttribute('data-testid', SAVE_SUCCESS_TESTID);
  banner.setAttribute('role', 'status');
  banner.className = 'hashly-save-success';

  // The AC literal is "view on GitHub". target="_blank" preserves
  // the user's edit context; rel="noopener noreferrer" mirrors the
  // viewer-header__github-link pattern (AC 4.5) — without noopener,
  // target="_blank" is a tabnabbing vector.
  const link = document.createElement('a');
  link.setAttribute('href', prUrl);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  link.textContent = 'View on GitHub';

  banner.appendChild(document.createTextNode('Saved — '));
  banner.appendChild(link);

  host.prepend(banner);
}

export interface RenderSaveConflictOpts {
  // Fresh-read seam: the click handler invokes this each time the
  // user hits Copy so post-render edits also reach the clipboard
  // (AC 6.5 — "preserve user's in-memory content").
  getContent: () => string;
}

export function renderSaveConflict(
  host: HTMLElement,
  opts: RenderSaveConflictOpts,
): void {
  clearSaveBanners(host);

  const banner = document.createElement('div');
  banner.setAttribute('data-testid', SAVE_CONFLICT_TESTID);
  banner.setAttribute('role', 'alert');
  banner.className = 'hashly-save-conflict';

  const message = document.createElement('span');
  message.textContent = CONFLICT_PHRASE;
  banner.appendChild(message);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy your edit';
  copyBtn.className = 'hashly-save-conflict__copy';
  copyBtn.addEventListener('click', () => {
    // Fresh-read on every click: a regression that captures content
    // at render time would lose any post-render edits. The banner is
    // NOT removed on copy — the user may need to copy more than once.
    const content = opts.getContent();
    void navigator.clipboard.writeText(content);
  });
  banner.appendChild(copyBtn);

  host.prepend(banner);
}
