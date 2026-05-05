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

// fix-loop iter-1 / fix #11 — input size caps. Markdown specs aren't
// huge; commitMessage rides in a single git header line.
const CONTENT_MAX_BYTES = 1024 * 1024; // 1 MiB
const COMMIT_MESSAGE_MAX_BYTES = 1024; // 1 KiB

// fix-loop iter-1 / fix #5 — server-side validators mirror
// `src/router.ts`'s parseSpecUrl. The frontend's parser is not a
// defense for the worker (an attacker can craft a request directly
// against /api/save).
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const REF_CHARSET_RE = /^[A-Za-z0-9._/-]+$/;
const BASE_SHA_RE = /^[a-f0-9]{40}$/;

function hasTraversalSegment(s: string): boolean {
  for (const segment of s.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return true;
  }
  return false;
}

function validateSaveBody(body: {
  repo?: unknown;
  path?: unknown;
  ref?: unknown;
  content?: unknown;
  baseSha?: unknown;
  commitMessage?: unknown;
}): { ok: true } | { ok: false; message: string } {
  const { repo, path, ref, content, baseSha, commitMessage } = body;

  if (typeof repo !== "string" || !REPO_RE.test(repo)) {
    return { ok: false, message: "Invalid repo (must be `owner/name`)." };
  }
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, message: "Missing path." };
  }
  if (path.startsWith("/")) {
    return { ok: false, message: "Path must be repo-relative (no leading `/`)." };
  }
  if (hasTraversalSegment(path)) {
    return { ok: false, message: "Path must not contain `.`, `..`, or empty segments." };
  }
  if (typeof ref !== "string" || ref.length === 0) {
    return { ok: false, message: "Missing ref." };
  }
  if (!REF_CHARSET_RE.test(ref)) {
    return { ok: false, message: "Ref contains invalid characters." };
  }
  if (hasTraversalSegment(ref)) {
    return { ok: false, message: "Ref must not contain `.`, `..`, or empty segments." };
  }
  if (typeof baseSha !== "string" || !BASE_SHA_RE.test(baseSha)) {
    return { ok: false, message: "Invalid baseSha (must be lowercase 40-char hex)." };
  }
  if (typeof content !== "string") {
    return { ok: false, message: "Missing content." };
  }
  if (content.length > CONTENT_MAX_BYTES) {
    return { ok: false, message: "Content exceeds 1 MiB limit." };
  }
  if (commitMessage !== undefined) {
    if (typeof commitMessage !== "string") {
      return { ok: false, message: "commitMessage must be a string." };
    }
    if (commitMessage.length > COMMIT_MESSAGE_MAX_BYTES) {
      return { ok: false, message: "commitMessage exceeds 1 KiB limit." };
    }
    if (/[\r\n]/.test(commitMessage)) {
      return { ok: false, message: "commitMessage must not contain CR or LF." };
    }
  }
  return { ok: true };
}

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
  // fix-loop iter-1 / fix #12 — Origin gate. /api/save is a write
  // endpoint with the same exposure as the /auth gate from #111: a
  // cross-origin POST with the session cookie riding along (SameSite=
  // Lax permits top-level POSTs) could spoof saves. Reject any
  // request whose Origin doesn't match the worker's own origin, AND
  // any request without an Origin header (programmatic curl / non-
  // browser clients shouldn't be hitting this endpoint).
  const origin = request.headers.get("Origin");
  const requestOrigin = new URL(request.url).origin;
  if (!origin || origin !== requestOrigin) {
    return new Response("forbidden: cross-origin", { status: 403 });
  }

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

  // fix-loop iter-1 / fix #5 + #11 — validate ALL inputs server-side
  // BEFORE any GitHub fetch. The frontend's parseSpecUrl can't be
  // trusted (an attacker can POST directly); validation must happen
  // here. A regression that runs validation AFTER the fetch would
  // still 4xx but would have leaked the bad path upstream first.
  const validation = validateSaveBody(body);
  if (!validation.ok) {
    return jsonResponse(
      { ok: false, kind: "other", message: validation.message },
      400,
    );
  }
  const { repo, path, ref, content, baseSha, commitMessage } = body as {
    repo: string;
    path: string;
    ref: string;
    content: string;
    baseSha: string;
    commitMessage?: string;
  };

  const token = session.access_token;
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "hashly-worker",
    "content-type": "application/json",
  };

  // Issue #92 / AC 6.4 — Stale-SHA check, FAIL-CLOSED (fix-loop iter-1
  // / fix #4). Fetch the file's current blob SHA on the source ref
  // BEFORE any write call. The previous "graceful fallback on fetch
  // error" was a regression: post-AC-6.4 the user trusts the system
  // to detect upstream conflicts; a transient blip silently disabling
  // the check would overwrite changes they never saw. Now: any GET
  // /contents failure (non-200, network throw, missing sha) returns
  // a structured `kind:'other'` error and does NOT proceed.
  let currentSha: string;
  try {
    const contentsResp = await fetch(
      // fix-loop iter-1 / fix #8 — preserve `/` in nested refs.
      // `encodeURIComponent("feature/x")` → `feature%2Fx` causes
      // GitHub to 404 (encoded slash is treated literally in the
      // path-segment). Slice-1's ref validator already restricts
      // the charset to `[A-Za-z0-9._/-]+` — all URL-safe chars in
      // the relevant contexts — so no encoding is needed.
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`,
      { headers: ghHeaders },
    );
    if (!contentsResp.ok) {
      return jsonResponse(
        {
          ok: false,
          kind: "other",
          message: `Could not verify the spec is up to date (GitHub returned ${contentsResp.status}). Please retry.`,
        },
        502,
      );
    }
    let contentsJson: { sha?: unknown };
    try {
      contentsJson = (await contentsResp.json()) as typeof contentsJson;
    } catch {
      return jsonResponse(
        {
          ok: false,
          kind: "other",
          message: "Could not parse GitHub contents response.",
        },
        502,
      );
    }
    if (typeof contentsJson?.sha !== "string") {
      return jsonResponse(
        {
          ok: false,
          kind: "other",
          message: "GitHub contents response is missing the sha field.",
        },
        502,
      );
    }
    currentSha = contentsJson.sha;
  } catch {
    return jsonResponse(
      {
        ok: false,
        kind: "other",
        message: "Could not reach GitHub to verify the spec.",
      },
      502,
    );
  }

  if (currentSha !== baseSha) {
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
  //
  // fix-loop iter-1 / fix #9 — JSON-encode the tuple so the
  // delimiter isn't `:`. Slice-1's validators forbid `:` in repo /
  // ref / baseSha but `path` accepts `:` — a future regression that
  // loosened ref's charset would re-expose the cross-component
  // collision (`path="a", ref="b:c"` vs `path="a:b", ref="c"`).
  // JSON.stringify quotes the strings, escaping any internal `"`,
  // making the key unambiguous regardless of delimiter chars in
  // the components.
  const editCacheKey = `edit:${JSON.stringify({ sessionId, repo, path, ref })}`;
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

    // GET source ref's commit SHA to base the new branch on. fix-loop
    // iter-1 / fix #3 — cascade on any non-2xx, NOT just 403.
    const refResp = await fetch(
      // fix-loop iter-1 / fix #8 — preserve `/` in nested refs (see
      // GET /contents above for rationale).
      `https://api.github.com/repos/${repo}/git/ref/heads/${ref}`,
      { headers: ghHeaders },
    );

    if (refResp.status === 403) {
      return jsonResponse(
        { ok: false, kind: "no-write", message: NO_WRITE_MESSAGE },
        403,
      );
    }
    if (!refResp.ok) {
      return jsonResponse(
        {
          ok: false,
          kind: "other",
          message: `Could not resolve source ref (GitHub returned ${refResp.status}).`,
        },
        502,
      );
    }

    let refJson: { object?: { sha?: unknown } };
    try {
      refJson = (await refResp.json()) as typeof refJson;
    } catch {
      return jsonResponse(
        { ok: false, kind: "other", message: "Could not parse GitHub get-ref response." },
        502,
      );
    }
    const baseCommitSha = refJson?.object?.sha;
    if (typeof baseCommitSha !== "string" || baseCommitSha.length === 0) {
      return jsonResponse(
        { ok: false, kind: "other", message: "GitHub get-ref response missing object.sha." },
        502,
      );
    }

    // POST /git/refs — branch create. fix-loop iter-1 / fix #3 +
    // fix #10. 403 → no-write. 422 → branch already exists (squat /
    // collision); we surface as `kind:'other'` rather than silently
    // PUT-ing on the squatted branch. Any other non-2xx → cascade.
    const createBranchResp = await fetch(
      `https://api.github.com/repos/${repo}/git/refs`,
      {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseCommitSha,
        }),
      },
    );

    if (createBranchResp.status === 403) {
      return jsonResponse(
        { ok: false, kind: "no-write", message: NO_WRITE_MESSAGE },
        403,
      );
    }
    if (createBranchResp.status === 422) {
      return jsonResponse(
        {
          ok: false,
          kind: "other",
          message:
            "Could not create the save branch (already exists). Please retry.",
        },
        422,
      );
    }
    if (!createBranchResp.ok) {
      return jsonResponse(
        {
          ok: false,
          kind: "other",
          message: `Could not create the save branch (GitHub returned ${createBranchResp.status}).`,
        },
        502,
      );
    }
  }

  // PUT contents on the (new or cached) branch. fix-loop iter-1 /
  // fix #1 — GitHub requires `sha:<file's current SHA on the target
  // ref>` for updates; without it real GitHub returns 422. We
  // captured currentSha from the GET /contents above. fix #3 —
  // cascade on any non-2xx beyond the 403 no-write case.
  const putResp = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: ghHeaders,
      body: JSON.stringify({
        message: commitMessage ?? `Update ${path}`,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: branchName,
        sha: currentSha,
      }),
    },
  );

  if (putResp.status === 403) {
    return jsonResponse(
      { ok: false, kind: "no-write", message: NO_WRITE_MESSAGE },
      403,
    );
  }
  if (!putResp.ok) {
    return jsonResponse(
      {
        ok: false,
        kind: "other",
        message: `Could not commit the edit (GitHub returned ${putResp.status}).`,
      },
      502,
    );
  }

  if (cached) {
    // Dedup path — reuse the cached PR URL, no POST /pulls.
    return jsonResponse({ ok: true, prUrl: cached.prUrl }, 200);
  }

  // POST a PR for the freshly-created branch. fix-loop iter-1 /
  // fix #3 — cascade on any non-2xx, AND validate that html_url is
  // actually present in the body. The silent-data-loss vector is a
  // 200 with an empty html_url cascading to {ok:true, prUrl:""} —
  // the frontend success banner renders an empty link, the user
  // clicks it, navigation destroys their unsaved edit.
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
  if (!prResp.ok) {
    return jsonResponse(
      {
        ok: false,
        kind: "other",
        message: `Could not open the PR (GitHub returned ${prResp.status}).`,
      },
      502,
    );
  }

  let prJson: { html_url?: unknown };
  try {
    prJson = (await prResp.json()) as typeof prJson;
  } catch {
    return jsonResponse(
      { ok: false, kind: "other", message: "Could not parse GitHub PR response." },
      502,
    );
  }
  if (typeof prJson?.html_url !== "string" || prJson.html_url.length === 0) {
    return jsonResponse(
      {
        ok: false,
        kind: "other",
        message: "GitHub PR response missing html_url.",
      },
      502,
    );
  }
  const prUrl = prJson.html_url;

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
