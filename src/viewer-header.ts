// Issue #90 / AC 4.5 — Persistent header for the viewer.
//
// Renders a static `<repo> <path> <ref>` surface above the editor
// mount, plus a single safe out-link to the canonical GitHub view of
// the file. Standalone module — no Tauri imports, no main.ts coupling.
//
// remove-tauri-legacy — when an `onEdit` callback is supplied, the
// header also renders a visible Edit button (the primary entry point
// into the JIT-auth flow). The button starts disabled; the bootstrap
// flips it on via `setEditButtonEnabled` after `mountViewer` resolves.

export interface ViewerHeaderInfo {
  repo: string;
  path: string;
  ref: string;
}

const EDIT_BUTTON_TESTID = 'header-edit-button';

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function setEditButtonEnabled(host: HTMLElement, enabled: boolean): void {
  const button = host.querySelector<HTMLButtonElement>(
    `[data-testid="${EDIT_BUTTON_TESTID}"]`,
  );
  if (!button) return;
  button.disabled = !enabled;
}

export function renderViewerHeader(
  host: HTMLElement,
  info: ViewerHeaderInfo,
  onEdit?: () => void,
): void {
  // Hard clear — same contract as renderFileError / renderLanding.
  host.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'viewer-header';

  // Issue #90 / fix #7 — wordmark carry-over. The bootstrap strips the
  // static `.hashly-titlebar` in web mode, so each viewer surface owns
  // its own wordmark. Markup mirrors the v0.2 index.html (issue #46).
  const wordmark = document.createElement('span');
  wordmark.className = 'hashly-wordmark';
  wordmark.setAttribute('aria-label', 'hashly');
  const wmHash = document.createElement('span');
  wmHash.className = 'hashly-wordmark__hash';
  wmHash.setAttribute('aria-hidden', 'true');
  wmHash.textContent = '#';
  const wmName = document.createElement('span');
  wmName.className = 'hashly-wordmark__name';
  wmName.textContent = 'hashly';
  wordmark.appendChild(wmHash);
  wordmark.appendChild(wmName);
  header.appendChild(wordmark);

  const coords = document.createElement('span');
  coords.className = 'viewer-header__coords';
  coords.textContent = `${info.repo} · ${info.path} @ ${info.ref}`;
  header.appendChild(coords);

  const link = document.createElement('a');
  link.className = 'viewer-header__github-link';
  link.setAttribute(
    'href',
    `https://github.com/${info.repo}/blob/${info.ref}/${encodePathSegments(info.path)}`,
  );
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  link.textContent = 'View on GitHub';
  header.appendChild(link);

  if (onEdit) {
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.setAttribute('data-testid', EDIT_BUTTON_TESTID);
    editButton.className = 'viewer-header__edit-button';
    editButton.textContent = 'Edit';
    editButton.disabled = true;
    editButton.addEventListener('click', () => {
      if (editButton.disabled) return;
      onEdit();
    });
    header.appendChild(editButton);
  }

  host.appendChild(header);
}
