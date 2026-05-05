// Issue #92 fix-loop iter-1 — ref encoding (fix #8).
//
// AC for adversarial-reviewer's #8:
//
//   `encodeURIComponent(ref)` breaks nested refs. `feature/x` →
//   `feature%2Fx` → 404 from GitHub (treats encoded slash as
//   literal in the `ref` path segment). Any user editing a spec
//   on a branch with `/` cannot save.
//
//   Fix: split ref by `/`, encodeURIComponent each segment,
//   rejoin. (Or just don't encode the slashes — they're URL-safe
//   in path components anyway.)
//
// Slice-1 validator allows `/` in ref via the segment-loop check;
// the v0.3 worker then collapses the slash via encodeURIComponent
// when building the GitHub URL. This test pins the slash survives
// round-trip into the GitHub call.
//
// Test mechanism:
//   - Mocks pin EXACTLY `/repos/foo/bar/git/ref/heads/feature/x`
//     (literal slash, no `%2F`). If the worker URL-encodes the
//     slash, undici's interceptor won't match → disableNetConnect
//     rejects the fetch → worker returns kind:'other' (per slice 2's
//     cascade fix) → the test sees a non-success response and
//     fails. If the worker preserves the slash, the mock matches,
//     the call succeeds, and the save returns ok:true.
//
// We DO NOT pin slice-1's #9 (cache key delimiter) here. Under
// slice-1's validator (ref charset `^[A-Za-z0-9._/-]+$`, no `:`),
// the cross-component `:` collision attack the team-lead described
// (`path="a", ref="b:c"` colliding with `path="a:b", ref="c"`)
// requires `:` in both `path` AND `ref`. The validator rejects
// any ref with `:`, so the attack is not reachable through the
// input surface. The #9 fix is structural defense-in-depth (a
// future validator regression that loosens ref charset would
// re-expose the collision); the slice-3 commit applies the
// JSON-encoded cache-key fix without an input-side test.

import { exports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { fetchMock } from "./fetch-mock";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "save-encoding-session-32-chars-zz";
const ACCESS_TOKEN = "ghs_encoding_test_token_DO_NOT_LEAK";
const VALID_BASE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOURCE_COMMIT_SHA = "1111222233334444555566667777888899990000";
const PR_HTML_URL = "https://github.com/foo/bar/pull/77";

// The nested ref under test. Verbatim with slash: GitHub Refs
// API accepts `heads/feature/x` (slash unencoded).
const NESTED_REF = "feature/x";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  // GET source ref — STRICT match on unencoded `heads/feature/x`.
  // If the worker encodes the slash to `%2F`, the path becomes
  // `heads/feature%2Fx` which won't match this interceptor and
  // disableNetConnect rejects the fetch.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: `/repos/foo/bar/git/ref/heads/${NESTED_REF}`,
      method: "GET",
    })
    .reply(
      200,
      JSON.stringify({
        ref: `refs/heads/${NESTED_REF}`,
        object: { sha: SOURCE_COMMIT_SHA, type: "commit" },
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();

  // GET file contents on the nested ref. The ref is in a query
  // param; the strict path matcher pins `?ref=feature/x` (slash
  // unencoded). Query-string encoding of `/` is technically
  // optional, but GitHub returns 404 when the ref segment in the
  // PATH is `%2F`-encoded, so the worker should preserve the
  // slash in BOTH places (path-segment AND query-param).
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: `/repos/foo/bar/contents/specs/spec.md?ref=${NESTED_REF}`,
      method: "GET",
    })
    .reply(
      200,
      JSON.stringify({
        sha: VALID_BASE_SHA,
        path: "specs/spec.md",
        content: btoa("original\n"),
        encoding: "base64",
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();

  // POST /git/refs — branch create. The new branch ref includes
  // a Date.now() suffix; the body's `sha` is the source-ref's
  // commit SHA from above. Permissive on body shape.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/git/refs",
      method: "POST",
    })
    .reply(
      201,
      JSON.stringify({
        ref: "refs/heads/hashly/spec-edit-test",
        object: { sha: "new-branch-sha" },
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();

  // PUT contents — commit. Permissive on the query string and
  // body so the test focuses on the ref-encoding pin only.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: /^\/repos\/foo\/bar\/contents\/specs\/spec\.md(\?.*)?$/,
      method: "PUT",
    })
    .reply(
      200,
      JSON.stringify({
        commit: { sha: "commit-sha" },
        content: { sha: "new-file-sha" },
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();

  // POST /pulls — open PR. base=NESTED_REF in the body.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: "/repos/foo/bar/pulls",
      method: "POST",
    })
    .reply(
      201,
      JSON.stringify({
        html_url: PR_HTML_URL,
        number: 77,
        state: "open",
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();
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
}

async function postSave(body: SaveBody): Promise<Response> {
  return (exports as any).default.fetch("https://worker.test/api/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://worker.test",
      Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/save — nested ref encoding (fix #8)", () => {
  it("save with `ref: feature/x` (nested ref) succeeds — slash is NOT URL-encoded in GitHub URLs", async () => {
    // The central pin: a save targeting branch `feature/x` works
    // end-to-end. Under the buggy `encodeURIComponent(ref)` impl,
    // the GET /git/ref URL becomes `.../heads/feature%2Fx` which
    // doesn't match the strict mock above, undici rejects the
    // fetch (disableNetConnect), and slice-2's cascade fix turns
    // that into `kind:'other'`. The test sees `body.ok === false`
    // and fails. Under the fixed impl, the slash is preserved,
    // mock matches, save proceeds, response is `{ok:true, prUrl}`.
    const res = await postSave({
      repo: "foo/bar",
      path: "specs/spec.md",
      ref: NESTED_REF,
      content: "edited\n",
      baseSha: VALID_BASE_SHA,
    });

    let body: { ok?: unknown; kind?: unknown; prUrl?: unknown; message?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch (e) {
      throw new Error(
        `expected JSON response. Got status ${res.status}. JSON parse threw: ${String(e)}`,
      );
    }

    expect(
      body.ok,
      `expected ok:true on save with nested ref "${NESTED_REF}" (fix #8 — slash must NOT be URL-encoded; if encoded, GitHub returns 404 in production and undici disableNetConnect mismatches in tests). Got body: ${JSON.stringify(body)}.`,
    ).toBe(true);
    expect(
      body.prUrl,
      "expected the response to surface the PR URL on the success path.",
    ).toBe(PR_HTML_URL);
  });

  it("the GET /git/ref URL preserves the slash in the ref segment", async () => {
    // Belt: even if a future regression makes the OUTER response
    // ok:true via some other path (e.g., an over-broad fallback),
    // the GET /git/ref URL specifically must hit the strict mock.
    // We capture-then-inspect via undici's interceptor history if
    // available; otherwise assert by passing a fresh nested-ref
    // save and trusting the strict mock matched.
    //
    // The mock setup matches `/repos/foo/bar/git/ref/heads/feature/x`
    // exactly. If the worker hit a different URL, the fetch would
    // have rejected with the disableNetConnect error → ok:false.
    // So this test re-asserts the same outcome from a different
    // angle: ok:true implies the strict mock matched implies the
    // URL preserved the slash.
    const res = await postSave({
      repo: "foo/bar",
      path: "specs/spec.md",
      ref: NESTED_REF,
      content: "another edit\n",
      baseSha: VALID_BASE_SHA,
    });
    const body = (await res.json()) as { ok?: unknown };
    expect(
      body.ok,
      `expected ok:true (the strict GET /git/ref/heads/${NESTED_REF} mock must have matched, which proves the slash was preserved; an encoded URL would have caused the fetch to fail).`,
    ).toBe(true);
  });
});
