// Issue #91 / AC 5.3 — worker side: thread the `return` URL from
// `/auth/start` through the GitHub round-trip so `/auth/callback`
// redirects the browser back to the spec URL the user was on (not
// "/").
//
// Threading mechanism (per QA-tdd / team-lead consultation):
//   - `/auth/start` accepts an optional `return` query param.
//   - Validates: the URL must be SAME-ORIGIN as the request URL
//     (open-redirect protection — without this, an attacker could
//     craft `?return=https://evil.com` and post-auth the user lands
//     on evil.com with the auth flow visually intact).
//   - On success, the validated return URL is stashed in the
//     state cookie alongside the CSRF nonce. The cookie format is
//     builder discretion (e.g., `${nonce}|${base64(returnUrl)}`,
//     or two separate cookies, or a JSON-encoded value); these
//     tests pin the OUTCOME (callback redirects to the right URL)
//     not the cookie shape.
//   - `/auth/callback` reads the stashed return URL and uses it as
//     the Location header. Falls back to "/" if no return URL was
//     stashed (legacy / no-return case — preserves existing AC 3.5b
//     behavior).
//
// AC 5.2 sends `window.location.href` (absolute URL) as the return
// param. In tests the worker request URL is `https://worker.test/...`,
// so a return URL with origin `https://worker.test` is valid;
// anything else (`https://evil.com`, `//evil.com`) is rejected.

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
  parseCookieNameValue,
} from "./test-helpers";

const STATE_COOKIE_NAME = "hashly_oauth_state";
const SESSION_COOKIE_NAME = "hashly_session";
const FAKE_INSTALL_TOKEN = "ghs_install_TOKEN_TEST_VALUE_RETURN_URL_5C1D";
const TEST_INSTALLATION_ID = "42";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(() => {
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

async function startAuth(returnUrl?: string): Promise<Response> {
  const url = new URL("https://worker.test/auth/start");
  if (returnUrl !== undefined) {
    url.searchParams.set("return", returnUrl);
  }
  return SELF.fetch(url.toString(), { redirect: "manual" });
}

/**
 * Run the full /auth/start → /auth/callback round-trip with an
 * optional `return` query param. Returns the final callback Response
 * so tests can pin its Location header.
 */
async function authRoundTrip(returnUrl?: string): Promise<Response> {
  const startRes = await startAuth(returnUrl);
  expect(startRes.status, "precondition: /auth/start must redirect").toBe(302);

  // Pull the state cookie from /auth/start so we can replay it on
  // /auth/callback (a real browser does this via the Set-Cookie ⇄
  // Cookie pair). The cookie's full value is what the worker sees.
  const stateCookie = findSetCookie(startRes, STATE_COOKIE_NAME);
  expect(stateCookie, "precondition: state cookie must be set").toBeDefined();
  const stateCookieValue = parseCookieNameValue(stateCookie!).value;

  // The URL state is whatever the worker put on GitHub's redirect.
  // Parse it from the GitHub Location URL.
  const githubLocation = new URL(startRes.headers.get("Location") ?? "");
  const urlState = githubLocation.searchParams.get("state");
  expect(urlState, "precondition: GitHub redirect must include state param").toBeTruthy();

  // Replay the state cookie + URL state on /auth/callback.
  const callbackUrl = new URL("https://worker.test/auth/callback");
  callbackUrl.searchParams.set("state", urlState!);
  callbackUrl.searchParams.set("installation_id", TEST_INSTALLATION_ID);
  callbackUrl.searchParams.set("setup_action", "install");

  return SELF.fetch(callbackUrl.toString(), {
    headers: { Cookie: `${STATE_COOKIE_NAME}=${stateCookieValue}` },
    redirect: "manual",
  });
}

describe("/auth/start — accepts and validates `return` query param (AC 5.3)", () => {
  it("with no `return` param, /auth/start still works (legacy / fallback case)", async () => {
    // Symmetric existing-behavior pin: the old "redirect to /" flow
    // must keep working when the frontend doesn't send a return URL.
    // Without this, a non-frontend caller (curl / hand-crafted link)
    // would 400 instead of degrading gracefully.
    const res = await startAuth();
    expect(res.status).toBe(302);
    const stateCookie = findSetCookie(res, STATE_COOKIE_NAME);
    expect(stateCookie).toBeDefined();
  });

  it("with a same-origin absolute return URL, /auth/start accepts it (sets state cookie)", async () => {
    // The legitimate AC 5.2 case: frontend sends
    // `window.location.href` which is same-origin as the worker.
    const res = await startAuth("https://worker.test/?repo=foo/bar&path=spec.md&ref=main");
    expect(res.status).toBe(302);
    const stateCookie = findSetCookie(res, STATE_COOKIE_NAME);
    expect(stateCookie).toBeDefined();
  });

  it("with a relative-path return URL, /auth/start accepts it", async () => {
    // Relative paths are always same-origin by definition. A future
    // frontend version might send relative URLs to avoid the origin
    // coupling; both shapes should work.
    const res = await startAuth("/?repo=foo/bar&path=spec.md");
    expect(res.status).toBe(302);
  });

  it("with a CROSS-ORIGIN absolute return URL (https://evil.com/foo), the return is REJECTED (open-redirect protection)", async () => {
    // The critical security pin. Without same-origin validation,
    // /auth/callback would redirect to evil.com after a successful
    // auth — visually identical to the legitimate flow, full
    // session cookie set on the user's browser, attacker harvests
    // anything served from evil.com on click-through. Pin: the
    // cross-origin URL is NOT used as the callback destination; the
    // worker falls back to "/" (the safe default).
    const res = await authRoundTrip("https://evil.com/?repo=foo/bar");
    expect(res.status).toBe(302);
    const loc = res.headers.get("Location") ?? "";
    expect(
      loc.startsWith("https://evil.com"),
      `expected the callback Location to NOT redirect to the cross-origin URL (open-redirect protection — AC 5.3 security pin). Got: ${JSON.stringify(loc)}`,
    ).toBe(false);
  });

  it("with a PROTOCOL-RELATIVE return URL (//evil.com/foo), the return is REJECTED", async () => {
    // Variant attack: `//evil.com` is parsed by browsers as
    // `https://evil.com` (protocol from the current page). The
    // worker MUST reject it the same way as `https://evil.com`.
    const res = await authRoundTrip("//evil.com/?repo=foo");
    expect(res.status).toBe(302);
    const loc = res.headers.get("Location") ?? "";
    expect(
      loc.startsWith("//evil.com") || loc.startsWith("https://evil.com"),
      `expected the protocol-relative URL to be rejected the same way as a cross-origin absolute (AC 5.3 — open-redirect attack variant). Got: ${JSON.stringify(loc)}`,
    ).toBe(false);
  });

  it("with an empty return URL, /auth/start accepts the request and treats it as no-return (defaults to /)", async () => {
    // Edge case: a frontend that constructs the URL but didn't
    // populate the param. Same as no-return case — graceful default.
    const res = await startAuth("");
    expect(res.status).toBe(302);
  });
});

describe("/auth/callback — uses threaded return URL (AC 5.3)", () => {
  it("with a same-origin return URL stashed at /auth/start, /auth/callback redirects to that URL", async () => {
    // The end-to-end pin. After the GitHub round-trip, the user
    // lands BACK on the spec page they were on — that's the whole
    // point of AC 5.3.
    const returnUrl = "https://worker.test/?repo=foo/bar&path=spec.md&ref=main";
    const res = await authRoundTrip(returnUrl);

    expect(res.status).toBe(302);
    const loc = res.headers.get("Location") ?? "";
    // The Location may be the absolute URL OR a relative path —
    // either is valid (browsers resolve relative against the
    // current URL, which is the worker's origin = same as the
    // return URL's origin). Pin that the spec coordinates make it
    // through.
    expect(
      loc.includes("repo=foo/bar"),
      `expected the callback Location to preserve the spec coordinates (AC 5.3 — threading the return URL). Got: ${JSON.stringify(loc)}`,
    ).toBe(true);
    expect(loc).toContain("path=spec.md");
    expect(loc).toContain("ref=main");
  });

  it("with NO return URL stashed, /auth/callback redirects to / (graceful default — preserves AC 3.5b behavior)", async () => {
    // Non-regression: the existing AC 3.5b "callback redirects to
    // somewhere" test must keep passing. The default is "/".
    const res = await authRoundTrip();
    expect(res.status).toBe(302);
    const loc = res.headers.get("Location") ?? "";
    expect(
      loc === "/" || loc.endsWith("/") || loc === "",
      `expected the no-return case to default to "/" (or equivalent same-host root). Got: ${JSON.stringify(loc)}`,
    ).toBe(true);
  });

  it("threading does NOT compromise the existing CSRF gate (callback still rejects mismatched state)", async () => {
    // Adversarial pin: an impl that stuffs return URL into the
    // state cookie value MUST keep validating the URL's state nonce
    // against the cookie's nonce. Without this, an attacker could
    // craft a cookie with their own return URL + a stolen state and
    // bypass CSRF.
    const res = await SELF.fetch(
      "https://worker.test/auth/callback?state=mismatched&installation_id=42",
      {
        headers: { Cookie: `${STATE_COOKIE_NAME}=stashed-cookie-value-with-different-nonce` },
        redirect: "manual",
      },
    );
    expect(
      res.status,
      "expected 400 on state mismatch (AC 3.5a CSRF gate must keep working alongside AC 5.3 threading).",
    ).toBe(400);
  });

  it("session cookie is still issued on the threaded-return path (AC 3.5b non-regression)", async () => {
    // Defensive: a refactor that touches the redirect target
    // shouldn't accidentally drop the Set-Cookie for the session.
    const res = await authRoundTrip("https://worker.test/?repo=foo/bar&path=spec.md");
    const sessionCookie = findSetCookie(res, SESSION_COOKIE_NAME);
    expect(
      sessionCookie,
      "expected the session cookie to still be set on the threaded-return path (AC 3.5b non-regression).",
    ).toBeDefined();
  });
});
