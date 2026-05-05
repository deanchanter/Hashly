// Issue #92 fix-loop iter-1 — failure-path hardening (fixes #1, #3,
// #4, #10).
//
// AC for adversarial-reviewer's bundle:
//
//   #1 (PUT /contents must include `sha`) — GitHub's contents
//      API REQUIRES `sha:<file's current SHA on the target ref>`
//      when updating an existing file. Without it the API returns
//      422; the v0.3 mocked tests don't catch this because the
//      mocks accept anything. End-to-end against real GitHub the
//      save flow is broken.
//
//   #3 (cascade on non-success GitHub responses) — the v0.3
//      worker only checks `status === 403`; every other failure
//      cascades to a malformed `{ok:true, prUrl:""}` "success".
//      Frontend then renders the success banner with an empty
//      href, and clicking it destroys unsaved edits. **Silent
//      data loss disguised as success.** Every step (GET ref,
//      POST /git/refs, PUT /contents, POST /pulls) must check
//      `response.ok` AND that the parsed body actually carries
//      the expected field.
//
//   #4 (fail-closed on stale-SHA fetch error) — the AC 6.4
//      graceful-fallback comment said "no worse than today"
//      which is misleading: post-AC-6.4 the user TRUSTS the
//      system to detect upstream conflicts. A network blip or
//      404 silently disabling the check overwrites changes the
//      user never saw. Any GET /contents failure (non-200,
//      throw, missing sha field) must abort with a structured
//      `kind:'other'` error.
//
//   #10 (422 on POST /git/refs) — branch already exists (Date.now()
//      collision, attacker squat, re-save edge case). v0.3 worker
//      only checks 403, so 422 falls through and the worker
//      writes to the squatted branch. Either retry with a new
//      branch name OR return error; do NOT silently proceed.
//
// We pin OUTCOMES (response shapes + write-side captures), not
// the impl's choice between retry and error for #10. Each
// failure mode must surface as `{ok:false, kind:'other', message}`
// (or, for known-conflict statuses, `kind:'conflict'`) — never as
// `{ok:true, prUrl:""}` or any other malformed-success shape.

import { SELF, env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "save-failure-session-32-chars-yyyy";
const ACCESS_TOKEN = "ghs_failure_test_token_DO_NOT_LEAK_8c";
const VALID_BASE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOURCE_COMMIT_SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const FILE_SHA_ON_BRANCH = "cccccccccccccccccccccccccccccccccccccccc";
const PR_HTML_URL = "https://github.com/foo/bar/pull/55";

interface CapturedCall {
  path: string;
  method: string;
  body?: unknown;
}

const captured: CapturedCall[] = [];

// `mockState` lets each test inject failure points without
// re-registering interceptors. The .reply callbacks below close
// over `mockState` and read response shapes at request time.
type MockResponse =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; body: unknown };

interface MockState {
  contents: MockResponse; // GET /repos/.../contents/{path}?ref={ref}
  ref: MockResponse;      // GET /repos/.../git/ref/heads/{ref}
  branchCreate: MockResponse; // POST /repos/.../git/refs
  put: MockResponse;      // PUT /repos/.../contents/{path}
  pulls: MockResponse;    // POST /repos/.../pulls
}

const mockState: MockState = {
  contents: {
    ok: true,
    status: 200,
    body: {
      sha: VALID_BASE_SHA,
      path: "specs/spec.md",
      content: btoa("original\n"),
      encoding: "base64",
    },
  },
  ref: {
    ok: true,
    status: 200,
    body: {
      ref: "refs/heads/main",
      object: { sha: SOURCE_COMMIT_SHA, type: "commit" },
    },
  },
  branchCreate: {
    ok: true,
    status: 201,
    body: {
      ref: "refs/heads/hashly/spec-edit-test",
      object: { sha: SOURCE_COMMIT_SHA },
    },
  },
  put: {
    ok: true,
    status: 200,
    body: {
      commit: { sha: "commit-after-put" },
      content: { sha: FILE_SHA_ON_BRANCH },
    },
  },
  pulls: {
    ok: true,
    status: 201,
    body: {
      html_url: PR_HTML_URL,
      number: 55,
      state: "open",
    },
  },
};

const DEFAULT_MOCK_STATE: MockState = JSON.parse(JSON.stringify(mockState));

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

function dataFor(body: unknown): string {
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  // GET source ref. Permissive on the ref segment so nested-ref
  // tests (e.g., feature/x) also match.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/git\/ref\/heads\/.*$/,
      method: "GET",
    })
    .reply(() => ({
      statusCode: mockState.ref.status,
      data: dataFor(mockState.ref.body),
      responseOptions: { headers: { "content-type": "application/json" } },
    }))
    .persist();

  // GET file contents. Permissive on the ref query param so the
  // dedup test can return a different SHA when the worker queries
  // the branch ref vs the source ref.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/contents\/specs\/spec\.md(\?.*)?$/,
      method: "GET",
    })
    .reply((req) => {
      captured.push({ path: req.path, method: req.method });
      return {
        statusCode: mockState.contents.status,
        data: dataFor(mockState.contents.body),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();

  // POST /git/refs.
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
        statusCode: mockState.branchCreate.status,
        data: dataFor(mockState.branchCreate.body),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();

  // PUT /contents.
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
        statusCode: mockState.put.status,
        data: dataFor(mockState.put.body),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();

  // POST /pulls.
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
        statusCode: mockState.pulls.status,
        data: dataFor(mockState.pulls.body),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();
});

beforeEach(async () => {
  captured.length = 0;
  // Reset mockState in place (closures captured the object reference).
  mockState.contents = JSON.parse(JSON.stringify(DEFAULT_MOCK_STATE.contents));
  mockState.ref = JSON.parse(JSON.stringify(DEFAULT_MOCK_STATE.ref));
  mockState.branchCreate = JSON.parse(JSON.stringify(DEFAULT_MOCK_STATE.branchCreate));
  mockState.put = JSON.parse(JSON.stringify(DEFAULT_MOCK_STATE.put));
  mockState.pulls = JSON.parse(JSON.stringify(DEFAULT_MOCK_STATE.pulls));

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
  baseSha: VALID_BASE_SHA,
};

async function expectStructuredError(
  res: Response,
  expectedKind: "other" | "conflict",
  ctx: string,
): Promise<{ ok: false; kind: string; message: string; prUrl?: string }> {
  let body: { ok?: unknown; kind?: unknown; message?: unknown; prUrl?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch (e) {
    throw new Error(
      `${ctx}: expected JSON-parseable body. Got status ${res.status}. JSON parse threw: ${String(e)}`,
    );
  }
  expect(
    body.ok,
    `${ctx}: expected ok:false. Got body: ${JSON.stringify(body)}`,
  ).toBe(false);
  expect(
    body.kind,
    `${ctx}: expected kind:'${expectedKind}'. Got body: ${JSON.stringify(body)}`,
  ).toBe(expectedKind);
  expect(typeof body.message, `${ctx}: message must be a string`).toBe("string");
  // Critical guard against malformed success: ensure prUrl is not
  // present (or is empty/falsy) on an error response. The exact
  // shape of an error response is `{ok:false, kind, message}` — no
  // prUrl field.
  if ("prUrl" in body) {
    expect(
      body.prUrl,
      `${ctx}: prUrl must NOT be a non-empty string on an error response. Got body: ${JSON.stringify(body)}`,
    ).not.toBeTruthy();
  }
  return body as { ok: false; kind: string; message: string; prUrl?: string };
}

// ---------------------------------------------------------------------------
// Fix #4 — fail-closed on stale-SHA fetch error
// ---------------------------------------------------------------------------

describe("POST /api/save — fix #4: fail-closed on stale-SHA fetch error", () => {
  it("when GET /contents returns 5xx, the worker returns kind:'other' (does NOT silently proceed)", async () => {
    // The central #4 attack vector: a transient GitHub blip
    // silently disables the AC 6.4 stale-SHA check. Worker
    // proceeds to write, overwriting upstream changes the user
    // never saw. AC 6.4 was meant to PREVENT this; the
    // graceful-fallback was a regression.
    mockState.contents = {
      ok: false,
      status: 500,
      body: { message: "Internal Server Error" },
    };
    const res = await postSave(VALID_BODY);
    await expectStructuredError(
      res,
      "other",
      "GET /contents 500 must fail-closed",
    );
  });

  it("when GET /contents returns 5xx, no writes happen (no branch, no commit, no PR)", async () => {
    // Belt: the kind:'other' response must come WITHOUT triggering
    // any GitHub write. Otherwise a regression that returns the
    // structured error AFTER doing the writes would still pass the
    // shape pin but pollute the repo with dead branches / PRs.
    mockState.contents = { ok: false, status: 500, body: { message: "err" } };
    await postSave(VALID_BODY);

    const writes = captured.filter(
      (c) =>
        (c.method === "POST" && c.path === "/repos/foo/bar/git/refs") ||
        (c.method === "POST" && c.path === "/repos/foo/bar/pulls") ||
        (c.method === "PUT" && c.path.startsWith("/repos/foo/bar/contents/")),
    );
    expect(
      writes.length,
      `expected ZERO write-side calls (no branch / commit / PR) when the stale-SHA fetch failed (#4 fail-closed; without this, transient errors silently overwrite upstream changes). Got ${writes.length} write call(s).`,
    ).toBe(0);
  });

  it("when GET /contents returns 404, the worker returns kind:'other'", async () => {
    // 404 isn't transient (the file genuinely doesn't exist on
    // the source ref). Either way, fail-closed: don't try to
    // create a new file via PUT silently — that's a different
    // code path the user didn't ask for.
    mockState.contents = { ok: false, status: 404, body: { message: "Not Found" } };
    const res = await postSave(VALID_BODY);
    await expectStructuredError(res, "other", "GET /contents 404 must fail-closed");
  });

  it("when GET /contents body is missing the `sha` field (malformed response), the worker returns kind:'other'", async () => {
    // Defense against a future API change or a proxy injecting
    // junk: if we can't get a SHA we can compare, fail-closed.
    mockState.contents = {
      ok: true,
      status: 200,
      body: { path: "specs/spec.md", content: btoa("..."), encoding: "base64" },
    };
    const res = await postSave(VALID_BODY);
    await expectStructuredError(
      res,
      "other",
      "GET /contents missing `sha` field must fail-closed",
    );
  });
});

// ---------------------------------------------------------------------------
// Fix #3 — cascade on non-success GitHub responses
// ---------------------------------------------------------------------------

describe("POST /api/save — fix #3: cascade on non-success GitHub responses", () => {
  it("GET ref 5xx → kind:'other', NOT {ok:true, prUrl:''}", async () => {
    mockState.ref = { ok: false, status: 500, body: { message: "err" } };
    const res = await postSave(VALID_BODY);
    await expectStructuredError(res, "other", "GET ref 5xx must cascade");
  });

  it("POST /git/refs 5xx → kind:'other'", async () => {
    mockState.branchCreate = { ok: false, status: 500, body: { message: "err" } };
    const res = await postSave(VALID_BODY);
    await expectStructuredError(res, "other", "POST /git/refs 5xx must cascade");
  });

  it("PUT /contents 5xx → kind:'other'", async () => {
    mockState.put = { ok: false, status: 500, body: { message: "err" } };
    const res = await postSave(VALID_BODY);
    await expectStructuredError(res, "other", "PUT /contents 5xx must cascade");
  });

  it("POST /pulls 5xx → kind:'other'", async () => {
    mockState.pulls = { ok: false, status: 500, body: { message: "err" } };
    const res = await postSave(VALID_BODY);
    await expectStructuredError(res, "other", "POST /pulls 5xx must cascade");
  });

  it("POST /pulls returns 200 with NO html_url field → kind:'other' (NOT ok:true with empty prUrl)", async () => {
    // The most insidious cascade: the upstream responded 200 but
    // without the html_url we expected. Returning `{ok:true,
    // prUrl:""}` here would cascade an empty-href link to the
    // frontend success banner — clicking it destroys unsaved
    // edits. THE silent data loss vector.
    mockState.pulls = {
      ok: true,
      status: 201,
      body: { number: 55, state: "open" }, // no html_url
    };
    const res = await postSave(VALID_BODY);
    await expectStructuredError(
      res,
      "other",
      "POST /pulls missing html_url must NOT cascade to ok:true with empty prUrl",
    );
  });

  it("POST /pulls returns malformed JSON → kind:'other'", async () => {
    mockState.pulls = {
      ok: true,
      status: 201,
      body: "this is not json",
    };
    const res = await postSave(VALID_BODY);
    await expectStructuredError(res, "other", "POST /pulls malformed JSON must cascade");
  });
});

// ---------------------------------------------------------------------------
// Fix #10 — 422 on POST /git/refs (branch already exists)
// ---------------------------------------------------------------------------

describe("POST /api/save — fix #10: 422 on branch create (squat / collision)", () => {
  it("when POST /git/refs returns 422 (persistent), the worker does NOT silently succeed", async () => {
    // The central #10 attack vector: GitHub returns 422 when
    // the branch ref already exists (Date.now() collision /
    // attacker squat / dedup edge case). The v0.3 worker only
    // checks 403, so 422 falls through to the next step which
    // PUTs contents on the squatted branch — possibly under
    // attacker control.
    //
    // The fix per the team-lead's #10 brief is option (b): retry
    // with a fresh branch name. The simpler option (c) "return
    // kind:'other'" is also acceptable. We pin OUTCOME — no
    // silent success — and let the impl pick.
    //
    // Under PERSISTENT 422 (every branch-create attempt fails):
    //   - Retry impl: would loop, eventually give up, return
    //     kind:'other'.
    //   - Error impl: returns kind:'other' immediately.
    //   - BAD impl (ignores 422): silently PUTs on the squatted
    //     branch and opens a PR → ok:true (the regression).
    // Pinning "ok must be false" rejects only the BAD impl.
    mockState.branchCreate = {
      ok: false,
      status: 422,
      body: { message: "Reference already exists" },
    };

    const res = await postSave(VALID_BODY);

    let body: { ok?: unknown; prUrl?: unknown; kind?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch (e) {
      throw new Error(
        `expected JSON response on the 422-path. Got status ${res.status}. JSON parse threw: ${String(e)}`,
      );
    }

    expect(
      body.ok,
      `expected ok:false on persistent 422 (#10 — without this pin, an impl that ignores 422 silently writes to the squatted branch and surfaces a fake-successful PR. Got: ${JSON.stringify(body)}.`,
    ).toBe(false);
    expect(
      body.kind,
      `expected kind:'other' or 'conflict' on the 422 error path. Got: ${JSON.stringify(body)}.`,
    ).toMatch(/^(other|conflict)$/);
  });

  it("when POST /git/refs returns 422, no writes happen on the squatted branch (no PUT, no PR-open)", async () => {
    // Belt — even if a future regression turns the response into
    // a different shape, we must NOT have written to the squatted
    // branch. (A retry impl that picks a NEW branch name and
    // succeeds against this PERSISTENT 422 mock isn't possible —
    // every branch-create attempt 422s — so the only correct
    // outcome here is no writes.)
    mockState.branchCreate = {
      ok: false,
      status: 422,
      body: { message: "Reference already exists" },
    };

    await postSave(VALID_BODY);

    const writes = captured.filter(
      (c) =>
        (c.method === "POST" && c.path === "/repos/foo/bar/pulls") ||
        (c.method === "PUT" && c.path.startsWith("/repos/foo/bar/contents/")),
    );
    expect(
      writes.length,
      `expected ZERO write-side calls (no PUT, no PR-open) when branch-create returned 422 persistently (#10 — without this, an impl that ignored 422 would PUT on the attacker-squatted branch and open a PR for it). Got ${writes.length}.`,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fix #1 — PUT /contents must include `sha`
// ---------------------------------------------------------------------------

describe("POST /api/save — fix #1: PUT /contents must include `sha`", () => {
  it("first save: PUT body includes a `sha` field that matches the GET /contents response's `sha`", async () => {
    // Without sha, GitHub returns 422 for any update of an
    // existing file. The mocks don't enforce this, so the v0.3
    // tests have green CI but production save is broken end-to-
    // end. Pin: the PUT body must include sha equal to whatever
    // GET /contents returned (the "current SHA on the source
    // ref", which is also the file's SHA on the freshly-created
    // branch since the branch is at the same commit).
    //
    // The mock setup returns `sha: VALID_BASE_SHA` from GET
    // /contents (matching the request's baseSha). The PUT body's
    // `sha` field must equal VALID_BASE_SHA.
    await postSave(VALID_BODY);

    const puts = captured.filter(
      (c) =>
        c.method === "PUT" &&
        c.path.startsWith("/repos/foo/bar/contents/specs/spec.md"),
    );
    expect(
      puts.length,
      "precondition: a PUT must have happened on the happy path (cross-pin AC 6.2).",
    ).toBe(1);

    const putBody = puts[0]!.body as { sha?: unknown };
    expect(
      typeof putBody.sha,
      `expected the PUT body to include a string "sha" field (#1 — GitHub requires it for updates; without it real GitHub returns 422). Got body: ${JSON.stringify(puts[0]!.body)}.`,
    ).toBe("string");
    expect(
      String(putBody.sha),
      `expected the PUT body's "sha" to equal the SHA returned by GET /contents (the file's current SHA on the target ref). Expected: ${JSON.stringify(VALID_BASE_SHA)}. Got: ${JSON.stringify(putBody.sha)}.`,
    ).toBe(VALID_BASE_SHA);
  });
});
