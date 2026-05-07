// Issue #90 / AC 4.7 — Error states for failed spec fetch.
//
// Renders a static `[role="alert"]` surface explaining one of the four
// `fetchSpec` failure kinds (not-found / forbidden / network / other).
// Each kind produces distinct, actionable copy so the user can tell
// "wrong URL" apart from "offline" apart from "GitHub down".

import type { FetchSpecResult } from './fetch-spec';

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
  // Issue #158 / AC 4.8 — optional recovery affordances. Rendered
  // INSIDE the [role="alert"] element so the existing AC 4.7 textid
  // pins keep matching (textContent of the alert still contains the
  // per-kind message).
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

  const alert = document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.className = `viewer-error viewer-error--${error.kind}`;
  alert.setAttribute('data-kind', error.kind);

  const messageSpan = document.createElement('span');
  messageSpan.textContent = messageFor(error);
  alert.appendChild(messageSpan);

  if (opts.onRetry) {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = 'Retry';
    retryBtn.className = 'viewer-error__retry';
    retryBtn.addEventListener('click', () => {
      opts.onRetry!();
    });
    alert.appendChild(retryBtn);
  }

  if (opts.onBack) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.textContent = 'Back to landing';
    backBtn.className = 'viewer-error__back';
    backBtn.addEventListener('click', () => {
      opts.onBack!();
    });
    alert.appendChild(backBtn);
  }

  host.appendChild(alert);
}
