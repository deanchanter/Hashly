// Issue #92 / AC 6.6 — PR dedup within session.
//
// AC text: "on second Save within the same session, detect
// existing PR for this branch and push a new commit instead of
// opening a duplicate PR."
//
// Semantically: the dedup key is (sessionId, repo, path, ref) —
// editing the SAME spec twice in one session must reuse the same
// branch + PR (push a new commit to the existing branch). Editing
// a DIFFERENT spec in the same session, or the SAME spec in a
// different session, must create a fresh branch + PR — the cache
// is per-spec-per-session.
//
// What this slice pins on the second save (same session + spec):
//   1. Response carries the SAME prUrl as the first save (the
//      reused PR's html_url).
//   2. NO new POST /git/refs (the branch already exists upstream).
//   3. NO new POST /pulls (the PR already exists).
//   4. A PUT /contents DOES happen with `branch:<first save's
//      branch>` — the new commit lands on the existing branch.
//
// And on the boundary (cache must NOT bleed):
//   5. Different session, same spec → fresh branch + PR.
//   6. Same session, different spec (different ref) → fresh
//      branch + PR.
//
// Implementation hint for builder (non-binding): after a
// successful first save, persist a record in env.SESSIONS keyed
// by something like `edit:${sessionId}:${repo}:${path}:${ref}`
// → JSON `{branchName, prUrl}`. On the next save, look up the
// key first; if present, skip branch-create / PR-open and PUT on
// the cached branch. The exact storage shape isn't pinned —
// only the user-visible outcomes above.

import { SELF, env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_A = "save-dedup-session-A-32chars-aaaa";
const SESSION_B = "save-dedup-session-B-32chars-bbbb";
const ACCESS_TOKEN = "ghs_save_dedup_test_token_DO_NOT_LEAK";
const FILE_SHA_ON_REF = "feedfacefeedfacefeedfacefeedfacefeedface";
const SOURCE_REF_COMMIT_SHA = "deadbeefcafebabe1234567890abcdef12345678";
const PR_URL_FIRST = "https://github.com/foo/bar/pull/100";
// PR_URL_NEXT is distinct so the "second save returns the same
// prUrl" pin actually catches a regression — without this, the
// mock always-returns-PR_URL_FIRST and the assertion passes
// coincidentally even when the impl opened a duplicate PR.
const PR_URL_NEXT = "https://github.com/foo/bar/pull/200";

interface CapturedCall {
  path: string;
  method: string;
  body?: unknown;
}

const captured: CapturedCall[] = [];

// Module-scoped POST /pulls counter — used by the mock to return
// PR_URL_FIRST on call #1 and PR_URL_NEXT on call #2+. Reset in
// `beforeEach` (in-place via an object holder so the closure in
// `beforeAll`'s interceptor stays valid).
const pullsCounter = { count: 0 };

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

  // GET source ref's commit SHA — permissive regex so we can
  // exercise multiple refs in the "different spec" boundary test.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/git\/ref\/heads\/[^/]+(\/[^/]+)*$/,
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

  // GET file contents — permissive on ref query so a fetch
  // against the source ref OR the spec-edit branch both work.
  // Returns matching SHA so the AC 6.4 stale-SHA check passes
  // and the impl proceeds to the writes.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/contents\/specs\/spec\.md(\?.*)?$/,
      method: "GET",
    })
    .reply(
      200,
      JSON.stringify({
        sha: FILE_SHA_ON_REF,
        path: "specs/spec.md",
        content: btoa("original content\n"),
        encoding: "base64",
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();

  // POST /git/refs — branch create. Captures so we can count
  // these per save attempt.
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

  // PUT /contents — commit. Captured so we can pin which branch
  // it lands on (same on both saves of the same session+spec).
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

  // POST /pulls — PR open. The FIRST call within a test returns
  // html_url=PR_URL_FIRST; subsequent calls return PR_URL_NEXT.
  // This makes the "second save returns the SAME prUrl" pin
  // meaningful: a regression that opens a duplicate PR for the
  // second save would receive PR_URL_NEXT back and the test
  // would fail. The counter resets in beforeEach via the
  // pullsCounter holder.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/pulls",
      method: "POST",
    })
    .reply((req) => {
      pullsCounter.count += 1;
      const body = bodyToJson(req.body);
      captured.push({ path: req.path, method: req.method, body });
      const isFirst = pullsCounter.count === 1;
      return {
        statusCode: 201,
        data: JSON.stringify({
          html_url: isFirst ? PR_URL_FIRST : PR_URL_NEXT,
          number: isFirst ? 100 : 200,
          state: "open",
        }),
      };
    })
    .persist();
});

beforeEach(async () => {
  captured.length = 0;
  pullsCounter.count = 0;
  // Seed two distinct sessions so the boundary test ("different
  // session → fresh PR") has a second session to use.
  await env.SESSIONS.put(
    SESSION_A,
    JSON.stringify({
      access_token: ACCESS_TOKEN,
      installation_id: "42",
      expires_at: "2030-01-01T00:00:00Z",
    }),
  );
  await env.SESSIONS.put(
    SESSION_B,
    JSON.stringify({
      access_token: ACCESS_TOKEN,
      installation_id: "43",
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
  body: SaveBody,
  opts: { sessionId: string },
): Promise<Response> {
  return SELF.fetch("https://worker.test/api/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: `${SESSION_COOKIE_NAME}=${opts.sessionId}`,
    },
    body: JSON.stringify(body),
  });
}

const SPEC_BODY: SaveBody = {
  repo: "foo/bar",
  path: "specs/spec.md",
  ref: "main",
  content: "edited content\n",
  baseSha: FILE_SHA_ON_REF,
};

describe("POST /api/save — PR dedup within session (Issue #92 / AC 6.6)", () => {
  it("first save creates a branch + PR (cross-pin sanity check)", async () => {
    // Establishes the baseline: under the dedup-test mock setup,
    // a first save still goes through the AC 6.2 happy path.
    // This is a "make sure the rest of the file's reasoning is
    // sound" check — without this, a regression that breaks the
    // first-save path would silently invalidate the second-save
    // dedup pins.
    const res = await postSave(SPEC_BODY, { sessionId: SESSION_A });
    expect(res.status).toBe(200);

    const branchCreates = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    const prs = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/pulls",
    );
    expect(
      branchCreates.length,
      "precondition: first save must create exactly one branch (AC 6.2 cross-pin).",
    ).toBe(1);
    expect(
      prs.length,
      "precondition: first save must open exactly one PR (AC 6.2 cross-pin).",
    ).toBe(1);
  });

  it("second save in the SAME session + SAME spec returns the SAME prUrl as the first save", async () => {
    // The central RED-path pin. Two saves in the same session,
    // same spec → both responses must surface the same PR URL.
    // Without this, a user who edits → saves → edits more →
    // saves again would create two PRs for the same spec; the
    // dev who reviews them would see duplicate work.
    const res1 = await postSave(SPEC_BODY, { sessionId: SESSION_A });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { prUrl?: string };
    expect(body1.prUrl).toBe(PR_URL_FIRST);

    captured.length = 0; // separate the second-save inspection

    const secondBody: SaveBody = {
      ...SPEC_BODY,
      content: "edited again — second save in same session\n",
    };
    const res2 = await postSave(secondBody, { sessionId: SESSION_A });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { prUrl?: string };
    expect(
      body2.prUrl,
      `expected the second save's prUrl to equal the first save's prUrl ${JSON.stringify(PR_URL_FIRST)} (AC 6.6 — dedup reuses the existing PR). Got: ${JSON.stringify(body2.prUrl)}.`,
    ).toBe(PR_URL_FIRST);
  });

  it("second save in the SAME session + SAME spec does NOT create a new branch (no POST /git/refs)", async () => {
    // The "no duplicate branch" pin. The first save's branch
    // already exists upstream; creating a fresh `hashly/spec-
    // edit-<newTimestamp>` would split the user's edits across
    // two branches.
    await postSave(SPEC_BODY, { sessionId: SESSION_A });
    captured.length = 0;

    await postSave(
      { ...SPEC_BODY, content: "second edit\n" },
      { sessionId: SESSION_A },
    );

    const branchCreates = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    expect(
      branchCreates.length,
      `expected ZERO POST /git/refs calls on the second save in the same session+spec (AC 6.6 — dedup reuses the existing branch). Got ${branchCreates.length}.`,
    ).toBe(0);
  });

  it("second save in the SAME session + SAME spec does NOT open a new PR (no POST /pulls)", async () => {
    // Belt: no duplicate PR, mirroring the no-duplicate-branch pin.
    await postSave(SPEC_BODY, { sessionId: SESSION_A });
    captured.length = 0;

    await postSave(
      { ...SPEC_BODY, content: "second edit\n" },
      { sessionId: SESSION_A },
    );

    const prs = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/pulls",
    );
    expect(
      prs.length,
      `expected ZERO POST /pulls calls on the second save in the same session+spec (AC 6.6 — the existing PR is reused, not duplicated). Got ${prs.length}.`,
    ).toBe(0);
  });

  it("second save in the SAME session + SAME spec DOES PUT new content on the SAME branch as the first save", async () => {
    // The "push to existing branch" pin. Without this, the second
    // save would still skip branch-create + PR-open but ALSO skip
    // the commit — defeating the whole point of saving again.
    // Pin: a new PUT happens, and its `branch` field equals the
    // first save's branch.
    await postSave(SPEC_BODY, { sessionId: SESSION_A });
    const firstSaveBranchCreate = captured.find(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    const firstBranchRef =
      (firstSaveBranchCreate?.body as { ref?: string })?.ref ?? "";
    const firstBranchName = firstBranchRef.replace(/^refs\/heads\//, "");
    expect(
      firstBranchName.length,
      "precondition: first save must have created a branch with a name",
    ).toBeGreaterThan(0);

    captured.length = 0;

    await postSave(
      { ...SPEC_BODY, content: "second edit\n" },
      { sessionId: SESSION_A },
    );

    const secondPuts = captured.filter(
      (c) =>
        c.method === "PUT" &&
        c.path.startsWith("/repos/foo/bar/contents/specs/spec.md"),
    );
    expect(
      secondPuts.length,
      `expected exactly ONE PUT /contents on the second save (AC 6.6 — the new commit lands on the existing branch). Got ${secondPuts.length}.`,
    ).toBe(1);

    const putBody = secondPuts[0]!.body as { branch?: string };
    expect(
      putBody.branch,
      `expected the second save's PUT body "branch" to equal the first save's branch ${JSON.stringify(firstBranchName)} (AC 6.6 — push to the existing branch, don't create a new one). Got: ${JSON.stringify(putBody.branch)}.`,
    ).toBe(firstBranchName);
  });
});

describe("POST /api/save — dedup boundaries (Issue #92 / AC 6.6)", () => {
  it("DIFFERENT session + same spec creates a NEW branch + PR (sessions don't bleed)", async () => {
    // Security/scope pin: the dedup cache is keyed by sessionId
    // (among other things). Two separate users editing the same
    // spec must each get their own PR — otherwise user B's save
    // would push a commit to user A's branch under user A's PR,
    // attributing user B's edit to user A's review thread.
    await postSave(SPEC_BODY, { sessionId: SESSION_A });
    captured.length = 0;

    // Same spec, DIFFERENT session.
    const res = await postSave(
      { ...SPEC_BODY, content: "session B's edit\n" },
      { sessionId: SESSION_B },
    );
    expect(res.status).toBe(200);

    const branchCreates = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    expect(
      branchCreates.length,
      `expected exactly ONE POST /git/refs on a different session's first save of the same spec (AC 6.6 — the dedup cache must be per-session; without this, sessions bleed and one user's save lands under another user's PR). Got ${branchCreates.length}.`,
    ).toBe(1);

    const prs = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/pulls",
    );
    expect(
      prs.length,
      `expected exactly ONE POST /pulls on a different session's first save of the same spec (AC 6.6 boundary). Got ${prs.length}.`,
    ).toBe(1);
  });

  it("SAME session + DIFFERENT spec (different ref) creates a NEW branch + PR (cache key is per-spec)", async () => {
    // The cache key must include the spec coordinate. A user
    // editing two specs in one session must get TWO PRs — without
    // this, the second spec's save would push to the first spec's
    // branch, mixing edits across unrelated reviews.
    await postSave(SPEC_BODY, { sessionId: SESSION_A });
    captured.length = 0;

    // Same session, DIFFERENT spec (different ref).
    const res = await postSave(
      { ...SPEC_BODY, ref: "develop", content: "different ref edit\n" },
      { sessionId: SESSION_A },
    );
    expect(res.status).toBe(200);

    const branchCreates = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    expect(
      branchCreates.length,
      `expected exactly ONE POST /git/refs on a different-spec save in the same session (AC 6.6 — the dedup cache must be per-(repo, path, ref); without this, editing two specs in one session would mix them under one branch). Got ${branchCreates.length}.`,
    ).toBe(1);

    const prs = captured.filter(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/pulls",
    );
    expect(
      prs.length,
      `expected exactly ONE POST /pulls on a different-spec save (AC 6.6 — separate PRs per spec). Got ${prs.length}.`,
    ).toBe(1);
  });
});
