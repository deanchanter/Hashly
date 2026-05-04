// Issue #90 / AC 4.5 — Persistent header for the viewer.
//
// Renders a static `<repo> <path> <ref>` surface above the editor
// mount, plus a single safe out-link to the canonical GitHub view of
// the file. Standalone module — no Tauri imports, no main.ts coupling.

export interface ViewerHeaderInfo {
  repo: string;
  path: string;
  ref: string;
}

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function renderViewerHeader(
  host: HTMLElement,
  info: ViewerHeaderInfo,
): void {
  // Hard clear — same contract as renderFileError / renderLanding.
  host.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'viewer-header';

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

  host.appendChild(header);
}
