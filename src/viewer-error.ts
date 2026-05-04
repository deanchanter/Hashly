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

export function renderViewerError(host: HTMLElement, error: FetchFailure): void {
  // Hard clear — same contract as renderFileError / renderLanding /
  // renderViewerHeader.
  host.innerHTML = '';

  const alert = document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.className = `viewer-error viewer-error--${error.kind}`;
  alert.setAttribute('data-kind', error.kind);
  alert.textContent = messageFor(error);
  host.appendChild(alert);
}
