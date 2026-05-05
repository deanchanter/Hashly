// Issue #91 / AC 5.5 — relax the `/api/github/*` proxy to accept GET
// in addition to POST.
//
// AC 5.5 needs the frontend to call `GET /api/github/repos/{owner}/{repo}`
// to inspect `permissions.push` before unlocking edit mode. The
// existing route guard hardcodes POST; AC 5.5 broadens it. The
// internal proxy already forwards `request.method` correctly, so the
// only change is the route-side method check.
//
// These tests pin the GET behavior explicitly. The POST behavior
// stays pinned by the existing `worker/test/api-proxy.test.ts`.
//
// We deliberately don't mock GitHub here — the proxy's "forward to
// upstream" path is exercised end-to-end in `api-proxy.test.ts`. AC
// 5.5's worker contract is just "GET reaches the proxy"; the actual
// permissions resolution is the frontend's job.

import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "perms-test-session-id-32chars-eeee";
const ACCESS_TOKEN = "ghs_perms_test_token_DO_NOT_LEAK_4F2A";

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

async function getRepo(opts: { cookie?: string } = {}): Promise<Response> {
  const headers: HeadersInit = {};
  if (opts.cookie !== undefined) headers["Cookie"] = opts.cookie;
  return SELF.fetch("https://worker.test/api/github/repos/octocat/hello-world", {
    method: "GET",
    headers,
  });
}

describe("GET /api/github/* — auth gate (Issue #91 / AC 5.5)", () => {
  it("returns 401 when no cookie is sent (carries over the AC 3.6 auth gate)", async () => {
    const res = await getRepo({});
    expect(
      res.status,
      "expected 401 on GET without a session cookie (AC 5.5 — relaxing the method to accept GET must NOT relax the auth gate; without this, anonymous users could read repo data through the proxy).",
    ).toBe(401);
  });

  it("returns 401 when session cookie value is empty", async () => {
    const res = await getRepo({ cookie: `${SESSION_COOKIE_NAME}=` });
    expect(res.status).toBe(401);
  });

  it("returns 401 when session cookie references no KV record", async () => {
    const res = await getRepo({
      cookie: `${SESSION_COOKIE_NAME}=this-id-does-not-exist`,
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/github/* — route guard accepts GET (Issue #91 / AC 5.5)", () => {
  it("with a valid session, GET /api/github/repos/{owner}/{repo} reaches the proxy (does NOT 404)", async () => {
    // The minimum pin: GET requests against /api/github/* paths
    // must NOT fall through to the catch-all 404 handler. That's
    // what would happen if the route guard kept hardcoding POST.
    // We don't pin the upstream-forward outcome (the existing POST
    // suite already covers that for the proxy internals); only that
    // GET is reachable.
    const res = await getRepo({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    expect(
      res.status,
      `expected GET /api/github/repos/{owner}/{repo} to NOT return 404 with a valid session — that would mean the route guard is still POST-only and AC 5.5's perms-check path is unreachable. Got ${res.status}.`,
    ).not.toBe(404);
  });

  it("token never leaks in the GET response body even when proxy forwarding fails (defense in depth)", async () => {
    // The upstream call to api.github.com isn't mocked here so
    // it'll fail (workerd's `fetchMock.disableNetConnect` is
    // either inactive or, if active in beforeAll elsewhere, it
    // produces an error response). Either way, the access token
    // must not appear in whatever response the proxy returns.
    const res = await getRepo({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    const body = await res.text();
    expect(body).not.toContain(ACCESS_TOKEN);
  });
});
