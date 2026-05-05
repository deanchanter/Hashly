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

// fix-loop iter-2 / fix #2 — icon glyph at the leading edge of each
// banner. Survives any CSS palette-token collapse (Unicode is mode-
// stable by construction) and helps colorblind users distinguish
// kinds where border-left color alone is insufficient. `aria-hidden`
// because the banner's text content already carries the meaning;
// the glyph is a redundant visual cue.
function makeBannerIcon(glyph: string): HTMLElement {
  const icon = document.createElement('span');
  icon.setAttribute('data-testid', 'banner-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.className = 'hashly-banner-icon';
  icon.textContent = glyph;
  return icon;
}

// fix-loop iter-1 / fix #14 — exported so the click handler can clear
// stale banners synchronously at the top of `onSaveClick`, before the
// network round-trip starts. Without that synchronous clear, a user
// retrying after a failure sees the stale banner persist for the
// duration of the fetch — visually suggesting "nothing happened".
export function clearSaveBanners(host: HTMLElement): void {
  host
    .querySelectorAll(
      `[data-testid="${SAVE_ERROR_TESTID}"], [data-testid="${SAVE_SUCCESS_TESTID}"], [data-testid="${SAVE_CONFLICT_TESTID}"]`,
    )
    .forEach((el) => el.remove());
}

// fix-loop iter-1 / fix #13 — only render the PR link when the URL
// is a real `https://github.com` URL. The prUrl seam canonically
// flows from the GitHub PR API; anything else (empty string,
// `javascript:` URI, non-github host) indicates a worker-response
// regression or response-tampering. With `target="_blank"` an empty
// href can land on `about:blank` and a `javascript:` href executes
// attacker code with the user's session. Defense-in-depth.
function isSafePrUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com';
  } catch {
    return false;
  }
}

export function renderSaveError(host: HTMLElement, message: string): void {
  clearSaveBanners(host);

  const banner = document.createElement('div');
  banner.setAttribute('data-testid', SAVE_ERROR_TESTID);
  banner.setAttribute('role', 'alert');
  banner.className = 'hashly-save-error';
  banner.appendChild(makeBannerIcon('✕'));
  banner.appendChild(document.createTextNode(message));

  host.prepend(banner);
}

export function renderSaveSuccess(host: HTMLElement, prUrl: string): void {
  clearSaveBanners(host);

  const banner = document.createElement('div');
  banner.setAttribute('data-testid', SAVE_SUCCESS_TESTID);
  banner.setAttribute('role', 'status');
  banner.className = 'hashly-save-success';
  banner.appendChild(makeBannerIcon('✓'));

  // The AC literal is "view on GitHub". target="_blank" preserves
  // the user's edit context; rel="noopener noreferrer" mirrors the
  // viewer-header__github-link pattern (AC 4.5) — without noopener,
  // target="_blank" is a tabnabbing vector.
  //
  // fix-loop iter-1 / fix #13 — gate link rendering on isSafePrUrl.
  // If the URL isn't a real `https://github.com/...`, the banner
  // still renders ("Saved.") but without the link element. The user
  // gets confirmation; they don't get a malicious or empty href to
  // click into.
  if (isSafePrUrl(prUrl)) {
    const link = document.createElement('a');
    link.setAttribute('href', prUrl);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    // fix-loop iter-1 / fix #16 — distinguish from the viewer-header
    // link (which reads "View on GitHub" verbatim and points at the
    // file blob view). Identical link text on adjacent elements
    // would let the user navigate to the wrong place at a high-
    // stakes moment. The "GitHub" anchor stays so AC 6.3's
    // recognizable-anchor pin keeps holding.
    link.textContent = 'View pull request on GitHub';

    banner.appendChild(document.createTextNode('Saved — '));
    banner.appendChild(link);
  } else {
    banner.appendChild(document.createTextNode('Saved.'));
  }

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
  banner.appendChild(makeBannerIcon('⚠'));

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

  // fix-loop iter-1 / fix #17 — clickable Reload affordance next to
  // Copy. The AC 6.5 user-facing message instructs "please reload";
  // a high-stakes recovery moment shouldn't rely on the user
  // remembering Cmd+R. Pass `() => location.reload()` (function
  // expression) — NOT `location.reload()` (function call) — so the
  // reload only fires on click, not on banner render.
  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.textContent = 'Reload now';
  reloadBtn.className = 'hashly-save-conflict__reload';
  reloadBtn.addEventListener('click', () => {
    window.location.reload();
  });
  banner.appendChild(reloadBtn);

  host.prepend(banner);
}
