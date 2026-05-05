// Issue #92 / AC 6.4 — Backend stale-SHA detection.
//
// AC text: "detect stale-SHA before write — fetch latest content,
// attempt a three-way merge (`diff3`-style); if no overlapping
// conflicts, proceed with merged content."
//
// SCOPE NOTE — three-way merge deferred for v0.3 per team-lead's
// authorization in the orchestration brief: "you can hand-roll a
// line-based diff3 or pull a tiny library. Or use a simpler 'if
// base SHA matches latest SHA, write directly; otherwise return
// conflict' approach (skip three-way merge for v0.3 if too much
// scope)." Hand-rolling a correct line-based diff3 in Workers is
// ~100-150 lines of edge-case-prone code; the user-visible UX
// difference between the simple version and the full diff3 is:
//
//   - Simple:    ANY upstream change → conflict, user reloads.
//   - Full diff3: only OVERLAPPING upstream change → conflict;
//                 non-overlapping → silent merge.
//
// The simple version is correct, just stricter. False-positive
// conflicts (user retries after upstream change they wouldn't
// have actually overlapped with) are rare in the spec-edit
// persona's flow, and the AC 6.5 frontend conflict UX gives
// them an easy reload path. Full diff3 ships as a v0.4
// enhancement if user feedback warrants it.
//
// This file therefore pins ONLY the simple stale-SHA contract:
//
//   1. Worker fetches the file's current content from the source
//      ref (GET /repos/{repo}/contents/{path}?ref={ref}) BEFORE
//      writing. The SHA returned by GitHub is the file's blob
//      SHA on that ref.
//   2. If GitHub's SHA equals the request's `baseSha`, save
//      proceeds (cross-pin with save-success.test.ts — that file
//      already mocks matching SHAs and stays green).
//   3. If GitHub's SHA differs from the request's `baseSha`,
//      worker returns:
//        status 4xx (409 canonical)
//        Content-Type: application/json
//        body: {ok: false, kind: 'conflict', message: <string>}
//      AND does NOT proceed to write — no branch, no commit, no
//      PR. (Without this fail-fast pin, a regression would
//      create dead `hashly/spec-edit-*` branches on the repo
//      every time the user encounters a stale SHA.)
//
// Auth gate already pinned by save-no-write.test.ts (cross-pin
// from AC 6.7); we don't re-test it here.

import { SELF, env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "save-conflict-session-32chars-www";
const ACCESS_TOKEN = "ghs_save_conflict_test_token_DO_NOT_LEAK";
// 40-char lowercase-hex SHAs — match GitHub's actual blob/commit SHA
// shape so the AC 6.4 tests stay green under fix #5's strict
// `^[a-f0-9]{40}$` baseSha validation.
const CLIENT_BASE_SHA = "1111111111111111111111111111111111111111";
const NEW_REMOTE_SHA = "2222222222222222222222222222222222222222";
const SOURCE_REF_COMMIT_SHA = "3333333333333333333333333333333333333333";

interface CapturedCall {
  path: string;
  method: string;
  body?: unknown;
}

const captured: CapturedCall[] = [];

function bodyToJson(body: unknown): unknown {
  const text =
    typeof body === "string"
      ? body
      : new TextDecoder().decode(body as ArrayBuffer);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  // GET source ref's commit SHA — happy default. (Used if the
  // impl issues this fetch before the SHA check; on the conflict
  // path we expect the impl to bail BEFORE this matters, but
  // mocking it permissively avoids coupling to call-order.)
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
        object: { sha: SOURCE_REF_COMMIT_SHA, type: "commit" },
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();

  // GET file contents on the source ref. Returns NEW_REMOTE_SHA
  // (different from the request's baseSha) so the worker's
  // stale-SHA check trips. The captured list isn't used here
  // because the test only cares about subsequent writes NOT
  // happening; the GET itself is a precondition.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/contents\/specs\/spec\.md(\?.*)?$/,
      method: "GET",
    })
    .reply(
      200,
      JSON.stringify({
        sha: NEW_REMOTE_SHA,
        path: "specs/spec.md",
        content: btoa("upstream-modified content\n"),
        encoding: "base64",
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();

  // Mock the THREE write-path endpoints to succeed (would-201).
  // The conflict path tests verify that captured.length stays 0
  // for these; if the impl writes anyway despite stale SHA, the
  // captures land here and the tests fail.

  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/git/refs",
      method: "POST",
    })
    .reply((req) => {
      captured.push({
        path: req.path,
        method: req.method,
        body: bodyToJson(req.body),
      });
      return {
        statusCode: 201,
        data: JSON.stringify({
          ref: "refs/heads/hashly/spec-edit-test",
          object: { sha: "new-branch-sha" },
        }),
      };
    })
    .persist();

  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/contents\/specs\/spec\.md(\?.*)?$/,
      method: "PUT",
    })
    .reply((req) => {
      captured.push({
        path: req.path,
        method: req.method,
        body: bodyToJson(req.body),
      });
      return {
        statusCode: 200,
        data: JSON.stringify({ commit: { sha: "would-be-commit" } }),
      };
    })
    .persist();

  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/pulls",
      method: "POST",
    })
    .reply((req) => {
      captured.push({
        path: req.path,
        method: req.method,
        body: bodyToJson(req.body),
      });
      return {
        statusCode: 201,
        data: JSON.stringify({
          html_url: "https://github.com/foo/bar/pull/999",
          number: 999,
        }),
      };
    })
    .persist();
});

beforeEach(async () => {
  captured.length = 0;
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

async function postSave(body: SaveBody): Promise<Response> {
  return SELF.fetch("https://worker.test/api/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Origin matches SELF URL — keeps green under fix #12.
      "Origin": "https://worker.test",
      "Cookie": `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    },
    body: JSON.stringify(body),
  });
}

const STALE_BODY: SaveBody = {
  repo: "foo/bar",
  path: "specs/spec.md",
  ref: "main",
  content: "user-edited content\n",
  baseSha: CLIENT_BASE_SHA, // !== NEW_REMOTE_SHA → stale
};

describe("POST /api/save — stale-SHA conflict (Issue #92 / AC 6.4)", () => {
  it("when baseSha differs from the file's current SHA on the ref, returns kind:'conflict' with status 4xx", async () => {
    // The central RED-path pin. The user started editing at
    // CLIENT_BASE_SHA; upstream advanced to NEW_REMOTE_SHA before
    // they hit save. Worker MUST detect this and refuse, surfacing
    // the structured 'conflict' kind so the AC 6.5 frontend
    // banner can render the "your edit and an upstream change
    // overlap; please reload" message.
    const res = await postSave(STALE_BODY);

    expect(
      res.status,
      `expected a 4xx status on the stale-SHA path (AC 6.4 — caller's edit anchor is stale; conflict is a client-class error). 5xx would imply server fault. Got ${res.status}.`,
    ).toBeGreaterThanOrEqual(400);
    expect(
      res.status,
      `expected a 4xx (not 5xx) status on the conflict path. Got ${res.status}.`,
    ).toBeLessThan(500);

    let body: { ok?: unknown; kind?: unknown; message?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch (e) {
      throw new Error(
        `expected the conflict response body to be JSON-parseable. JSON parse threw: ${String(e)}`,
      );
    }

    expect(
      body.ok,
      `expected ok:false on the stale-SHA conflict path (AC 6.4). Got: ${JSON.stringify(body)}.`,
    ).toBe(false);
    expect(
      body.kind,
      `expected kind:'conflict' on stale-SHA (AC 6.4 — the structured kind lets the frontend route to the AC 6.5 conflict banner). Got: ${JSON.stringify(body)}.`,
    ).toBe("conflict");
    expect(
      typeof body.message,
      `expected a string message field on the conflict response so the AC 6.5 banner has user-facing copy to render. Got: ${JSON.stringify(body)}.`,
    ).toBe("string");
    expect(
      String(body.message).length,
      `expected the conflict message to be non-empty. Got: ${JSON.stringify(body.message)}.`,
    ).toBeGreaterThan(0);
  });

  it("Content-Type on the conflict response is application/json", async () => {
    // Same machine-readable invariant as AC 6.7 (no-write).
    const res = await postSave(STALE_BODY);
    const ct = res.headers.get("content-type") ?? "";
    expect(
      ct.toLowerCase(),
      `expected Content-Type: application/json on the conflict response. Got: ${JSON.stringify(ct)}.`,
    ).toContain("application/json");
  });

  it("conflict response body does NOT leak the access token (AC 3.10)", async () => {
    const res = await postSave(STALE_BODY);
    const text = await res.text();
    expect(
      text,
      "expected the access token to NOT appear in the conflict response body (AC 3.10).",
    ).not.toContain(ACCESS_TOKEN);
  });

  it("on stale-SHA, no branch is created (no POST /git/refs)", async () => {
    // Fail-fast pin: worker must detect the stale SHA BEFORE
    // creating the branch. Without this, every stale-SHA save
    // would leave a `hashly/spec-edit-<ts>` branch dangling on
    // the repo (the conflict response is returned, but the
    // branch was already pushed). Pollutes the branch list and
    // wastes GitHub API quota.
    await postSave(STALE_BODY);

    const branchCreates = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    expect(
      branchCreates.length,
      `expected ZERO POST /git/refs calls on the stale-SHA path (AC 6.4 fail-fast — without this, every stale conflict creates a dead branch on the repo). Got ${branchCreates.length}.`,
    ).toBe(0);
  });

  it("on stale-SHA, no commit happens (no PUT /contents)", async () => {
    // Belt: even if the branch were created, the commit must not
    // land. PUT-then-conflict-response is the worst case: the
    // commit exists upstream but the user thinks it didn't.
    await postSave(STALE_BODY);

    const puts = captured.filter(
      (c) =>
        c.method === "PUT" &&
        c.path.startsWith("/repos/foo/bar/contents/specs/spec.md"),
    );
    expect(
      puts.length,
      `expected ZERO PUT /contents calls on the stale-SHA path (AC 6.4 fail-fast — committing then returning conflict would silently land the user's edit upstream while telling them it failed). Got ${puts.length}.`,
    ).toBe(0);
  });

  it("on stale-SHA, no PR is opened (no POST /pulls)", async () => {
    // Triple-belt: no PR either. Defense in depth — the three
    // write endpoints are independently mocked, so a regression
    // in any one path is caught individually.
    await postSave(STALE_BODY);

    const prs = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/pulls",
    );
    expect(
      prs.length,
      `expected ZERO POST /pulls calls on the stale-SHA path (AC 6.4 fail-fast). Got ${prs.length}.`,
    ).toBe(0);
  });
});
