// Issue #91 / AC 5.2 — `GET /api/session-status` is the worker endpoint
// the frontend hits before flipping into edit mode. Cookie is HttpOnly
// so JS can't read it directly; the frontend asks the worker
// "do I have a live session?" and branches on the response status:
//
//   200 → user has a session → enter edit mode (AC 5.2 GREEN path)
//   401 → user has no session → redirect to /auth/start with the
//         current URL as the post-auth return target (AC 5.2 RED path)
//
// AC 5.4 (avatar in header) will enrich the 200 response body with
// the user's `login` + `avatar_url`. For now AC 5.2 only pins:
//   - 200 vs 401 distinction
//   - JSON body (so AC 5.4 can extend without re-shaping)
//   - the access token never appears in any response
//   - method discipline (GET; POST should not bypass)
//
// Session is seeded directly into env.SESSIONS — these tests don't
// re-exercise the auth flow.

import { exports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "session-status-test-id-32chars-cccc";
const ACCESS_TOKEN = "ghs_status_test_token_DO_NOT_LEAK_2D9C7";

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

async function statusCheck(opts: { cookie?: string; method?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { Origin: "https://worker.test" };
  if (opts.cookie !== undefined) headers["Cookie"] = opts.cookie;
  return (exports as any).default.fetch("https://worker.test/api/session-status", {
    method: opts.method ?? "GET",
    headers,
  });
}

describe("GET /api/session-status — auth gate (Issue #91 / AC 5.2)", () => {
  it("returns 401 when no cookie is sent", async () => {
    const res = await statusCheck({});
    expect(res.status).toBe(401);
  });

  it("returns 401 when session cookie value is empty", async () => {
    const res = await statusCheck({ cookie: `${SESSION_COOKIE_NAME}=` });
    expect(res.status).toBe(401);
  });

  it("returns 401 when session cookie references no KV record", async () => {
    const res = await statusCheck({
      cookie: `${SESSION_COOKIE_NAME}=this-id-does-not-exist-in-kv`,
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/session-status — happy path (Issue #91 / AC 5.2)", () => {
  it("returns 200 when a valid session cookie is present", async () => {
    const res = await statusCheck({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    expect(
      res.status,
      "expected 200 when the session cookie maps to a live KV record (AC 5.2 — frontend uses 200 vs 401 to branch JIT auth).",
    ).toBe(200);
  });

  it("response body is JSON parseable (forward-compat for AC 5.4 user info enrichment)", async () => {
    // AC 5.4 will add `{user: {login, avatar_url}}` to the 200
    // response body for the avatar-in-header indicator. Pinning JSON
    // shape here forbids a future contributor from shipping a plain
    // "ok" string body that would break AC 5.4's parse path.
    const res = await statusCheck({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    const text = await res.text();
    expect(
      () => JSON.parse(text),
      `expected the 200 response body to be JSON (AC 5.2 forward-compat for AC 5.4 user info). Got: ${JSON.stringify(text)}`,
    ).not.toThrow();
  });

  it("response body does NOT contain the access token (AC 3.10 token-leak invariant)", async () => {
    // The bedrock invariant carried into the new endpoint: an
    // accidentally-echoed token in the status response would defeat
    // the whole opaque-cookie design.
    const res = await statusCheck({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    const body = await res.text();
    expect(body).not.toContain(ACCESS_TOKEN);
  });

  it("response headers (besides Set-Cookie) do NOT contain the access token", async () => {
    const res = await statusCheck({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    for (const [name, value] of res.headers.entries()) {
      if (name.toLowerCase() === "set-cookie") continue;
      expect(
        value.includes(ACCESS_TOKEN),
        `Header ${name} leaked access token: ${value}`,
      ).toBe(false);
    }
  });
});

describe("GET /api/session-status — user info enrichment (Issue #91 / AC 5.4)", () => {
  // AC 5.4 enriches the 200 body with `{user: {login, avatar_url}}` so the
  // frontend can render the signed-in user's GitHub avatar in the persistent
  // header. The 401 path is unchanged. This describe block re-seeds the
  // session with user info; the outer beforeEach already seeded a record
  // without user info, and the inner re-seed replaces that for these tests.
  const TEST_LOGIN = "octocat";
  const TEST_AVATAR_URL = "https://avatars.githubusercontent.com/u/583231?v=4";

  beforeEach(async () => {
    await env.SESSIONS.put(
      SESSION_ID,
      JSON.stringify({
        access_token: ACCESS_TOKEN,
        installation_id: "42",
        expires_at: "2030-01-01T00:00:00Z",
        user: {
          login: TEST_LOGIN,
          avatar_url: TEST_AVATAR_URL,
        },
      }),
    );
  });

  it("200 response body contains `user.login` from the KV record", async () => {
    const res = await statusCheck({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user?: { login?: unknown } };
    expect(
      body.user?.login,
      `expected the 200 response body to include user.login (AC 5.4 — frontend renders the signed-in user's identifier in the header). Got body: ${JSON.stringify(body)}`,
    ).toBe(TEST_LOGIN);
  });

  it("200 response body contains `user.avatar_url` from the KV record", async () => {
    const res = await statusCheck({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user?: { avatar_url?: unknown } };
    expect(
      body.user?.avatar_url,
      `expected the 200 response body to include user.avatar_url (AC 5.4 — frontend renders the user's GitHub avatar from this URL). Got body: ${JSON.stringify(body)}`,
    ).toBe(TEST_AVATAR_URL);
  });

  it("401 path stays unchanged (no user info leak via 401 response)", async () => {
    // Defensive symmetry: the user info is exclusively a property of
    // the authenticated 200 path. A 401 response must NOT include any
    // user info regardless of what's in KV (the cookie isn't valid;
    // there's no authenticated user to identify).
    const res = await statusCheck({ cookie: `${SESSION_COOKIE_NAME}=bogus-id` });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(
      body.includes(TEST_LOGIN),
      `expected the 401 response body to NOT contain the user login (AC 5.4 + AC 3.10 — no user info leak on the unauthenticated path). Got: ${JSON.stringify(body)}`,
    ).toBe(false);
  });

  it("access token still does NOT leak in the user-info-enriched response", async () => {
    // AC 3.10 carry-over: enriching with user info must NOT relax the
    // token-leak invariant. The body now has more fields; the token
    // still must not appear among them.
    const res = await statusCheck({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    const body = await res.text();
    expect(body).not.toContain(ACCESS_TOKEN);
  });
});

describe("GET /api/session-status — method discipline", () => {
  it("POST /api/session-status does NOT proxy as if it were /api/github/* (must not 401-bypass)", async () => {
    // The existing GitHub-proxy route is `POST /api/github/*` and
    // returns 401 without a session. A naïve route handler that
    // collapses both prefixes ("starts with /api/") could
    // accidentally route POST /api/session-status through the proxy
    // path. Pin that GET is the only method that hits the status
    // endpoint; any other method is rejected (404 or 405).
    const res = await statusCheck({
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      method: "POST",
    });
    expect(
      [404, 405].includes(res.status),
      `expected POST /api/session-status to return 404 or 405; the status endpoint is GET-only and must not be reachable through the github proxy. Got status ${res.status}.`,
    ).toBe(true);
  });
});
