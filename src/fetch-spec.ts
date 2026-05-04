// Issue #90 / AC 4.3 — Anonymous public-repo fetch via the GitHub raw
// content endpoint.
//
// Hand-rolled fetch — no octokit, no auth headers. The bootstrap maps
// the discriminated result to the viewer mount (200) or one of the
// AC 4.7 error states (not-found / forbidden / network / other).

export type FetchSpecResult =
  | { ok: true; content: string }
  | { ok: false; kind: 'not-found' }
  | { ok: false; kind: 'forbidden' }
  | { ok: false; kind: 'network' }
  | { ok: false; kind: 'other'; status: number };

export async function fetchSpec(
  repo: string,
  ref: string,
  path: string,
): Promise<FetchSpecResult> {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${encodedPath}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return { ok: false, kind: 'network' };
  }

  if (response.status === 200) {
    const content = await response.text();
    return { ok: true, content };
  }
  if (response.status === 404) {
    return { ok: false, kind: 'not-found' };
  }
  if (response.status === 403) {
    return { ok: false, kind: 'forbidden' };
  }
  return { ok: false, kind: 'other', status: response.status };
}
