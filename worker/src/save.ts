// AC 6.7 — `POST /api/save` save endpoint.
//
// For this slice we only pin the no-write-access translation: when the
// GitHub write surface returns 403, translate to a structured
// `{ok: false, kind: 'no-write', message}` JSON response with the
// AC 6.7 literal remediation phrase. Other AC slices (6.1 success, 6.4
// stale-SHA, 6.5 conflict, dedup-PR) will extend this handler.

import { parseCookieHeader } from "./auth";
import type { Env } from "./env";

const SESSION_COOKIE_NAME = "hashly_session";

// AC 6.7 — VERBATIM remediation copy. Cross-pinned with the worker
// integration test and the frontend save-flow test.
const NO_WRITE_MESSAGE =
  "You don't have write access to this repository — ask the dev to add you as a collaborator (or install the Hashly GitHub App on the repo).";

interface SessionRecord {
  access_token: string;
  installation_id?: string;
  expires_at?: string;
}

interface SaveBody {
  repo?: string;
  path?: string;
  ref?: string;
  content?: string;
  baseSha?: string;
  commitMessage?: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleSave(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (!sessionId) {
    return new Response("unauthorized", { status: 401 });
  }

  const stored = await env.SESSIONS.get(sessionId);
  if (!stored) {
    return new Response("unauthorized", { status: 401 });
  }

  let session: SessionRecord;
  try {
    session = JSON.parse(stored) as SessionRecord;
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  if (!session.access_token) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return jsonResponse(
      { ok: false, kind: "other", message: "Invalid JSON body." },
      400,
    );
  }

  const { repo, path, ref, content, baseSha, commitMessage } = body;
  if (!repo || !path || !ref || typeof content !== "string") {
    return jsonResponse(
      { ok: false, kind: "other", message: "Missing required fields." },
      400,
    );
  }

  const token = session.access_token;
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "hashly-worker",
    "content-type": "application/json",
  };

  // Issue #92 / AC 6.4 — Stale-SHA check, FAIL-FAST. Fetch the file's
  // current blob SHA on the source ref BEFORE any write call. If it
  // differs from the request's `baseSha`, return a structured
  // `conflict` response and do NOT proceed. Without this fail-fast,
  // every conflict would create a dead `hashly/spec-edit-*` branch.
  //
  // Scope-down per team-lead authorization: simple "any upstream
  // change → conflict, user reloads" instead of three-way merge.
  // False-positive conflicts (non-overlapping concurrent edits) are
  // rare in the spec-edit persona and AC 6.5's reload prompt makes
  // recovery cheap. Full diff3 is a v0.4 enhancement.
  //
  // Graceful fallback: if the GET errors (network, non-200, malformed
  // body), we proceed with the write attempt. The user has already
  // claimed an anchor via baseSha; the worst case is we miss a
  // conflict, which is no worse than today's pre-AC-6.4 behavior.
  let currentSha: string | undefined;
  try {
    const contentsResp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      { headers: ghHeaders },
    );
    if (contentsResp.status === 200) {
      const contentsJson = (await contentsResp.json()) as { sha?: string };
      currentSha = contentsJson?.sha;
    }
  } catch {
    currentSha = undefined;
  }
  if (typeof currentSha === "string" && currentSha !== baseSha) {
    return jsonResponse(
      {
        ok: false,
        kind: "conflict",
        message:
          "An upstream change advanced this file since you started editing. Please reload to see the latest content and re-apply your edits.",
      },
      409,
    );
  }

  // Issue #92 / AC 6.6 — PR dedup within session. Cache key is
  // (sessionId, repo, path, ref). On a second save in the same
  // session for the same spec, reuse the existing branch and PR
  // (push a new commit, don't open a new PR). The cache lives in
  // the same KV namespace as auth sessions but uses an `edit:`
  // prefix so it can't collide with auth-session IDs (those are
  // opaque base64url, no colons).
  const editCacheKey = `edit:${sessionId}:${repo}:${path}:${ref}`;
  let cached: { branchName: string; prUrl: string } | null = null;
  const storedCache = await env.SESSIONS.get(editCacheKey);
  if (storedCache) {
    try {
      cached = JSON.parse(storedCache) as typeof cached;
    } catch {
      cached = null;
    }
  }

  let branchName: string;
  if (cached?.branchName) {
    // Dedup hit — reuse the existing branch. Skip POST /git/refs
    // (branch already upstream) and POST /pulls (PR already open).
    branchName = cached.branchName;
  } else {
    // Issue #92 / AC 6.2 — branch namespace `hashly/spec-edit-<timestamp>`.
    // The `/` is intentional Git namespace convention (cf. `feature/x`,
    // `release/y`); GitHub's POST /git/refs accepts it.
    branchName = `hashly/spec-edit-${Date.now()}`;

    // First: GET source ref's commit SHA to base the new branch on.
    const refResp = await fetch(
      `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(ref)}`,
      { headers: ghHeaders },
    );

    if (refResp.status === 403) {
      return jsonResponse(
        { ok: false, kind: "no-write", message: NO_WRITE_MESSAGE },
        403,
      );
    }

    let refJson: { object?: { sha?: string } };
    try {
      refJson = (await refResp.json()) as typeof refJson;
    } catch {
      refJson = {};
    }
    const baseCommitSha = refJson?.object?.sha;

    // Try to create the branch ref. If GitHub forbids it, that's the
    // canonical no-write signal.
    const createBranchResp = await fetch(
      `https://api.github.com/repos/${repo}/git/refs`,
      {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseCommitSha ?? "",
        }),
      },
    );

    if (createBranchResp.status === 403) {
      return jsonResponse(
        { ok: false, kind: "no-write", message: NO_WRITE_MESSAGE },
        403,
      );
    }
  }

  // PUT contents on the (new or cached) branch.
  const putResp = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: ghHeaders,
      body: JSON.stringify({
        message: commitMessage ?? `Update ${path}`,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: branchName,
      }),
    },
  );

  if (putResp.status === 403) {
    return jsonResponse(
      { ok: false, kind: "no-write", message: NO_WRITE_MESSAGE },
      403,
    );
  }

  if (cached) {
    // Dedup path — reuse the cached PR URL, no POST /pulls.
    return jsonResponse({ ok: true, prUrl: cached.prUrl }, 200);
  }

  // POST a PR for the freshly-created branch.
  const prResp = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: ghHeaders,
    body: JSON.stringify({
      title: commitMessage ?? `Update ${path}`,
      head: branchName,
      base: ref,
      body: "Hashly save.",
    }),
  });

  if (prResp.status === 403) {
    return jsonResponse(
      { ok: false, kind: "no-write", message: NO_WRITE_MESSAGE },
      403,
    );
  }

  let prJson: { html_url?: string };
  try {
    prJson = (await prResp.json()) as typeof prJson;
  } catch {
    prJson = {};
  }
  const prUrl = prJson?.html_url ?? "";

  // Persist the dedup record so a subsequent save in this session
  // for the same spec reuses this branch + PR (AC 6.6). TTL matches
  // the session cookie's max age (~1h) so stale records can't
  // outlive the session.
  try {
    await env.SESSIONS.put(
      editCacheKey,
      JSON.stringify({ branchName, prUrl }),
      { expirationTtl: 3600 },
    );
  } catch {
    // KV write errors are non-fatal — the user still gets the PR
    // URL on this save; only future dedup is impacted.
  }

  return jsonResponse({ ok: true, prUrl }, 200);
}
