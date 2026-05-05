// Issue #92 / AC 6.2 — `POST /api/save` happy path.
//
// "creates branch `hashly/spec-edit-<timestamp>`, commits the new
// content, opens a PR against the source ref; returns PR URL"
//
// This file pins the SUCCESS shape on the worker side. AC 6.7
// already pinned the no-write translation; this slice pins what
// happens when GitHub accepts every write call.
//
// Pinned outcomes (the test does NOT couple to call-order beyond
// the dependency relationship — only to the observable end state):
//
//   1. Worker issues a POST against `/repos/{owner}/{repo}/git/refs`
//      to create a branch. The branch ref is `refs/heads/hashly/spec-
//      edit-<timestamp>` (literal prefix `hashly/spec-edit-` with
//      something appended; the timestamp shape isn't pinned beyond
//      "non-empty suffix" because Date.now()-based suffixes vary
//      across runs).
//   2. Worker issues a PUT against `/repos/{owner}/{repo}/contents/
//      {path}` (the commit) on that same branch. The body's `branch`
//      field MUST match the branch name from #1 — otherwise the
//      commit lands on the wrong ref. The body's `content` field
//      MUST be base64 of the user's posted content (round-trip
//      check).
//   3. Worker issues a POST against `/repos/{owner}/{repo}/pulls`
//      with `head=<branch from #1>` and `base=<source ref from
//      request body>`. Without `head` matching #1, the PR would
//      reference the wrong branch; without `base=ref`, it would
//      target the wrong destination.
//   4. Response status 200 with JSON body `{ok: true, prUrl: <PR
//      html_url from GitHub>}`.
//
// We do NOT pin: the exact timestamp suffix (Date.now()-based), the
// commit message, the PR title/body, the file SHA inclusion in the
// PUT body (that's AC 6.4's territory once stale-SHA detection ships),
// the `branch` query string format on the contents PUT.
//
// Auth gate already pinned by `save-no-write.test.ts` (cross-pin from
// AC 3.6 / AC 6.7); we don't re-test it here.

import { exports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { fetchMock } from "./fetch-mock";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "save-success-session-32chars-yyy";
const ACCESS_TOKEN = "ghs_save_success_test_token_DO_NOT_LEAK";
const PR_HTML_URL = "https://github.com/foo/bar/pull/42";
const SOURCE_REF_COMMIT_SHA = "deadbeefcafebabe1234567890abcdef12345678";
const FILE_SHA_ON_REF = "feedfacefeedfacefeedfacefeedfacefeedface";

interface CapturedCall {
  path: string;
  method: string;
  body?: unknown;
}

// Module-level captured-calls reservoir. Reset in `beforeEach` via
// `length = 0` so closures captured by `.persist()`-ed interceptors
// in `beforeAll` keep referencing the same array. Without this,
// per-test mock setups would leak interceptors across tests and
// requests would land in stale arrays.
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

  // Register the four happy-path interceptors ONCE. Each captures
  // into the module-level `captured` array via closure; the array
  // is reset per test in beforeEach.

  // GET source ref commit SHA — used as the parent for the new branch.
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

  // Issue #92 / AC 6.4 cross-pin — GET file contents on the source
  // ref. AC 6.4 added a stale-SHA pre-check before any write call:
  // worker fetches this endpoint, compares `sha` with the request's
  // baseSha, and returns kind:'conflict' on mismatch. The success
  // path needs the SHAs to MATCH so the worker proceeds to the
  // writes — set `sha: FILE_SHA_ON_REF` to match VALID_BODY's
  // `baseSha: FILE_SHA_ON_REF` below.
  //
  // Without this mock the stale-SHA fetch hits `disableNetConnect`
  // and throws; the builder's AC 6.4 graceful-fallback handles
  // that, but mocking explicitly makes the test fixture honest
  // about the actual call sequence — and lets a future stricter
  // impl (treat fetch error as 'other' kind) stay green here.
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

  // POST /git/refs — branch create. Captures the body so the test
  // can inspect the branch ref + base SHA.
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
          object: { sha: "new-branch-commit-sha" },
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();

  // PUT /contents/<path> — commit on the branch. Captures the body
  // so the test can inspect `branch`, `content` (base64), `message`.
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
          commit: { sha: "commit-sha-after-put" },
          content: { sha: "new-file-sha" },
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();

  // POST /pulls — PR open. Returns html_url=PR_HTML_URL so the
  // success-shape test can verify the response surfaces it.
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
          number: 42,
          state: "open",
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();
});

beforeEach(async () => {
  // Reset the captured array IN PLACE — the .persist()-ed
  // interceptors above closed over the original reference; setting
  // `captured = []` would break them.
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

async function postSave(
  body: SaveBody,
  opts: { cookie?: string } = {},
): Promise<Response> {
  const headers: HeadersInit = {
    "content-type": "application/json",
    // Origin matches SELF URL — keeps green under fix #12 same-origin gate.
    "Origin": "https://worker.test",
  };
  if (opts.cookie !== undefined) headers["Cookie"] = opts.cookie;
  return (exports as any).default.fetch("https://worker.test/api/save", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_BODY: SaveBody = {
  repo: "foo/bar",
  path: "specs/spec.md",
  ref: "main",
  content: "edited content body\n",
  baseSha: FILE_SHA_ON_REF,
};

describe("POST /api/save — happy path response shape (Issue #92 / AC 6.2)", () => {
  it("returns status 200 with `{ok: true, prUrl}` JSON body", async () => {
    // The central success pin. After the worker successfully creates
    // a branch, commits, and opens the PR, it returns the PR URL so
    // the frontend can link to it (AC 6.3 success banner consumes
    // this URL).
    const res = await postSave(VALID_BODY, {
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    });

    expect(
      res.status,
      `expected status 200 on the happy path (AC 6.2 — successful save). Got ${res.status}.`,
    ).toBe(200);

    let body: { ok?: unknown; prUrl?: unknown; kind?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch (e) {
      throw new Error(
        `expected the success response body to be JSON-parseable. JSON parse threw: ${String(e)}`,
      );
    }

    expect(
      body.ok,
      `expected ok:true on the happy path. Got: ${JSON.stringify(body)}.`,
    ).toBe(true);
    expect(
      body.kind,
      `expected NO 'kind' field on the success path (AC 6.2 — kind is reserved for error discriminants in the SaveResult union; including it on success would force the frontend to also branch on success-with-kind). Got: ${JSON.stringify(body)}.`,
    ).toBeUndefined();
    expect(typeof body.prUrl).toBe("string");
    expect(
      String(body.prUrl),
      `expected prUrl to equal the GitHub PR's html_url verbatim (AC 6.2 — the frontend's success banner links to this URL). Expected: ${JSON.stringify(PR_HTML_URL)}. Got: ${JSON.stringify(body.prUrl)}.`,
    ).toBe(PR_HTML_URL);
  });

  it("response Content-Type is application/json", async () => {
    const res = await postSave(VALID_BODY, {
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    });
    const ct = res.headers.get("content-type") ?? "";
    expect(
      ct.toLowerCase(),
      `expected Content-Type: application/json on the success path so the frontend can parse the structured response. Got: ${JSON.stringify(ct)}.`,
    ).toContain("application/json");
  });

  it("response body does NOT leak the access token", async () => {
    // AC 3.10 token-leak invariant carries over to the success path.
    const res = await postSave(VALID_BODY, {
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    });
    const text = await res.text();
    expect(
      text,
      "expected the access token to NOT appear in the success response body (AC 3.10).",
    ).not.toContain(ACCESS_TOKEN);
  });
});

describe("POST /api/save — branch create on the happy path (Issue #92 / AC 6.2)", () => {
  it("creates a branch named `hashly/spec-edit-<...>` (literal `hashly/spec-edit-` prefix is non-negotiable)", async () => {
    // Pin the branch-name shape verbatim per AC 6.2 + team-lead's
    // implementation note. The forward-slash in `hashly/spec-edit-`
    // is intentional — Git treats it as a namespace marker (matches
    // conventions like `feature/x` and `release/y`); without the
    // slash a regression to `hashly-spec-edit-` would still test as
    // "starts with hashly" but lose the namespace property.
    await postSave(VALID_BODY, {
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    });

    const branchCreate = captured.find(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    expect(
      branchCreate,
      "expected a POST to /repos/foo/bar/git/refs (AC 6.2 — the branch-create call). Without it, no branch exists for the commit + PR.",
    ).toBeDefined();

    const refField = (branchCreate!.body as { ref?: string })?.ref;
    expect(
      typeof refField,
      `expected the branch-create body to include a string "ref" field. Got body: ${JSON.stringify(branchCreate!.body)}.`,
    ).toBe("string");
    expect(
      String(refField).startsWith("refs/heads/hashly/spec-edit-"),
      `expected the branch ref to start with "refs/heads/hashly/spec-edit-" (AC 6.2 — branch name "hashly/spec-edit-<timestamp>" is the documented shape; the forward-slash matters). Got: ${JSON.stringify(refField)}.`,
    ).toBe(true);

    // Belt: the suffix after the prefix must be non-empty (some
    // timestamp / nonce). Otherwise an impl that ships a bare
    // "refs/heads/hashly/spec-edit-" branch name would collide
    // across saves.
    const suffix = String(refField).slice("refs/heads/hashly/spec-edit-".length);
    expect(
      suffix.length,
      `expected a non-empty suffix after "hashly/spec-edit-" so each save creates a unique branch. Got: ${JSON.stringify(refField)}.`,
    ).toBeGreaterThan(0);
  });

  it("the branch is created from the source ref's commit SHA", async () => {
    // Pin: the new branch is rooted at the source ref (so the PR
    // diff is meaningful). Without this, the impl could base the
    // branch off some other commit (e.g., a wrong default sha) and
    // the PR would show a confusing diff.
    await postSave(VALID_BODY, {
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    });

    const branchCreate = captured.find(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    expect(branchCreate, "precondition: branch-create call must have happened").toBeDefined();

    const sha = (branchCreate!.body as { sha?: string })?.sha;
    expect(
      sha,
      `expected the branch-create body's "sha" field to equal the source ref's commit SHA (AC 6.2 — the new branch must be rooted on the source ref so the PR diff is meaningful). Expected: ${JSON.stringify(SOURCE_REF_COMMIT_SHA)}. Got: ${JSON.stringify(sha)}.`,
    ).toBe(SOURCE_REF_COMMIT_SHA);
  });
});

describe("POST /api/save — commit on the happy path (Issue #92 / AC 6.2)", () => {
  it("commits the user's content via PUT /contents/<path> on the created branch", async () => {
    // Pin: the commit happens on the BRANCH the worker just created,
    // not on the source ref directly. PUT-on-source-ref would defeat
    // the whole "open a PR" flow (the user's edit would land on
    // main without review).
    await postSave(VALID_BODY, {
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    });

    const branchCreate = captured.find(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    const branchRef = (branchCreate?.body as { ref?: string })?.ref ?? "";
    const branchName = branchRef.replace(/^refs\/heads\//, "");
    expect(
      branchName.length,
      "precondition: a branch name must have been created",
    ).toBeGreaterThan(0);

    const commitPut = captured.find(
      (c) =>
        c.method === "PUT" &&
        c.path.startsWith("/repos/foo/bar/contents/specs/spec.md"),
    );
    expect(
      commitPut,
      "expected a PUT to /repos/foo/bar/contents/specs/spec.md (AC 6.2 — the commit lands the user's content on the branch).",
    ).toBeDefined();

    const putBody = commitPut!.body as {
      branch?: string;
      content?: string;
      message?: string;
    };
    expect(
      putBody.branch,
      `expected the PUT body's "branch" field to match the created branch name "${branchName}" (AC 6.2 — without this the commit lands on the wrong ref). Got: ${JSON.stringify(putBody.branch)}.`,
    ).toBe(branchName);
  });

  it("the commit body carries the user's content (base64-encoded round-trip)", async () => {
    // Pin: the bytes posted by the user MUST end up in the commit.
    // GitHub's contents API takes base64-encoded content; verify
    // round-trip by decoding the body's `content` field and
    // comparing to the original. Without this, an impl that sends
    // the wrong field (say, `text` instead of `content`) or that
    // double-encodes would silently round-trip empty / wrong data.
    const expectedContent = "edited content body\n";
    await postSave(
      { ...VALID_BODY, content: expectedContent },
      { cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    );

    const commitPut = captured.find(
      (c) =>
        c.method === "PUT" &&
        c.path.startsWith("/repos/foo/bar/contents/specs/spec.md"),
    );
    expect(commitPut, "precondition: commit PUT must have happened").toBeDefined();

    const putBody = commitPut!.body as { content?: string };
    expect(
      typeof putBody.content,
      `expected the PUT body to include a string "content" field (base64). Got body: ${JSON.stringify(putBody)}.`,
    ).toBe("string");

    let decoded: string;
    try {
      decoded = atob(putBody.content!);
    } catch (e) {
      throw new Error(
        `expected the PUT body's "content" field to be valid base64. atob threw: ${String(e)}. Got: ${JSON.stringify(putBody.content)}.`,
      );
    }
    expect(
      decoded,
      `expected the base64-decoded PUT content to equal the user's posted content verbatim (AC 6.2 — content round-trip). Expected: ${JSON.stringify(expectedContent)}. Got: ${JSON.stringify(decoded)}.`,
    ).toBe(expectedContent);
  });
});

describe("POST /api/save — PR open on the happy path (Issue #92 / AC 6.2)", () => {
  it("opens a PR with `head` matching the created branch and `base` matching the source ref", async () => {
    // The compositional pin: head=branch + base=source ref means
    // the PR shows "branch's edits on top of source ref" — the
    // expected reviewer experience. Without this, the PR could
    // target a different ref and look empty / confusing.
    await postSave(VALID_BODY, {
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    });

    const branchCreate = captured.find(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    const branchRef = (branchCreate?.body as { ref?: string })?.ref ?? "";
    const branchName = branchRef.replace(/^refs\/heads\//, "");

    const prOpen = captured.find(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/pulls",
    );
    expect(
      prOpen,
      "expected a POST to /repos/foo/bar/pulls (AC 6.2 — the PR-open call surfaces the user's commit for review).",
    ).toBeDefined();

    const prBody = prOpen!.body as { head?: string; base?: string };
    expect(
      prBody.head,
      `expected the PR body's "head" field to match the created branch "${branchName}" (AC 6.2 — without this the PR wouldn't reference the user's commit). Got: ${JSON.stringify(prBody.head)}.`,
    ).toBe(branchName);
    expect(
      prBody.base,
      `expected the PR body's "base" field to match the source ref "main" from the request body (AC 6.2 — without this the PR could target a different ref and look empty/confusing). Got: ${JSON.stringify(prBody.base)}.`,
    ).toBe("main");
  });

  it("the PR is opened AFTER the branch is created (call ordering — branch must exist before PR can reference it)", async () => {
    // Defensive ordering pin: GitHub rejects a PR open when head
    // doesn't exist yet. Without this ordering, the PR call would
    // fail upstream and the worker would surface that as a generic
    // error instead of the expected success path.
    await postSave(VALID_BODY, {
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    });

    const branchCreateIdx = captured.findIndex(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/git/refs",
    );
    const prOpenIdx = captured.findIndex(
      (c) => c.method === "POST" && c.path === "/repos/foo/bar/pulls",
    );
    expect(branchCreateIdx, "precondition: branch-create must have happened").toBeGreaterThanOrEqual(0);
    expect(prOpenIdx, "precondition: PR-open must have happened").toBeGreaterThanOrEqual(0);
    expect(
      branchCreateIdx,
      `expected the branch-create call to happen BEFORE the PR-open call (AC 6.2 — without this ordering, the PR open would fail because head doesn't exist yet). Got branchCreateIdx=${branchCreateIdx}, prOpenIdx=${prOpenIdx}.`,
    ).toBeLessThan(prOpenIdx);
  });
});
