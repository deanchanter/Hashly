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

  const { repo, path, ref, content, commitMessage } = body;
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

  // Try PUT contents on a save-branch. We pick a branch name first and
  // try to create it; if either the branch-create or the contents-write
  // 403s, we surface the no-write translation. (Other ACs will handle
  // the success path; we keep this slice minimal — any 403 on a write
  // path becomes the AC 6.7 structured response.)
  const branchName = `hashly-save-${Date.now()}`;

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

  // PUT contents on the new branch.
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

  // POST a PR for the new branch.
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

  return jsonResponse({ ok: true, prUrl: prJson?.html_url ?? "" }, 200);
}
