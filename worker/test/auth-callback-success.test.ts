// AC 3.5b — `GET /auth/callback` happy path.
//
// Once the CSRF gate (slice 3a) passes, the callback must:
//   1. Exchange the install (or code) for a GitHub access token, server-side.
//   2. Mint an opaque session ID.
//   3. Store {access_token, ...} in `env.SESSIONS` keyed by that session ID.
//   4. Set `hashly_session=<opaque-id>` cookie with HttpOnly/Secure/Lax/Max-Age.
//   5. Clear the `hashly_oauth_state` cookie (single-use).
//   6. 302 the browser somewhere (return target — full return_to threading
//      lands in a follow-up sub-slice; for now any non-null Location passes).
//
// The hard constraint: the access token NEVER appears in the response body
// or in any cookie value. Only an opaque session ID HMAC'd / signed against
// `SESSION_HMAC_KEY` may be exposed to the client.

import { SELF, env, fetchMock } from "cloudflare:test";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
} from "vitest";
import {
  findSetCookie,
  parseCookieAttributes,
  parseCookieNameValue,
} from "./test-helpers";

const STATE_COOKIE_NAME = "hashly_oauth_state";
const SESSION_COOKIE_NAME = "hashly_session";
const FAKE_INSTALL_TOKEN = "ghs_install_TOKEN_TEST_VALUE_DO_NOT_LEAK_9F4A2";
const TEST_INSTALLATION_ID = "42";
const TEST_STATE = "valid-state-value-32-chars-long-zzzzz";

beforeAll(() => {
  // Activate undici-style fetch mocking for outbound `fetch()` from the
  // worker. `disableNetConnect` ensures any unmocked outbound call throws,
  // so a stray fetch shows up as a clear test failure rather than hitting
  // the real internet from CI.
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(() => {
  // Mock GitHub's installation-token endpoint (the App-install flow).
  // Builder may use `@octokit/auth-app` or hand-roll a JWT + fetch — either
  // way the actual outbound HTTP call is to this endpoint.
  // `.persist()` lets octokit retry / re-call without a second interceptor.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: `/app/installations/${TEST_INSTALLATION_ID}/access_tokens`,
      method: "POST",
    })
    .reply(
      201,
      JSON.stringify({
        token: FAKE_INSTALL_TOKEN,
        expires_at: "2030-01-01T00:00:00Z",
        permissions: { contents: "write" },
        repository_selection: "selected",
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();
});

async function callbackSuccess(): Promise<Response> {
  const url = new URL("https://worker.test/auth/callback");
  url.searchParams.set("state", TEST_STATE);
  url.searchParams.set("installation_id", TEST_INSTALLATION_ID);
  url.searchParams.set("setup_action", "install");
  return SELF.fetch(url.toString(), {
    headers: { Cookie: `${STATE_COOKIE_NAME}=${TEST_STATE}` },
    redirect: "manual",
  });
}

describe("GET /auth/callback — happy path (AC 3.5b)", () => {
  it("returns a 302 redirect after successful auth", async () => {
    const res = await callbackSuccess();
    expect(res.status).toBe(302);
  });

  it("sets a non-empty Location header", async () => {
    const res = await callbackSuccess();
    const loc = res.headers.get("Location");
    expect(loc).not.toBeNull();
    expect(loc!.length).toBeGreaterThan(0);
  });

  it("issues a hashly_session cookie", async () => {
    const res = await callbackSuccess();
    const setCookie = findSetCookie(res, SESSION_COOKIE_NAME);
    expect(
      setCookie,
      `Set-Cookie ${SESSION_COOKIE_NAME} must be present after successful auth`,
    ).toBeDefined();
  });

  it("session cookie carries HttpOnly + Secure + SameSite=Lax + Max-Age", async () => {
    // AC 3.10 first bullet: cookie attribute correctness for the session
    // cookie. These attrs are the bedrock of session security; missing any
    // of them widens the attack surface dramatically.
    const res = await callbackSuccess();
    const setCookie = findSetCookie(res, SESSION_COOKIE_NAME);
    expect(setCookie).toBeDefined();
    const attrs = parseCookieAttributes(setCookie!);

    expect("httponly" in attrs).toBe(true);
    expect("secure" in attrs).toBe(true);
    expect(attrs["samesite"]?.toLowerCase()).toBe("lax");

    const maxAge = Number(attrs["max-age"]);
    expect(Number.isFinite(maxAge)).toBe(true);
    expect(maxAge).toBeGreaterThan(0);
    // Sessions don't need to live forever. Cap at 24 hours so a stolen
    // cookie has bounded blast radius. Real-world GH App tokens expire
    // hourly anyway, so a 1-hour cookie is also acceptable.
    expect(maxAge).toBeLessThanOrEqual(86400);
  });

  it("session cookie value is opaque — NEVER the access token", async () => {
    // AC 3.10 third bullet (cookie variant): the access token must not
    // appear in any cookie value either. Only an opaque session ID.
    const res = await callbackSuccess();
    const setCookie = findSetCookie(res, SESSION_COOKIE_NAME)!;
    const { value } = parseCookieNameValue(setCookie);

    expect(value).not.toBe(FAKE_INSTALL_TOKEN);
    expect(value).not.toContain(FAKE_INSTALL_TOKEN);
    // Some opacity floor — defends against trivially-empty session IDs.
    expect(value.length).toBeGreaterThanOrEqual(16);
  });

  it("response body does NOT contain the access token (AC 3.10 token-leak invariant)", async () => {
    // The most critical invariant of the whole worker design. If this ever
    // regresses, we're back to client-side token storage and any XSS bug
    // becomes catastrophic.
    const res = await callbackSuccess();
    const body = await res.text();
    expect(body).not.toContain(FAKE_INSTALL_TOKEN);
  });

  it("response headers do NOT contain the access token (sweep)", async () => {
    // Belt-and-suspenders. Some bugs leak via header echoing.
    const res = await callbackSuccess();
    for (const [name, value] of res.headers.entries()) {
      // Cookies *contain* the session ID; we already proved above that the
      // ID is not the token. Other headers shouldn't even mention the
      // token marker.
      if (name.toLowerCase() === "set-cookie") continue;
      expect(
        value.includes(FAKE_INSTALL_TOKEN),
        `Header ${name} leaked access token: ${value}`,
      ).toBe(false);
    }
  });

  it("clears the state cookie after success (single-use CSRF nonce)", async () => {
    const res = await callbackSuccess();
    const stateCookie = findSetCookie(res, STATE_COOKIE_NAME);
    expect(
      stateCookie,
      "state cookie should be cleared via Set-Cookie on success",
    ).toBeDefined();
    const attrs = parseCookieAttributes(stateCookie!);
    // Cleared either via Max-Age=0 or a past Expires. Either is valid.
    const cleared =
      Number(attrs["max-age"]) === 0 ||
      (typeof attrs["expires"] === "string" && attrs["expires"].length > 0);
    expect(cleared, `state cookie not cleared: ${stateCookie}`).toBe(true);
  });

  it("stores the access token in env.SESSIONS server-side", async () => {
    // The whole point of the opaque-cookie design: the token lives in KV,
    // keyed by the session ID, and never on the client. We assert by
    // listing the namespace and confirming at least one record contains
    // the token. We deliberately don't couple to the exact key format
    // (could be raw session ID, hashed ID, prefixed, etc.) — only the
    // outcome that "the token made it to server-side storage".
    await callbackSuccess();
    const list = await env.SESSIONS.list();
    expect(list.keys.length).toBeGreaterThan(0);

    let found = false;
    for (const k of list.keys) {
      const v = await env.SESSIONS.get(k.name);
      if (v && v.includes(FAKE_INSTALL_TOKEN)) {
        found = true;
        break;
      }
    }
    expect(
      found,
      "expected env.SESSIONS to contain a record holding the access token",
    ).toBe(true);
  });

  it("session cookie ID maps to a KV record (round-trip)", async () => {
    // Stronger invariant: the opaque ID in the cookie must let the worker
    // resolve back to the stored session. Either:
    //   (a) the cookie value IS the KV key, or
    //   (b) the cookie value is a signed envelope from which the KV key
    //       can be parsed (pre-`.` segment, etc.).
    // We accept either pattern by testing "some prefix of the cookie value
    // is a KV key".
    const res = await callbackSuccess();
    const setCookie = findSetCookie(res, SESSION_COOKIE_NAME)!;
    const { value: cookieValue } = parseCookieNameValue(setCookie);

    const list = await env.SESSIONS.list();
    const matched = list.keys.some((k) => cookieValue.startsWith(k.name) || cookieValue === k.name);
    expect(
      matched,
      `cookie value ${cookieValue} should reference a KV key in env.SESSIONS (keys: ${list.keys.map((k) => k.name).join(", ")})`,
    ).toBe(true);
  });
});
