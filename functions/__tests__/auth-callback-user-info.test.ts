// Issue #91 / AC 5.4 — `/auth/callback` populates the session KV
// record with the GitHub user's identity so subsequent
// `/api/session-status` calls can surface `{user: {login,
// avatar_url}}` to the frontend (avatar indicator in the viewer
// header).
//
// In `AUTH_METHOD=app` mode (the default), the worker doesn't have
// a user-OAuth token — it has an installation token. To resolve the
// user, the worker calls `GET /app/installations/{id}` with the App
// JWT; the response includes an `account` field with `login` and
// `avatar_url` (the user/org that owns the installation).
//
// We test the OUTCOME (KV record post-callback contains user info)
// rather than the precise GitHub endpoint — builder may resolve user
// info via the installation API, the GraphQL API, an
// installation-token-scoped `/installation/repositories` chain, or
// any other GitHub-supported path. The pin is "the KV record has
// user.login + user.avatar_url after a successful callback".

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
import {
  findSetCookie,
  parseCookieNameValue,
} from "./test-helpers";

const STATE_COOKIE_NAME = "hashly_oauth_state";
const SESSION_COOKIE_NAME = "hashly_session";
const FAKE_INSTALL_TOKEN = "ghs_install_TOKEN_TEST_VALUE_USER_INFO_8B2A";
const TEST_INSTALLATION_ID = "42";
const TEST_LOGIN = "octocat";
const TEST_AVATAR_URL = "https://avatars.githubusercontent.com/u/583231?v=4";
const TEST_USER_ID = 583231;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(() => {
  // Mock the access-tokens exchange (existing path, same as
  // auth-callback-success.test.ts).
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

  // Mock the installation-detail fetch — the natural endpoint for
  // resolving user info given an installation_id + App JWT. Builder
  // may use a different endpoint; if so they'll need to add their
  // own mock here. The pin is the OUTCOME (KV has user info), not
  // the precise upstream call.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: `/app/installations/${TEST_INSTALLATION_ID}`,
      method: "GET",
    })
    .reply(
      200,
      JSON.stringify({
        id: Number(TEST_INSTALLATION_ID),
        account: {
          login: TEST_LOGIN,
          id: TEST_USER_ID,
          avatar_url: TEST_AVATAR_URL,
          type: "User",
        },
        target_type: "User",
        permissions: { contents: "write" },
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();
});

async function runCallback(): Promise<Response> {
  const startUrl = new URL("https://worker.test/auth/start");
  const startRes = await (exports as any).default.fetch(startUrl.toString(), {
    redirect: "manual",
    headers: { Origin: "https://worker.test" },
  });
  expect(startRes.status, "precondition: /auth/start must redirect").toBe(302);

  const stateCookie = findSetCookie(startRes, STATE_COOKIE_NAME);
  const stateCookieValue = parseCookieNameValue(stateCookie!).value;
  const githubLocation = new URL(startRes.headers.get("Location") ?? "");
  const urlState = githubLocation.searchParams.get("state");

  const callbackUrl = new URL("https://worker.test/auth/callback");
  callbackUrl.searchParams.set("state", urlState!);
  callbackUrl.searchParams.set("installation_id", TEST_INSTALLATION_ID);
  callbackUrl.searchParams.set("setup_action", "install");

  return (exports as any).default.fetch(callbackUrl.toString(), {
    headers: { Cookie: `${STATE_COOKIE_NAME}=${stateCookieValue}`, Origin: "https://worker.test" },
    redirect: "manual",
  });
}

describe("/auth/callback — populates user info in the session KV record (AC 5.4)", () => {
  it("after callback, the KV record contains `user.login`", async () => {
    // The end-to-end pin: post-callback, the session KV record has
    // the GitHub user's login. AC 5.2's session-status reads from
    // this record; the frontend renders the avatar from it.
    const res = await runCallback();
    expect(res.status).toBe(302);

    const sessionCookie = findSetCookie(res, SESSION_COOKIE_NAME);
    expect(sessionCookie, "precondition: session cookie must be set").toBeDefined();
    const sessionId = parseCookieNameValue(sessionCookie!).value;

    const stored = await env.SESSIONS.get(sessionId);
    expect(stored, "precondition: session record must exist in KV").not.toBeNull();
    const record = JSON.parse(stored!) as { user?: { login?: unknown } };
    expect(
      record.user?.login,
      `expected the KV record to contain user.login after the callback (AC 5.4 — without this, session-status can't surface user info to the frontend). Got: ${JSON.stringify(record)}`,
    ).toBe(TEST_LOGIN);
  });

  it("after callback, the KV record contains `user.avatar_url`", async () => {
    const res = await runCallback();
    const sessionCookie = findSetCookie(res, SESSION_COOKIE_NAME);
    const sessionId = parseCookieNameValue(sessionCookie!).value;
    const stored = await env.SESSIONS.get(sessionId);
    const record = JSON.parse(stored!) as { user?: { avatar_url?: unknown } };
    expect(
      record.user?.avatar_url,
      `expected the KV record to contain user.avatar_url after the callback (AC 5.4 — frontend renders the avatar from this URL). Got: ${JSON.stringify(record)}`,
    ).toBe(TEST_AVATAR_URL);
  });

  it("the access_token still appears in the KV record (non-regression on existing AC 3.5b storage)", async () => {
    // Defensive: enriching with user info must NOT replace the
    // token storage. AC 3.5b's "store the access token in
    // env.SESSIONS" pin must keep holding.
    const res = await runCallback();
    const sessionCookie = findSetCookie(res, SESSION_COOKIE_NAME);
    const sessionId = parseCookieNameValue(sessionCookie!).value;
    const stored = await env.SESSIONS.get(sessionId);
    expect(stored).not.toBeNull();
    expect(stored!.includes(FAKE_INSTALL_TOKEN)).toBe(true);
  });

  it("the access_token does NOT appear in the response body (AC 3.10 token-leak invariant)", async () => {
    // The bedrock invariant carried into the user-info-enriched
    // callback path. Even if the impl temporarily handles user info
    // in a way that touches the response, the token must not leak.
    const res = await runCallback();
    const body = await res.text();
    expect(body).not.toContain(FAKE_INSTALL_TOKEN);
  });

  it("the access_token does NOT appear in any non-Set-Cookie response header", async () => {
    const res = await runCallback();
    for (const [name, value] of res.headers.entries()) {
      if (name.toLowerCase() === "set-cookie") continue;
      expect(
        value.includes(FAKE_INSTALL_TOKEN),
        `Header ${name} leaked access token: ${value}`,
      ).toBe(false);
    }
  });
});
