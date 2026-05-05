// AC 3.7 — `POST /auth/logout` invalidates the session.
//
// "Invalidates the session" means BOTH:
//   - the browser-side cookie is cleared (Set-Cookie with Max-Age=0), AND
//   - the server-side KV record is deleted.
//
// Either alone is insufficient: a cleared cookie alone leaves a live KV
// record vulnerable to cookie replay; deleting only the KV record without
// clearing the cookie leaves the user's browser sending a now-invalid
// cookie indefinitely.

import { exports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import {
  findSetCookie,
  parseCookieAttributes,
} from "./test-helpers";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "logout-test-session-id-32chars-bbbb";
const ACCESS_TOKEN = "ghs_logout_test_token_DO_NOT_LEAK_8E3F1";

beforeEach(async () => {
  // Seed a live session record. Each test starts with this in KV.
  await env.SESSIONS.put(
    SESSION_ID,
    JSON.stringify({
      access_token: ACCESS_TOKEN,
      installation_id: "42",
      expires_at: "2030-01-01T00:00:00Z",
    }),
  );
});

async function logout(opts: { cookie?: string; method?: string } = {}): Promise<Response> {
  const headers: HeadersInit = {};
  if (opts.cookie !== undefined) headers["Cookie"] = opts.cookie;
  return (exports as any).default.fetch("https://worker.test/auth/logout", {
    method: opts.method ?? "POST",
    headers,
    redirect: "manual",
  });
}

describe("POST /auth/logout — happy path (AC 3.7)", () => {
  it("returns a successful status (200 / 204 / 302)", async () => {
    const res = await logout({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    expect([200, 204, 302]).toContain(res.status);
  });

  it("clears the session cookie via Set-Cookie + Max-Age=0", async () => {
    const res = await logout({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    const cleared = findSetCookie(res, SESSION_COOKIE_NAME);
    expect(
      cleared,
      `Set-Cookie ${SESSION_COOKIE_NAME} must be present on logout to clear it`,
    ).toBeDefined();

    const attrs = parseCookieAttributes(cleared!);
    const isCleared =
      Number(attrs["max-age"]) === 0 ||
      (typeof attrs["expires"] === "string" && attrs["expires"].length > 0);
    expect(isCleared, `cookie not cleared: ${cleared}`).toBe(true);
  });

  it("clearing cookie carries the same security attrs as a live session cookie", async () => {
    // Browsers will only overwrite a cookie if the new Set-Cookie matches
    // the original on Path + Domain + Secure. Mismatched attrs = the old
    // cookie sticks around.
    const res = await logout({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });
    const cleared = findSetCookie(res, SESSION_COOKIE_NAME);
    const attrs = parseCookieAttributes(cleared!);
    expect("httponly" in attrs).toBe(true);
    expect("secure" in attrs).toBe(true);
    expect(attrs["samesite"]?.toLowerCase()).toBe("lax");
  });

  it("deletes the session record from env.SESSIONS", async () => {
    // Pre-condition sanity: the seed exists.
    const before = await env.SESSIONS.get(SESSION_ID);
    expect(before).not.toBeNull();

    await logout({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });

    const after = await env.SESSIONS.get(SESSION_ID);
    expect(after).toBeNull();
  });

  it("the now-invalidated cookie no longer authenticates /api/github/*", async () => {
    // End-to-end: log out, then try to use the same session cookie. The
    // proxy must reject with 401 — proves invalidation is real, not just
    // cosmetic cookie-clearing.
    await logout({ cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` });

    const proxyRes = await (exports as any).default.fetch(
      "https://worker.test/api/github/repos/octocat/hello/issues",
      {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
        body: "{}",
      },
    );
    expect(proxyRes.status).toBe(401);
  });
});

describe("POST /auth/logout — idempotency (AC 3.7)", () => {
  it("succeeds even when called without any cookie", async () => {
    // Logout should never error out — it's a "make sure I'm signed out"
    // operation that shouldn't depend on the user actually being signed in.
    const res = await logout({});
    expect([200, 204, 302]).toContain(res.status);
  });

  it("succeeds with a cookie that doesn't match any KV record", async () => {
    const res = await logout({
      cookie: `${SESSION_COOKIE_NAME}=this-id-was-never-real`,
    });
    expect([200, 204, 302]).toContain(res.status);
  });

  it("succeeds with an empty session cookie value", async () => {
    const res = await logout({ cookie: `${SESSION_COOKIE_NAME}=` });
    expect([200, 204, 302]).toContain(res.status);
  });
});

describe("POST /auth/logout — method discipline (AC 3.7)", () => {
  it("GET /auth/logout does NOT clear the session", async () => {
    // CSRF-shaped concern: a GET-triggerable logout could be invoked via
    // image src or link, logging users out involuntarily. Logout MUST be
    // POST-only.
    const res = await logout({
      cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      method: "GET",
    });
    // Either 404 or 405 is acceptable — both unambiguously reject.
    expect([404, 405]).toContain(res.status);

    // KV record must still be present.
    const stillThere = await env.SESSIONS.get(SESSION_ID);
    expect(stillThere).not.toBeNull();
  });
});
