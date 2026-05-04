// Issue #90 / AC 4.1 — URL-parameter routing for the web viewer.
//
// Parses the viewer's query string into `{ repo, path, ref }` or
// `{ error }`. Pure function, no DOM / fetch / Tauri imports — kept in
// its own module so unit tests can import it without dragging in
// `src/main.ts`'s Tauri side-effects.

export type ParseSpecUrlResult =
  | { repo: string; path: string; ref: string }
  | { error: string };

const REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function parseSpecUrl(href: string): ParseSpecUrlResult {
  let params: URLSearchParams;
  if (href.startsWith('?')) {
    params = new URLSearchParams(href.slice(1));
  } else {
    try {
      params = new URL(href).searchParams;
    } catch {
      return { error: 'invalid URL' };
    }
  }

  const repo = params.get('repo');
  if (repo === null) {
    return { error: 'missing `repo` query parameter' };
  }
  const repoParts = repo.split('/');
  if (repoParts.length !== 2) {
    return { error: '`repo` must be of the form `owner/name`' };
  }
  const owner = repoParts[0] ?? '';
  const name = repoParts[1] ?? '';
  if (!REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(name)) {
    return { error: '`repo` must be `owner/name` (alphanumerics, `.`, `_`, `-`)' };
  }

  const rawPath = params.get('path');
  if (rawPath === null) {
    return { error: 'missing `path` query parameter' };
  }
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return { error: '`path` is not valid URI-encoded text' };
  }
  if (path.length === 0) {
    return { error: '`path` query parameter must not be empty' };
  }
  if (path.startsWith('/')) {
    return { error: '`path` must be repo-relative (no leading `/`)' };
  }
  // Critical fix #2 — path-traversal hardening. URL normalization
  // collapses `..` / `.` / empty segments before the HTTP request, so a
  // path like `../attacker/payload.md` would silently retarget the
  // fetch at a different repo while the viewer header still shows the
  // trusted one. Reject any segment (post-decode) that is `.`, `..`,
  // or empty.
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      return { error: '`path` must not contain `.`, `..`, or empty segments' };
    }
  }

  let ref: string;
  if (params.has('ref')) {
    const rawRef = params.get('ref') ?? '';
    if (rawRef.length === 0) {
      return { error: '`ref` query parameter must not be empty when present' };
    }
    let decodedRef: string;
    try {
      decodedRef = decodeURIComponent(rawRef);
    } catch {
      return { error: '`ref` is not valid URI-encoded text' };
    }
    if (decodedRef.length === 0) {
      return { error: '`ref` query parameter must not be empty when present' };
    }
    // Critical fix iteration 2 — `ref` charset hardening. Reject any
    // char outside the github-realistic set so `<script>`, control
    // chars, spaces, `?`, `#`, etc. fail at parse time and never reach
    // the viewer header textContent or the composed fetch URL.
    if (!/^[A-Za-z0-9._/-]+$/.test(decodedRef)) {
      return {
        error:
          '`ref` may only contain alphanumerics and `.`, `_`, `-`, `/`',
      };
    }
    // Critical fix iteration 2 — `ref` traversal hardening. Same shape
    // as the path check above: URL normalization collapses `..` / `.` /
    // empty segments BEFORE the HTTP request, which would silently
    // retarget the fetch at a different repo while the viewer header
    // still shows the trusted one.
    for (const segment of decodedRef.split('/')) {
      if (segment === '' || segment === '.' || segment === '..') {
        return { error: '`ref` must not contain `.`, `..`, or empty segments' };
      }
    }
    ref = decodedRef;
  } else {
    ref = 'main';
  }

  return { repo, path, ref };
}
