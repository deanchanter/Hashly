// Issue #92 / AC 6.7 — Save-time no-write-access fail.
//
// "Add hard-fail UX for no-write-access at save time (backup for the
// proactive lock in 5.5): the message must include the literal text
// 'ask the dev to add you as a collaborator (or install the Hashly
// GitHub App on the repo)'."
//
// 5.5's proactive lock prevents the editor from flipping in the first
// place when the user lacks push access — but it's a *frontend gate*
// over a *cacheable* `permissions.push` field. There are real paths
// that bypass it: a stale 5.5 result; a permission revoked between
// auth and save; a Hashly App reinstalled with reduced scope between
// edit start and save; a user who entered edit mode through a future
// affordance that skipped 5.5. AC 6.7 closes all of those by re-
// validating at the save call: when GitHub returns 403 on a write
// path (the `Resource not accessible by integration` shape, or
// `Must have admin access` shape, or any 403 on POST /git/refs / PUT
// contents / POST /pulls), the worker MUST translate that into a
// structured `{ok: false, kind: 'no-write', message: <literal>}`
// response so the frontend can render the dedicated banner.
//
// Pinned testable seam — `POST /api/save` accepting JSON body:
//   {repo, path, ref, content, baseSha, commitMessage?}
//
// Response shape for the no-write path:
//   {ok: false, kind: 'no-write', message: <string containing the
//    literal AC 6.7 phrase>}
//
// The literal phrase is locked verbatim (case included). A copy edit
// that loses any of "ask the dev to add you as a collaborator (or
// install the Hashly GitHub App on the repo)" is a regression.
//
// We deliberately do NOT pin which exact GitHub API call the worker
// hits first (POST /git/refs vs PUT /contents/<path> vs POST /pulls).
// The contract is "any 403 on a write path → no-write response"; the
// builder is free to pick the call order. The test mocks ALL three
// write endpoints to return 403 so whichever the worker reaches
// first triggers the no-write translation.

import { exports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { fetchMock } from "./fetch-mock";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "save-no-write-session-32chars-zzz";
const ACCESS_TOKEN = "ghs_save_no_write_test_token_DO_NOT_LEAK";

// AC 6.7 — VERBATIM. Any change here is intentional and must be
// reviewed against the issue body (issue #92, AC 6.7).
const REQUIRED_PHRASE =
  "ask the dev to add you as a collaborator (or install the Hashly GitHub App on the repo)";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await env.SESSIONS.put(
    SESSION_ID,
    JSON.stringify({
      access_token: ACCESS_TOKEN,
      installation_id: "42",
      expires_at: "2030-01-01T00:00:00Z",
    }),
  );
});

interface SaveBody {
  repo: string;
  path: string;
  ref: string;
  content: string;
  baseSha: string;
  commitMessage?: string;
}

async function postSave(
  body: SaveBody | Record<string, unknown>,
  opts: { cookie?: string } = {},
): Promise<Response> {
  // Origin header matches the (exports as any).default.fetch URL's origin so the AC 6.7
  // tests stay green under fix #12's same-origin gate.
  const headers: HeadersInit = {
    "content-type": "application/json",
    "Origin": "https://worker.test",
  };
  if (opts.cookie !== undefined) headers["Cookie"] = opts.cookie;
  return (exports as any).default.fetch("https://worker.test/api/save", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Mock the GitHub-side READ calls a save flow plausibly issues
 * (latest content on ref, source ref's commit SHA) so the test can
 * narrow on the WRITE-path 403 surface AC 6.7 cares about. All read
 * mocks .persist() so the order in which the builder issues them
 * doesn't break the test.
 */
function mockGithubReadsHappy(): void {
  // GET contents — returns the file at the source ref with a
  // SHA matching the test's baseSha so the stale-SHA path doesn't
  // accidentally short-circuit (that's AC 6.4's territory).
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/contents/specs/spec.md?ref=main",
      method: "GET",
    })
    .reply(
      200,
      JSON.stringify({
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        path: "specs/spec.md",
        content: btoa("original content\n"),
        encoding: "base64",
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();

  // GET ref — source ref's parent commit SHA.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/git/ref/heads/main",
      method: "GET",
    })
    .reply(
      200,
      JSON.stringify({
        ref: "refs/heads/main",
        object: { sha: "SOURCE_REF_COMMIT_SHA", type: "commit" },
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();
}

/**
 * Mock all three plausible WRITE-path endpoints to return 403 with
 * GitHub's canonical `Resource not accessible by integration` body.
 * Whichever the builder reaches first triggers the AC 6.7 translation;
 * all three are .persist()'d so the test doesn't fail on the
 * builder's choice of call order.
 */
function mockGithubWritesForbidden(): void {
  const forbiddenBody = JSON.stringify({
    message: "Resource not accessible by integration",
    documentation_url: "https://docs.github.com/rest",
  });

  // POST /git/refs — create branch.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/git/refs",
      method: "POST",
    })
    .reply(403, forbiddenBody, {
      headers: { "content-type": "application/json" },
    })
    .persist();

  // PUT /contents/<path> — commit. Pattern-match all branch query
  // shapes (the builder may include or omit `?ref=...`).
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/contents\/specs\/spec\.md(\?.*)?$/,
      method: "PUT",
    })
    .reply(403, forbiddenBody, {
      headers: { "content-type": "application/json" },
    })
    .persist();

  // POST /pulls — open PR.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/pulls",
      method: "POST",
    })
    .reply(403, forbiddenBody, {
      headers: { "content-type": "application/json" },
    })
    .persist();
}

describe("POST /api/save — auth gate (Issue #92 / AC 6.7 cross-pin)", () => {
  it("returns 401 without a session cookie — does NOT call GitHub", async () => {
    // Same auth-gate floor as /api/github/* (AC 3.6). The save path
    // is an authenticated endpoint; an anonymous caller must NOT
    // even reach the GitHub write surface (which would otherwise
    // 403 from GitHub anyway, but we want to surface that as 401-no-
    // session rather than 403-no-write — the user-facing remedy is
    // different).
    const res = await postSave({
      repo: "foo/bar",
      path: "specs/spec.md",
      ref: "main",
      content: "edited\n",
      baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(
      res.status,
      "expected 401 on POST /api/save without a session cookie (AC 6.7 cross-pin: the auth gate is shared with /api/github/* — without it, anonymous callers could probe GitHub via the worker).",
    ).toBe(401);
  });

  it("returns 401 when the session cookie value references no KV record", async () => {
    const res = await postSave(
      {
        repo: "foo/bar",
        path: "specs/spec.md",
        ref: "main",
        content: "edited\n",
        baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      { cookie: `${SESSION_COOKIE_NAME}=this-id-does-not-exist-in-kv` },
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/save — no-write translation (Issue #92 / AC 6.7)", () => {
  beforeEach(() => {
    mockGithubReadsHappy();
    mockGithubWritesForbidden();
  });

  it("when the GitHub write call returns 403, the worker returns kind:'no-write' with the AC 6.7 literal phrase in the message", async () => {
    // The central RED-path pin. GitHub 403'd a write (push permission
    // missing). The worker MUST NOT pass the raw 403 body through —
    // the user has no idea what "Resource not accessible by
    // integration" means. Translate to the structured shape with
    // the AC-mandated remediation copy.
    const res = await postSave(
      {
        repo: "foo/bar",
        path: "specs/spec.md",
        ref: "main",
        content: "edited content\n",
        baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      { cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    );

    // The response body must be JSON-parseable; an opaque text
    // response would defeat the structured-error contract.
    let body: { ok?: unknown; kind?: unknown; message?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch (e) {
      throw new Error(
        `expected POST /api/save no-write response to be JSON-parseable (AC 6.7 — structured error shape). JSON parse threw: ${String(e)}`,
      );
    }

    expect(
      body.ok,
      `expected ok:false on a no-write response (AC 6.7). Got body: ${JSON.stringify(body)}.`,
    ).toBe(false);
    expect(
      body.kind,
      `expected kind:'no-write' when the GitHub write call returned 403 (AC 6.7 — the structured kind lets the frontend route this to the dedicated error banner instead of the generic one). Got body: ${JSON.stringify(body)}.`,
    ).toBe("no-write");
    expect(typeof body.message).toBe("string");
    expect(
      String(body.message),
      `expected message to contain the AC 6.7 literal phrase ${JSON.stringify(REQUIRED_PHRASE)} (the issue body locks this string verbatim). Got message: ${JSON.stringify(body.message)}.`,
    ).toContain(REQUIRED_PHRASE);
  });

  it("response status is 4xx (not 5xx) — the failure is caller-not-permitted, not a server fault", async () => {
    // Pin: the no-write path is a client error (the user lacks
    // permission), not a server error. A 5xx would imply "try
    // again, it's our problem"; the AC 6.7 remediation is "ask the
    // dev / install the App", which is a 4xx affair. We accept any
    // 4xx (403 is canonical, 422 also acceptable if the builder
    // prefers); we reject 5xx.
    const res = await postSave(
      {
        repo: "foo/bar",
        path: "specs/spec.md",
        ref: "main",
        content: "edited content\n",
        baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      { cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    );
    expect(
      res.status,
      `expected a 4xx status on the no-write path (AC 6.7 — caller-not-permitted, not a server fault). Got ${res.status}.`,
    ).toBeGreaterThanOrEqual(400);
    expect(
      res.status,
      `expected a 4xx (not 5xx) status on the no-write path. Got ${res.status}.`,
    ).toBeLessThan(500);
  });

  it("response body does NOT leak the access token (AC 3.10 token-leak invariant carries over)", async () => {
    // Defensive: the worker holds the access token; a buggy error
    // path that re-serializes the upstream request as the response
    // body could leak it. Same invariant as the proxy (AC 3.6
    // invariant c).
    const res = await postSave(
      {
        repo: "foo/bar",
        path: "specs/spec.md",
        ref: "main",
        content: "edited content\n",
        baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      { cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    );
    const body = await res.text();
    expect(
      body,
      "expected the access token to NOT appear in the POST /api/save no-write response body (AC 3.10 token-leak invariant carries over from /api/github/*).",
    ).not.toContain(ACCESS_TOKEN);
  });

  it("response Content-Type is application/json — the structured shape is machine-readable", async () => {
    // Without this pin, an impl that returns the JSON body but
    // forgets the Content-Type header would still pass body checks
    // but a strict frontend `response.json()` could choke (or, more
    // commonly, the frontend would treat it as text and miss the
    // structured kind/message).
    const res = await postSave(
      {
        repo: "foo/bar",
        path: "specs/spec.md",
        ref: "main",
        content: "edited content\n",
        baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      { cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    );
    const ct = res.headers.get("content-type") ?? "";
    expect(
      ct.toLowerCase(),
      `expected Content-Type to be application/json on the no-write response so the structured kind/message can be parsed by the frontend. Got: ${JSON.stringify(ct)}.`,
    ).toContain("application/json");
  });
});
