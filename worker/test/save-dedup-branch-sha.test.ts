// Issue #92 fix-loop iter-2 — dedup PUT uses branch's file sha,
// not source-ref's (fix #1).
//
// AC for security's iter-2 critical:
//
//   AC 6.6 (PR dedup) is broken end-to-end against real GitHub.
//   The iter-1 #1 fix added `sha: currentSha` to PUT /contents,
//   where `currentSha` comes from GET on the SOURCE ref. For the
//   FIRST save this is correct (the freshly-created branch's file
//   SHA matches source-ref's file SHA — the branch is at the
//   source's commit). But for the DEDUP path (writing to an
//   already-existing branch from a previous save), the branch's
//   file SHA has advanced after the first commit, while
//   `currentSha` still points at source-ref's SHA. Real GitHub
//   returns 422 ("sha out of date") on the second save.
//
//   Mocked iter-1 tests didn't catch this — the PUT mock accepts
//   any body, so the wrong sha rides through silently.
//
//   Team-lead's chosen fix (option a): on the dedup path, GET
//   /contents/{path}?ref={cachedBranchName} BEFORE the PUT to
//   fetch the branch's current file SHA. Use that in the dedup
//   PUT body.
//
// What this slice pins:
//
//   1. **First save** PUT body's `sha` field === SOURCE_FILE_SHA
//      (the GET-on-source-ref response value). Cross-pin with
//      iter-1's save-failure-paths.test.ts; here we're just
//      verifying the differentiating-mock setup itself works.
//
//   2. **Second save** (same session + spec → dedup hit) PUT body's
//      `sha` field === BRANCH_FILE_SHA (the GET-on-branch response
//      value). The CENTRAL #1 pin.
//
//   3. **Second save** issues a GET against the branch ref (not
//      just the source ref) before the PUT. Pinned via captured
//      calls — the dedup path must read fresh from the branch.
//
// The mock differentiates GET /contents responses by the `ref`
// query param: source ref returns SOURCE_FILE_SHA; any
// `hashly/spec-edit-*` ref returns BRANCH_FILE_SHA.

import { SELF, env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "save-dedup-sha-session-32-chars-z";
const ACCESS_TOKEN = "ghs_dedup_sha_test_token_DO_NOT_LEAK";

// Distinct shas so the test can verify which one the PUT used.
const SOURCE_FILE_SHA = "feedfacefeedfacefeedfacefeedfacefeedface";
const BRANCH_FILE_SHA = "1234567890abcdef1234567890abcdef12345678";
const SOURCE_COMMIT_SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const PR_HTML_URL = "https://github.com/foo/bar/pull/123";

interface CapturedCall {
  path: string;
  method: string;
  body?: unknown;
  refQueryParam?: string | null;
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

  // GET source ref's commit SHA — for branch creation.
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
        object: { sha: SOURCE_COMMIT_SHA, type: "commit" },
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();

  // GET file contents — RESPONDS DIFFERENTLY based on the `ref`
  // query param. Source ref → SOURCE_FILE_SHA; spec-edit branch
  // → BRANCH_FILE_SHA. The test relies on this differentiation
  // to verify which sha the dedup PUT uses.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/contents\/specs\/spec\.md(\?.*)?$/,
      method: "GET",
    })
    .reply((req) => {
      const url = new URL(`https://api.github.com${req.path}`);
      const refQueryParam = url.searchParams.get("ref");
      captured.push({
        path: req.path,
        method: req.method,
        refQueryParam,
      });
      const isBranchRef =
        typeof refQueryParam === "string" &&
        refQueryParam.startsWith("hashly/spec-edit-");
      const sha = isBranchRef ? BRANCH_FILE_SHA : SOURCE_FILE_SHA;
      return {
        statusCode: 200,
        data: JSON.stringify({
          sha,
          path: "specs/spec.md",
          content: btoa(isBranchRef ? "after first save\n" : "original\n"),
          encoding: "base64",
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();

  // POST /git/refs — branch create.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/git/refs",
      method: "POST",
    })
    .reply((req) => {
      const body = bodyToJson(req.body);
      captured.push({ path: req.path, method: req.method, body });
      return {
        statusCode: 201,
        data: JSON.stringify({
          ref: (body as { ref?: string })?.ref ?? "refs/heads/unknown",
          object: { sha: "new-branch-sha" },
        }),
      };
    })
    .persist();

  // PUT contents — captures the body so we can inspect the sha
  // field. The mock accepts any sha (as before — the wrong sha
  // rides through fine in tests; the real check is in the
  // captured-body assertion).
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/contents\/specs\/spec\.md(\?.*)?$/,
      method: "PUT",
    })
    .reply((req) => {
      const body = bodyToJson(req.body);
      captured.push({ path: req.path, method: req.method, body });
      return {
        statusCode: 200,
        data: JSON.stringify({
          commit: { sha: "commit-sha" },
          content: { sha: "new-file-sha" },
        }),
      };
    })
    .persist();

  // POST /pulls — opens PR. Returns same html_url for first call;
  // dedup path should not reach this on second save.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/pulls",
      method: "POST",
    })
    .reply((req) => {
      const body = bodyToJson(req.body);
      captured.push({ path: req.path, method: req.method, body });
      return {
        statusCode: 201,
        data: JSON.stringify({
          html_url: PR_HTML_URL,
          number: 123,
          state: "open",
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
}

async function postSave(body: SaveBody): Promise<Response> {
  return SELF.fetch("https://worker.test/api/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://worker.test",
      Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY: SaveBody = {
  repo: "foo/bar",
  path: "specs/spec.md",
  ref: "main",
  content: "edited content\n",
  baseSha: SOURCE_FILE_SHA,
};

function lastPutBody(): { branch?: string; sha?: string; content?: string } {
  const puts = captured.filter(
    (c) =>
      c.method === "PUT" &&
      c.path.startsWith("/repos/foo/bar/contents/specs/spec.md"),
  );
  expect(puts.length, "expected at least one PUT to have been captured").toBeGreaterThan(0);
  return puts[puts.length - 1]!.body as {
    branch?: string;
    sha?: string;
    content?: string;
  };
}

describe("POST /api/save — first save (sanity / cross-pin with iter-1 #1)", () => {
  it("first save's PUT body sha equals SOURCE_FILE_SHA (the GET-on-source-ref response)", async () => {
    // Sanity precondition: the differentiating mock works as
    // designed for the first-save path. iter-1's
    // save-failure-paths.test.ts already pins this for the
    // single-save case; here we're verifying our new mock setup
    // also satisfies it before testing the dedup behavior.
    const res = await postSave(VALID_BODY);
    expect(res.status, "first save must succeed end-to-end").toBe(200);

    const putBody = lastPutBody();
    expect(
      putBody.sha,
      `precondition: first save's PUT body must include sha = SOURCE_FILE_SHA. Got: ${JSON.stringify(putBody.sha)}.`,
    ).toBe(SOURCE_FILE_SHA);
  });
});

describe("POST /api/save — dedup PUT uses BRANCH file sha (fix #1)", () => {
  it("second save in same session+spec — PUT body sha equals BRANCH_FILE_SHA (NOT SOURCE_FILE_SHA)", async () => {
    // The central #1 RED-path pin. This is the bug team-lead
    // confirmed in iter-2: dedup PUT uses source-ref's sha
    // instead of the branch's, so real GitHub returns 422.
    //
    // Fix: the dedup path GETs /contents?ref=<cachedBranchName>
    // before PUT, captures the branch's file sha, uses that.
    //
    // Differentiating mock: source ref → SOURCE_FILE_SHA;
    // branch ref → BRANCH_FILE_SHA. After the bug is fixed,
    // the dedup PUT must use BRANCH_FILE_SHA.
    await postSave(VALID_BODY); // first save: caches branchName + prUrl

    const branchCreateBeforeDedup = captured.find(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    const branchRef =
      (branchCreateBeforeDedup?.body as { ref?: string })?.ref ?? "";
    const branchName = branchRef.replace(/^refs\/heads\//, "");
    expect(
      branchName.length,
      "precondition: first save must have created a branch with a parseable name",
    ).toBeGreaterThan(0);

    captured.length = 0;

    const res = await postSave({
      ...VALID_BODY,
      content: "second edit — dedup save\n",
    });
    expect(res.status, "second save (dedup) must succeed").toBe(200);

    const putBody = lastPutBody();
    expect(
      putBody.sha,
      `expected the dedup PUT body's sha = BRANCH_FILE_SHA ${JSON.stringify(BRANCH_FILE_SHA)} (the branch's current file sha after the first commit). Source-ref's sha ${JSON.stringify(SOURCE_FILE_SHA)} is the iter-1 bug — real GitHub would return 422. Got: ${JSON.stringify(putBody.sha)}.`,
    ).toBe(BRANCH_FILE_SHA);

    // Belt: the dedup PUT must still target the cached branch
    // (cross-pin with AC 6.6).
    expect(
      putBody.branch,
      `expected the dedup PUT body's branch field to match the cached branch ${JSON.stringify(branchName)}. Got: ${JSON.stringify(putBody.branch)}.`,
    ).toBe(branchName);
  });

  it("dedup path issues a GET /contents?ref=<branchName> (re-fetches branch's file sha)", async () => {
    // Pin the explicit fetch the team-lead specified (option a):
    // "Add a separate GET /contents/{path}?ref={branchName} call
    // before the PUT in the dedup branch." Without this fetch,
    // the impl can't know the branch's current sha.
    //
    // We pin the fetch happens on the dedup save (NOT the first
    // save's source-ref GET — that's a different call). The
    // differentiating mock captures the `ref` query param so we
    // can distinguish.
    await postSave(VALID_BODY);
    const branchCreate = captured.find(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    const branchRef =
      (branchCreate?.body as { ref?: string })?.ref ?? "";
    const branchName = branchRef.replace(/^refs\/heads\//, "");

    captured.length = 0;

    await postSave({
      ...VALID_BODY,
      content: "second edit — dedup save\n",
    });

    const branchGets = captured.filter(
      (c) =>
        c.method === "GET" &&
        c.path.startsWith("/repos/foo/bar/contents/specs/spec.md") &&
        c.refQueryParam === branchName,
    );
    expect(
      branchGets.length,
      `expected at least one GET /contents?ref=${branchName} on the dedup save (#1 — the branch-side sha re-fetch). Without this, the dedup PUT would reuse the source-ref sha and 422 against real GitHub. Got ${branchGets.length} branch-side GETs. All captured GETs: ${JSON.stringify(
        captured
          .filter(
            (c) =>
              c.method === "GET" &&
              c.path.startsWith("/repos/foo/bar/contents/"),
          )
          .map((c) => c.refQueryParam),
      )}.`,
    ).toBeGreaterThan(0);
  });

  it("dedup save does NOT create a new branch and does NOT open a new PR (cross-pin with AC 6.6)", async () => {
    // Cross-pin: the dedup behavior from AC 6.6 must still hold
    // after the iter-2 #1 fix. A regression that "fixes" the PUT
    // sha by always re-running the full first-save flow would
    // create duplicate branches + PRs.
    await postSave(VALID_BODY);
    captured.length = 0;

    await postSave({
      ...VALID_BODY,
      content: "second edit — dedup save\n",
    });

    const branchCreates = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    expect(
      branchCreates.length,
      `expected ZERO POST /git/refs on the dedup save (AC 6.6 cross-pin). Got ${branchCreates.length}.`,
    ).toBe(0);

    const prs = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/pulls",
    );
    expect(
      prs.length,
      `expected ZERO POST /pulls on the dedup save (AC 6.6 cross-pin). Got ${prs.length}.`,
    ).toBe(0);
  });
});
