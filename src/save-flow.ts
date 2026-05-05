// Issue #92 / AC 6.7 — Save flow: POST /api/save and shape the response
// into a discriminated union the frontend can branch on.
//
// This module is the seam every save AC composes against. Other ACs
// (6.3 success, 6.5 conflict) consume the same `SaveResult` type.

export type SaveResult =
  | { ok: true; prUrl: string }
  | { ok: false; kind: 'no-write'; message: string }
  | { ok: false; kind: 'conflict'; message: string }
  | { ok: false; kind: 'network'; message: string }
  | { ok: false; kind: 'unauth'; message: string }
  | { ok: false; kind: 'other'; message: string };

export interface SubmitSaveOpts {
  repo: string;
  path: string;
  ref: string;
  content: string;
  baseSha: string;
  commitMessage?: string;
}

export async function submitSave(opts: SubmitSaveOpts): Promise<SaveResult> {
  let response: Response;
  try {
    response = await fetch('/api/save', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo: opts.repo,
        path: opts.path,
        ref: opts.ref,
        content: opts.content,
        baseSha: opts.baseSha,
        ...(opts.commitMessage !== undefined
          ? { commitMessage: opts.commitMessage }
          : {}),
      }),
    });
  } catch (e) {
    // Defensive floor — a fetch throw (offline, DNS down) must NOT
    // surface as an unhandled rejection. Translate to a structured
    // network kind so the caller can render a transient-friendly
    // banner instead of the no-write copy.
    return {
      ok: false,
      kind: 'network',
      message: e instanceof Error ? e.message : 'Network error.',
    };
  }

  // fix-loop iter-1 / fix #2 — 401 sentinel BEFORE JSON parse. The
  // worker's auth-gate returns plain `"unauthorized"` text/plain; a
  // body-parse-then-branch path would lose the structural signal in
  // the parse-error fallback. Special-case status 401 so the caller
  // can render a session-expired prompt with a recovery hint.
  if (response.status === 401) {
    return {
      ok: false,
      kind: 'unauth',
      message: 'Your session expired.',
    };
  }

  let body: {
    ok?: unknown;
    kind?: unknown;
    message?: unknown;
    prUrl?: unknown;
  };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return {
      ok: false,
      kind: 'other',
      message: `Save failed (HTTP ${response.status}).`,
    };
  }

  if (body && body.ok === true && typeof body.prUrl === 'string') {
    return { ok: true, prUrl: body.prUrl };
  }

  const kind = body?.kind;
  const message = typeof body?.message === 'string' ? body.message : '';

  if (
    kind === 'no-write' ||
    kind === 'conflict' ||
    kind === 'network' ||
    kind === 'unauth'
  ) {
    return { ok: false, kind, message };
  }

  return { ok: false, kind: 'other', message };
}
