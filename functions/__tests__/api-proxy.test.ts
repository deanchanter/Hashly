// AC 3.6 — `POST /api/github/*` proxy.
//
// The proxy is the *only* path through which the browser interacts with the
// GitHub API. It exists for one reason: keep the access token server-side.
// Tests lock down team-lead's three invariants:
//
//   (a) Without a valid session cookie → 401, no outbound fetch.
//   (b) With a valid session, request is forwarded to `https://api.github.com<path>`
//       with the access token in the `Authorization` header server-side.
//   (c) The access token does NOT appear in the response body OR any
//       non-Set-Cookie header returned to the client.
//
// Session is seeded directly into `env.SESSIONS` — these tests don't
// re-exercise the auth flow.

import { exports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { fetchMock } from "./fetch-mock";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
} from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "test-session-id-32chars-aaaaaaaaaaaa";
const ACCESS_TOKEN = "ghs_proxy_test_access_token_NEVER_LEAK_5C8D3";
const FORWARDED_PATH = "/repos/octocat/hello-world/issues";
const PROXY_PATH = `/api/github${FORWARDED_PATH}`;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  // Seed a valid session that maps to a real (fake) access token. Each
  // test starts with this as the only session in KV.
  await env.SESSIONS.put(
    SESSION_ID,
    JSON.stringify({
      access_token: ACCESS_TOKEN,
      installation_id: "42",
      expires_at: "2030-01-01T00:00:00Z",
    }),
  );
});

async function proxy(opts: {
  cookie?: string;
  body?: string;
  contentType?: string;
} = {}): Promise<Response> {
  const headers: Record<string, string> = { Origin: "https://worker.test" };
  if (opts.cookie !== undefined) headers["Cookie"] = opts.cookie;
  if (opts.contentType) headers["content-type"] = opts.contentType;
  return (exports as any).default.fetch(`https://worker.test${PROXY_PATH}`, {
    method: "POST",
    headers,
    body: opts.body,
  });
}

describe("POST /api/github/* — auth gate (AC 3.6 invariant a)", () => {
  it("returns 401 when no cookie is sent", async () => {
    const res = await proxy({});
    expect(res.status).toBe(401);
  });

  it("returns 401 when session cookie value is empty", async () => {
    const res = await proxy({ cookie: `${SESSION_COOKIE_NAME}=` });
    expect(res.status).toBe(401);
  });

  it("returns 401 when session cookie references no KV record", async () => {
    const res = await proxy({
      cookie: `${SESSION_COOKIE_NAME}=this-id-does-not-exist-in-kv`,
    });
    expect(res.status).toBe(401);
  });

  it("does NOT forward to GitHub when the auth gate fails", async () => {
    // No interceptor set for this path. With `disableNetConnect`, any
    // outbound fetch on a 401 path would throw and turn into a 500 — so
    // checking we still see a 401 also confirms no outbound was made.
    const res = await proxy({ cookie: `${SESSION_COOKIE_NAME}=bogus` });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/github/* — forwarding (AC 3.6 invariant b)", () => {
  it("forwards to api.github.com with Authorization: Bearer <token>", async () => {
    // Strict match: if the worker omits or mangles the auth header, this
    // interceptor won't match and `disableNetConnect` will turn the
    // outbound into an error → response is not 201.
    fetchMock
      .get("https://api.github.com")
      .intercept({
        path: FORWARDED_PATH,
        method: "POST",
        headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      })
      .reply(
        201,
        JSON.stringify({ id: 999, title: "issue created" }),
        { headers: { "content-type": "application/json" } },
      );

    const res = await proxy({
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      body: JSON.stringify({ title: "test" }),
      contentType: "application/json",
    });
    expect(res.status).toBe(201);
  });

  it("preserves the path suffix after /api/github/", async () => {
    // Send to `/api/github/repos/octocat/hello-world/issues` and assert the
    // upstream call hits `/repos/octocat/hello-world/issues` (not the
    // worker-side path, not duplicated, not stripped).
    let observedPath: string | undefined;
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: FORWARDED_PATH, method: "POST" })
      .reply((req) => {
        observedPath = req.path;
        return { statusCode: 201, data: JSON.stringify({ ok: true }) };
      });

    const res = await proxy({
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      body: "{}",
      contentType: "application/json",
    });
    expect(res.status).toBe(201);
    expect(observedPath).toBe(FORWARDED_PATH);
  });

  it("forwards the request body to GitHub", async () => {
    let observedBody: string | undefined;
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: FORWARDED_PATH, method: "POST" })
      .reply((req) => {
        observedBody = typeof req.body === "string"
          ? req.body
          : new TextDecoder().decode(req.body as ArrayBuffer);
        return { statusCode: 201, data: "{}" };
      });

    const payload = JSON.stringify({ title: "round-trip-marker-A1B2" });
    await proxy({
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      body: payload,
      contentType: "application/json",
    });
    expect(observedBody).toContain("round-trip-marker-A1B2");
  });

  it("forwards request method (POST) — does not downgrade to GET", async () => {
    let observedMethod: string | undefined;
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: FORWARDED_PATH, method: "POST" })
      .reply((req) => {
        observedMethod = req.method;
        return { statusCode: 201, data: "{}" };
      });

    const res = await proxy({
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      body: "{}",
      contentType: "application/json",
    });
    expect(res.status).toBe(201);
    expect(observedMethod?.toUpperCase()).toBe("POST");
  });
});

describe("POST /api/github/* — token containment (AC 3.6 invariant c, AC 3.10 token-leak)", () => {
  it("response body does NOT contain the access token", async () => {
    // Adversarial: even though GitHub's normal responses don't echo the
    // bearer token, a buggy proxy that re-serializes the outbound request
    // into the response body could leak it. Assert it's absent.
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: FORWARDED_PATH, method: "POST" })
      .reply(
        201,
        JSON.stringify({ id: 1, body: "harmless" }),
        { headers: { "content-type": "application/json" } },
      );

    const res = await proxy({
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      body: "{}",
      contentType: "application/json",
    });
    const body = await res.text();
    expect(body).not.toContain(ACCESS_TOKEN);
  });

  it("response headers (besides Set-Cookie) do NOT contain the access token", async () => {
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: FORWARDED_PATH, method: "POST" })
      .reply(201, "{}", { headers: { "content-type": "application/json" } });

    const res = await proxy({
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      body: "{}",
      contentType: "application/json",
    });
    for (const [name, value] of res.headers.entries()) {
      if (name.toLowerCase() === "set-cookie") continue;
      expect(
        value.includes(ACCESS_TOKEN),
        `Header ${name} leaked access token: ${value}`,
      ).toBe(false);
    }
  });

  it("does NOT forward the inbound Cookie header to GitHub", async () => {
    // Defense: the user's session cookie is meaningless to GitHub but
    // still represents a session-binding artefact. Don't pass it through.
    let observedCookie: string | undefined;
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: FORWARDED_PATH, method: "POST" })
      .reply((req) => {
        const headers = req.headers as Record<string, string | string[]>;
        const cookie = headers["cookie"] ?? headers["Cookie"];
        observedCookie = Array.isArray(cookie) ? cookie.join(";") : cookie;
        return { statusCode: 201, data: "{}" };
      });

    await proxy({
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      body: "{}",
      contentType: "application/json",
    });
    if (observedCookie !== undefined) {
      expect(observedCookie).not.toContain(SESSION_ID);
      expect(observedCookie).not.toContain(SESSION_COOKIE_NAME);
    }
  });
});
