// Issue #155 / AC 1.5 — `/auth/callback` already-installed-user path.
//
// Post-#155, `/auth/start` redirects users to GitHub's standard
// `/login/oauth/authorize` endpoint. When a user has already
// installed the GitHub App on the target repo, GitHub returns the
// browser to `/auth/callback` with BOTH a `code` (the OAuth user
// authorization grant) AND an `installation_id` (because the App
// is already installed and bound to that user). This is the
// "already-installed user" path — distinct from the first-time
// install flow exercised in `auth-callback-success.test.ts`,
// which only carries `installation_id` + `setup_action=install`.
//
// Acceptance pin: when the callback receives `code` and
// `installation_id` together with a valid CSRF state, it MUST
// produce a session (302 + hashly_session cookie + KV record),
// just like the install path. The exact handling of `code` is
// builder discretion (it may be unused, exchanged for a user
// token, or exchanged for an installation token) — we pin only
// the OUTCOME: a logged-in session.
//
// AC 1.5 also re-asserts the existing `installation_id`-only
// "first-time install" coverage continues to produce a session;
// that lives in `auth-callback-success.test.ts` and remains green
// as a regression guard.

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
import { findSetCookie, parseCookieNameValue } from "./test-helpers";

const STATE_COOKIE_NAME = "hashly_oauth_state";
const SESSION_COOKIE_NAME = "hashly_session";
const FAKE_INSTALL_TOKEN = "ghs_install_TOKEN_TEST_VALUE_ALREADY_INSTALLED_2A8F";
const TEST_INSTALLATION_ID = "77";
const TEST_CODE = "abcdef-oauth-grant-code";
const TEST_STATE = "valid-state-already-installed-32-chars-zzz";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(() => {
  // Mock the installation-token exchange — same shape as the
  // install-flow tests. If the builder wires `code` through to a
  // user-token exchange instead of (or in addition to) the
  // installation-token exchange, they should add their own mock
  // for that endpoint.
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

async function callbackAlreadyInstalled(): Promise<Response> {
  // The "already-installed user" callback shape: `code` (from
  // /login/oauth/authorize) AND `installation_id` (because the App
  // is already bound to this user). NO `setup_action=install` —
  // the user didn't just install, they were already a user.
  const url = new URL("https://worker.test/auth/callback");
  url.searchParams.set("state", TEST_STATE);
  url.searchParams.set("code", TEST_CODE);
  url.searchParams.set("installation_id", TEST_INSTALLATION_ID);
  return (exports as any).default.fetch(url.toString(), {
    headers: { Cookie: `${STATE_COOKIE_NAME}=${TEST_STATE}` },
    redirect: "manual",
  });
}

describe("GET /auth/callback — already-installed user path (AC 1.5)", () => {
  it("returns a 302 redirect when `code` and `installation_id` arrive together", async () => {
    const res = await callbackAlreadyInstalled();
    expect(
      res.status,
      "expected 302 — code + installation_id with valid CSRF state must produce a session, not 4xx/5xx",
    ).toBe(302);
  });

  it("issues a hashly_session cookie on the already-installed path", async () => {
    const res = await callbackAlreadyInstalled();
    const setCookie = findSetCookie(res, SESSION_COOKIE_NAME);
    expect(
      setCookie,
      `Set-Cookie ${SESSION_COOKIE_NAME} must be present after callback with code + installation_id`,
    ).toBeDefined();
  });

  it("session cookie maps to a KV record holding the installation token", async () => {
    // Outcome pin: the builder's handling of `code` (whether
    // ignored, exchanged for a user token, etc.) is discretionary
    // — but the session record must exist and carry the
    // installation token so /api/save can act on it.
    const res = await callbackAlreadyInstalled();
    const setCookie = findSetCookie(res, SESSION_COOKIE_NAME)!;
    const sessionId = parseCookieNameValue(setCookie).value;
    const stored = await env.SESSIONS.get(sessionId);
    expect(stored, "expected KV record for the new session id").not.toBeNull();
    expect(stored!.includes(FAKE_INSTALL_TOKEN)).toBe(true);
  });

  it("does NOT leak the access token in the response body or non-cookie headers", async () => {
    // The bedrock #91 / AC 3.10 invariant — re-asserted on the
    // new code-bearing branch.
    const res = await callbackAlreadyInstalled();
    const body = await res.text();
    expect(body).not.toContain(FAKE_INSTALL_TOKEN);
    for (const [name, value] of res.headers.entries()) {
      if (name.toLowerCase() === "set-cookie") continue;
      expect(
        value.includes(FAKE_INSTALL_TOKEN),
        `Header ${name} leaked access token: ${value}`,
      ).toBe(false);
    }
  });

  it("CSRF gate still applies on the code-bearing branch (mismatched state → 400)", async () => {
    // Defense in depth: presence of `code` must NOT bypass CSRF.
    const url = new URL("https://worker.test/auth/callback");
    url.searchParams.set("state", "url-state-value");
    url.searchParams.set("code", TEST_CODE);
    url.searchParams.set("installation_id", TEST_INSTALLATION_ID);
    const res = await (exports as any).default.fetch(url.toString(), {
      headers: { Cookie: `${STATE_COOKIE_NAME}=different-cookie-state` },
      redirect: "manual",
    });
    expect(res.status).toBe(400);
    const cookies =
      (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const hasSession = cookies.some((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(hasSession).toBe(false);
  });
});
