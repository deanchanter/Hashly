// Issue #90 / AC 4.7 — Error states for failed spec fetch.
// Issue #158 fix-loop iter-1 / critical #3 — refactored onto the
// banner primitive so the surface inherits centralized styling +
// dismiss + action affordances.

import type { FetchSpecResult } from './fetch-spec';
import { showBanner } from './ui/banner';

type FetchFailure = Extract<FetchSpecResult, { ok: false }>;

function messageFor(error: FetchFailure): string {
  switch (error.kind) {
    case 'not-found':
      return "We couldn't find this spec. Double-check the path, or the repository may be private.";
    case 'forbidden':
      return 'Access to this spec was forbidden. The repository may be private or rate-limited.';
    case 'network':
      return "We couldn't reach GitHub. Check your network connection and try again.";
    case 'other':
      return `GitHub returned an unexpected status (${error.status}). Try again later.`;
  }
}

export interface RenderViewerErrorOpts {
  onRetry?: () => void;
  onBack?: () => void;
}

export function renderViewerError(
  host: HTMLElement,
  error: FetchFailure,
  opts: RenderViewerErrorOpts = {},
): void {
  // Hard clear — same contract as renderFileError / renderLanding /
  // renderViewerHeader.
  host.innerHTML = '';

  const handle = showBanner(host, {
    kind: 'error',
    message: messageFor(error),
    dismissible: true,
    ...(opts.onRetry
      ? { action: { label: 'Retry', onClick: opts.onRetry } }
      : {}),
  });
  // Preserve the per-kind data attribute the existing AC 4.7 tests
  // pin alongside role="alert".
  handle.element.classList.add('viewer-error', `viewer-error--${error.kind}`);
  handle.element.setAttribute('data-kind', error.kind);

  if (opts.onBack) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.textContent = 'Back to landing';
    backBtn.className = 'viewer-error__back';
    backBtn.style.minWidth = '44px';
    backBtn.style.minHeight = '44px';
    backBtn.addEventListener('click', () => {
      opts.onBack!();
    });
    handle.element.appendChild(backBtn);
  }
}
