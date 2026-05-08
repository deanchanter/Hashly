// Issue #92 — Save-result banner family.
// Issue #158 / AC 4.3 — Refactored onto the banner primitive
// (`src/ui/banner.ts`) so every save outcome inherits the dismiss
// control + ARIA contract centrally. Outer testids preserved so the
// existing AC 6.x save-flow tests keep pinning on the same nodes.

import { showBanner, type BannerHandle } from './ui/banner';

const SAVE_ERROR_TESTID = 'save-error';
const SAVE_SUCCESS_TESTID = 'save-success';
const SAVE_CONFLICT_TESTID = 'save-conflict';

// AC 6.5 — VERBATIM user-facing copy.
const CONFLICT_PHRASE =
  'your edit and an upstream change overlap; please reload';

export function clearSaveBanners(host: HTMLElement): void {
  host
    .querySelectorAll(
      `[data-testid="${SAVE_ERROR_TESTID}"], [data-testid="${SAVE_SUCCESS_TESTID}"], [data-testid="${SAVE_CONFLICT_TESTID}"]`,
    )
    .forEach((el) => el.remove());
}

function isSafePrUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com';
  } catch {
    return false;
  }
}

function pinTestId(handle: BannerHandle, testid: string): void {
  handle.element.setAttribute('data-testid', testid);
}

export function renderSaveError(host: HTMLElement, message: string): void {
  clearSaveBanners(host);
  const handle = showBanner(host, {
    kind: 'error',
    message,
    dismissible: true,
  });
  pinTestId(handle, SAVE_ERROR_TESTID);
  handle.element.classList.add('hashly-save-error');
  host.prepend(handle.element);
}

export function renderSaveSuccess(host: HTMLElement, prUrl: string): void {
  clearSaveBanners(host);
  const handle = showBanner(host, {
    kind: 'success',
    message: 'Saved — ',
    dismissible: true,
  });
  pinTestId(handle, SAVE_SUCCESS_TESTID);
  handle.element.classList.add('hashly-save-success');

  if (isSafePrUrl(prUrl)) {
    const link = document.createElement('a');
    link.setAttribute('href', prUrl);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.textContent = 'View pull request on GitHub';
    handle.element.appendChild(link);

    // Issue #158 / #119 — copy-details affordance. Keeps the success
    // banner mounted; the user may need to copy more than once.
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy link';
    copyBtn.className = 'hashly-save-success__copy';
    copyBtn.addEventListener('click', () => {
      void Promise.resolve(navigator.clipboard.writeText(prUrl)).then(() => {
        const feedback = handle.element.querySelector<HTMLElement>(
          '.hashly-save-success__feedback',
        );
        if (feedback) {
          feedback.textContent = 'Copied';
        } else {
          const span = document.createElement('span');
          span.className = 'hashly-save-success__feedback';
          span.textContent = ' Copied';
          handle.element.appendChild(span);
        }
      });
    });
    handle.element.appendChild(copyBtn);
  }

  host.prepend(handle.element);
}

export interface RenderSaveConflictOpts {
  getContent: () => string;
}

export function renderSaveConflict(
  host: HTMLElement,
  opts: RenderSaveConflictOpts,
): void {
  clearSaveBanners(host);
  const handle = showBanner(host, {
    kind: 'conflict',
    message: CONFLICT_PHRASE,
    dismissible: true,
  });
  pinTestId(handle, SAVE_CONFLICT_TESTID);
  handle.element.classList.add('hashly-save-conflict');

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy your edit';
  copyBtn.className = 'hashly-save-conflict__copy';
  copyBtn.addEventListener('click', () => {
    const content = opts.getContent();
    void Promise.resolve(navigator.clipboard.writeText(content)).then(() => {
      // Issue #158 fix-loop iter-1 / critical #7 — visible "Copied"
      // feedback. Conflict is the only recovery path; silent copy is
      // unacceptable.
      let feedback = handle.element.querySelector<HTMLElement>(
        '.hashly-save-conflict__feedback',
      );
      if (!feedback) {
        feedback = document.createElement('span');
        feedback.className = 'hashly-save-conflict__feedback';
        handle.element.appendChild(feedback);
      }
      feedback.textContent = ' Copied';
    });
  });
  handle.element.appendChild(copyBtn);

  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.textContent = 'Reload now';
  reloadBtn.className = 'hashly-save-conflict__reload';
  reloadBtn.addEventListener('click', () => {
    window.location.reload();
  });
  handle.element.appendChild(reloadBtn);

  host.prepend(handle.element);
}
