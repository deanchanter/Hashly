// AC 3.4 — `GET /auth/start` redirects to GitHub's authorize URL with a CSRF
// state parameter, AND stores that state in a short-lived secure cookie so
// `/auth/callback` can verify it later.
//
// This test file covers the **default** `AUTH_METHOD=app` branch. The
// `oauth-app` branch is exercised in `auth-method-flag.test.ts` (AC 3.8).
//
// Cookie-attribute correctness (AC 3.10 first bullet) is co-tested here for
// the state cookie and also separately for the session cookie in the
// `/auth/callback` slice — those are two distinct cookies with the same
// security posture.
import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import {
  findSetCookie,
  parseCookieAttributes,
  parseCookieNameValue,
} from "./test-helpers";

const STATE_COOKIE_NAME = "hashly_oauth_state";

async function startAuth(): Promise<Response> {
  // `redirect: "manual"` ensures we observe the 302 itself rather than the
  // pool transparently following it to github.com (which would also fail in
  // an offline test sandbox).
  return (exports as any).default.fetch("https://worker.test/auth/start", {
    redirect: "manual",
    headers: { Origin: "https://worker.test" },
  });
}

describe("GET /auth/start (AUTH_METHOD=app, the default)", () => {
  it("returns a 302 redirect", async () => {
    const res = await startAuth();
    expect(res.status).toBe(302);
  });

  it("Location points to GitHub's OAuth authorize endpoint (issue #155 — fixes #153)", async () => {
    const res = await startAuth();
    const loc = res.headers.get("Location") ?? "";
    // Issue #155 / #153 — `app` mode no longer sends the user to
    // /apps/<slug>/installations/new (which requires admin perms and
    // lands the user in a config screen). Instead we use GitHub's
    // standard user-to-server OAuth handshake at
    // /login/oauth/authorize. The App identifies itself with its
    // OAuth-style client_id (env.GITHUB_APP_CLIENT_ID — distinct from
    // GITHUB_APP_ID and from the legacy OAuth-app client id).
    const url = new URL(loc);
    expect(url.host).toBe("github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
  });

  it("Location includes a non-empty client_id from env.GITHUB_APP_CLIENT_ID (AC 1.2)", async () => {
    const res = await startAuth();
    const url = new URL(res.headers.get("Location") ?? "");
    const clientId = url.searchParams.get("client_id");
    expect(clientId).not.toBeNull();
    expect(clientId!.length).toBeGreaterThan(0);
    // vitest config injects "test-github-app-client-id" for AUTH_METHOD=app.
    expect(clientId).toBe("test-github-app-client-id");
    // Defense: must not accidentally use the OAuth-App client id
    // (those env vars are different secrets and live in different
    // GitHub registrations).
    expect(clientId).not.toBe("test-oauth-client-id");
  });

  it("Location includes a `state` query parameter", async () => {
    const res = await startAuth();
    const url = new URL(res.headers.get("Location") ?? "");
    const state = url.searchParams.get("state");
    expect(state).not.toBeNull();
    // 32 chars is the minimum we'll accept — equivalent to 16 bytes hex,
    // 24 bytes base64url, or a dash-stripped UUIDv4. Anything shorter is
    // not enough entropy for a CSRF token.
    expect(state!.length).toBeGreaterThanOrEqual(32);
    // URL-safe alphabet — no `=` padding, no `/`, `+`.
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("sets a state cookie whose value matches the URL state (CSRF binding)", async () => {
    const res = await startAuth();
    const url = new URL(res.headers.get("Location") ?? "");
    const expectedState = url.searchParams.get("state");

    const setCookie = findSetCookie(res, STATE_COOKIE_NAME);
    expect(
      setCookie,
      `Set-Cookie for ${STATE_COOKIE_NAME} must be present`,
    ).toBeDefined();

    const { value } = parseCookieNameValue(setCookie!);
    expect(value).toBe(expectedState);
  });

  it("state cookie carries HttpOnly + Secure + SameSite=Lax + Max-Age", async () => {
    // AC 3.10: cookie attribute correctness. The state cookie is
    // CSRF-bearing; if any of these attrs is missing the protection breaks.
    const res = await startAuth();
    const setCookie = findSetCookie(res, STATE_COOKIE_NAME);
    expect(setCookie).toBeDefined();

    const attrs = parseCookieAttributes(setCookie!);
    expect("httponly" in attrs).toBe(true);
    expect("secure" in attrs).toBe(true);
    expect(attrs["samesite"]?.toLowerCase()).toBe("lax");

    const maxAge = Number(attrs["max-age"]);
    expect(Number.isFinite(maxAge)).toBe(true);
    expect(maxAge).toBeGreaterThan(0);
    // "Short-lived" per AC 3.4 — cap at 10 minutes. Anything longer would
    // expand the CSRF window unnecessarily.
    expect(maxAge).toBeLessThanOrEqual(600);
  });

  it("state cookie is path-scoped to / so it's sent on /auth/callback", async () => {
    const res = await startAuth();
    const setCookie = findSetCookie(res, STATE_COOKIE_NAME);
    const attrs = parseCookieAttributes(setCookie!);
    // Either explicit Path=/ or no Path attribute (default = request path)
    // is acceptable, but most safely we pin to /.
    expect(attrs["path"] ?? "/").toBe("/");
  });

  it("two consecutive /auth/start calls produce different state values", async () => {
    // Replay protection: each authorize attempt must mint a fresh nonce.
    const a = new URL((await startAuth()).headers.get("Location") ?? "");
    const b = new URL((await startAuth()).headers.get("Location") ?? "");
    expect(a.searchParams.get("state")).not.toBe(b.searchParams.get("state"));
  });

  it("response body does not leak the state (it's only in the cookie + URL)", async () => {
    // Belt-and-suspenders: opaque-cookie discipline means the body should
    // not contain the state either. The state lives in (a) the redirect
    // URL the browser is sent to and (b) the HttpOnly cookie. Anything
    // else is a bug.
    const res = await startAuth();
    const body = await res.text();
    const url = new URL(res.headers.get("Location") ?? "");
    const state = url.searchParams.get("state");
    if (state && body) {
      expect(body.includes(state)).toBe(false);
    }
  });
});
