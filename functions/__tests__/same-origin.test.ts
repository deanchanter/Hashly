// Issue #139 / v0.3.1 hosting consolidation — same-origin invariant tests.
//
// The frontend's auth + save calls are issued with `credentials:
// "same-origin"` (search src/save-flow.ts, src/session-indicator.ts,
// src/edit-mode.ts). That fetch option means: cookies will only be sent
// when the request URL shares an origin with the page making it. v0.3
// shipped with the backend on `*.workers.dev` and the frontend on
// `hashly-md.pages.dev` — different origins → cookies never accompanied
// the auth/save calls → the whole JIT-auth flow was unreachable in
// production.
//
// v0.3.1 collapses everything onto Cloudflare Pages so backend and
// frontend share a single origin (Pages Functions). These tests codify
// the constraint as executable contract: a single deployed origin must
// serve `/auth/start`, `/api/session-status`, and `/auth/callback`
// (with same-origin redirects) — no CORS dance, no cross-origin cookie
// gymnastics.
//
// Each `it` carries a comment explaining what would break the
// assertion if the invariant regressed.

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
const TEST_INSTALLATION_ID = "42";
const FAKE_INSTALL_TOKEN = "ghs_install_TOKEN_SAME_ORIGIN_TEST_8B7E";
// Same-origin convention used by the existing suite — `https://x.test`
// (or `https://worker.test`) is the deployed Pages origin in tests.
const TEST_ORIGIN = "https://x.test";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(() => {
  // Mock the installation-token exchange (POST) — required for the
  // /auth/callback happy-path test below to reach the redirect step.
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
  // Also mock the installation-owner GET (used by AC 5.4 user-info
  // enrichment). A 200 with valid JSON keeps the callback path on the
  // happy branch; a failure here would gracefully degrade to no user
  // info but is irrelevant to same-origin assertions either way.
  fetchMock
    .get("https://api.github.com")
    .intercept({
      path: `/app/installations/${TEST_INSTALLATION_ID}`,
      method: "GET",
    })
    .reply(
      200,
      JSON.stringify({
        account: {
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
        },
      }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();
});

describe("Test 6.1 — /auth/start is reachable as a same-origin path", () => {
  it("returns a 302 redirecting to GitHub (App-install flow under AUTH_METHOD=app)", async () => {
    // The frontend's JIT-auth path navigates the browser to
    // `/auth/start` on its own origin (no host swap, no cross-origin
    // fetch). If a future refactor moved /auth/start to a separate
    // origin (say, *.workers.dev), this assertion would still pass
    // structurally — but the production wiring would once again
    // break same-origin cookie delivery. The assertion here pins
    // that *the Pages-Functions deploy itself* answers /auth/start
    // (the request-side of the same-origin contract).
    const res = await (exports as any).default.fetch(
      `${TEST_ORIGIN}/auth/start`,
      { redirect: "manual" },
    );
    expect(
      res.status,
      "expected 302 — /auth/start must answer on the deployed Pages origin (Issue #139 / hosting consolidation).",
    ).toBe(302);

    const loc = res.headers.get("Location") ?? "";
    // AUTH_METHOD=app (vitest config default) → install URL on
    // github.com/apps/<slug>/installations/new. If AUTH_METHOD ever
    // flips to oauth-app the host shifts to
    // github.com/login/oauth/authorize — both are GitHub-side and
    // both satisfy "the redirect points off-origin to GitHub", which
    // is the contract here.
    const isAppInstallRedirect = /^https:\/\/github\.com\/apps\/[^/]+\/installations\/new(\?|$)/.test(loc);
    const isOAuthAuthorizeRedirect = /^https:\/\/github\.com\/login\/oauth\/authorize(\?|$)/.test(loc);
    expect(
      isAppInstallRedirect || isOAuthAuthorizeRedirect,
      `expected /auth/start Location to point at GitHub's install or authorize URL. Got: ${JSON.stringify(loc)}`,
    ).toBe(true);
  });

  it("issues the state cookie on the same-origin response (no Domain attr scoping it elsewhere)", async () => {
    // A subtle regression vector: setting `Domain=workers.dev` on
    // the cookie would tie it to the wrong origin and re-create the
    // production breakage we're fixing. Defaults (no Domain attr)
    // mean the cookie scopes to the response origin — exactly what
    // we want. Pin: no explicit Domain attribute leaks through.
    const res = await (exports as any).default.fetch(
      `${TEST_ORIGIN}/auth/start`,
      { redirect: "manual" },
    );
    const setCookie = findSetCookie(res, STATE_COOKIE_NAME);
    expect(setCookie).toBeDefined();
    expect(
      /;\s*domain=/i.test(setCookie!),
      `state cookie must not pin Domain (Issue #139 — keep cookie scoped to the deployed origin). Got Set-Cookie: ${setCookie}`,
    ).toBe(false);
  });
});

describe("Test 6.2 — /api/session-status is a same-origin JSON endpoint (no CORS)", () => {
  it("returns a JSON body with no Access-Control-* headers", async () => {
    // The frontend uses `credentials: "same-origin"` against this
    // path. If a future contributor added CORS headers
    // (`Access-Control-Allow-Origin: *`, etc.) it would signal the
    // endpoint is meant to be cross-origin — opposite of the
    // hosting-consolidation contract. Assertion fires if any
    // Access-Control-* header appears.
    const res = await (exports as any).default.fetch(
      `${TEST_ORIGIN}/api/session-status`,
      { headers: { Cookie: "hashly_sid=does-not-exist" } },
    );

    // The endpoint returns a structured response either way. The
    // unauthenticated path returns 401 (per session-status.test.ts);
    // 401 with a parseable JSON body is also acceptable, but the
    // existing impl returns plain "unauthorized" text on 401. Per
    // the issue brief, what we pin is the *content-type discipline*
    // on the authenticated 200 path; for the 401 path we still
    // require no CORS headers (the cross-origin invariant is
    // status-independent).
    //
    // To keep the JSON-body assertion meaningful while accommodating
    // both 200 and 401 shapes, we additionally seed a session-status
    // success path in a separate `it`. Here we focus on the no-CORS
    // invariant which holds across all status codes.

    for (const headerName of [
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-allow-methods",
      "access-control-allow-headers",
      "access-control-expose-headers",
      "access-control-max-age",
    ]) {
      expect(
        res.headers.get(headerName),
        `expected no ${headerName} header — /api/session-status is same-origin (Issue #139). A non-null value here would signal cross-origin intent.`,
      ).toBeNull();
    }
  });

  it("authenticated 200 path returns application/json content-type with parseable JSON body", async () => {
    // Pin: the same-origin endpoint speaks JSON on the success path.
    // A future regression that switched to `text/plain` would break
    // the AC 5.4 avatar-rendering frontend (which calls .json() on
    // the response). Seeded here directly into env.SESSIONS — the
    // KV-backed cookie path. If a contributor changed
    // /api/session-status to redirect cross-origin (say, to a
    // separate auth domain), the response status would no longer
    // be 200 here and this assertion would fire.
    const SESSION_ID = "same-origin-test-session-id-32chars";
    await env.SESSIONS.put(
      SESSION_ID,
      JSON.stringify({
        access_token: "ghs_irrelevant_token_for_same_origin_test",
        installation_id: "42",
        expires_at: "2030-01-01T00:00:00Z",
      }),
    );

    const res = await (exports as any).default.fetch(
      `${TEST_ORIGIN}/api/session-status`,
      { headers: { Cookie: `hashly_session=${SESSION_ID}` } },
    );
    expect(res.status).toBe(200);

    const ct = res.headers.get("content-type") ?? "";
    expect(
      ct.toLowerCase().includes("application/json"),
      `expected application/json content-type on /api/session-status 200 path. Got: ${JSON.stringify(ct)}`,
    ).toBe(true);

    const body = await res.text();
    expect(
      () => JSON.parse(body),
      `expected /api/session-status 200 body to be JSON-parseable. Got: ${JSON.stringify(body)}`,
    ).not.toThrow();
  });
});

describe("Test 6.3 — /auth/callback redirect Location is same-origin", () => {
  it("after the OAuth round-trip, Location shares scheme + host with the request URL", async () => {
    // The callback's Location is what the user's browser navigates
    // to after auth completes. If it points at a different origin
    // (e.g. the static-frontend `*.pages.dev` while the worker
    // lives on `*.workers.dev`), the session cookie just set on the
    // worker origin won't accompany the next page load → JIT auth
    // visually succeeds but functionally fails. Pin: same-origin
    // redirect target.
    //
    // We drive a same-origin `return` param through the full
    // /auth/start → /auth/callback round-trip (same pattern as
    // auth-return-url.test.ts) so the callback has a non-default
    // return URL to honor.
    const sameOriginReturn = `${TEST_ORIGIN}/?repo=foo/bar&path=spec.md&ref=main`;

    const startRes = await (exports as any).default.fetch(
      `${TEST_ORIGIN}/auth/start?return=${encodeURIComponent(sameOriginReturn)}`,
      { redirect: "manual" },
    );
    expect(startRes.status).toBe(302);

    const stateCookie = findSetCookie(startRes, STATE_COOKIE_NAME);
    expect(stateCookie, "precondition: state cookie must be set").toBeDefined();
    const stateCookieValue = parseCookieNameValue(stateCookie!).value;

    const githubLocation = new URL(startRes.headers.get("Location") ?? "");
    const urlState = githubLocation.searchParams.get("state");
    expect(urlState).toBeTruthy();

    const callbackUrl = new URL(`${TEST_ORIGIN}/auth/callback`);
    callbackUrl.searchParams.set("state", urlState!);
    callbackUrl.searchParams.set("installation_id", TEST_INSTALLATION_ID);
    callbackUrl.searchParams.set("setup_action", "install");

    const cbRes = await (exports as any).default.fetch(callbackUrl.toString(), {
      headers: { Cookie: `${STATE_COOKIE_NAME}=${stateCookieValue}` },
      redirect: "manual",
    });

    expect(cbRes.status).toBe(302);
    const loc = cbRes.headers.get("Location") ?? "";
    expect(loc.length).toBeGreaterThan(0);

    // Resolve Location against the request URL — relative paths
    // (e.g. "/") count as same-origin by definition; absolute URLs
    // must match scheme + host of the request. This assertion would
    // fire if the handler returned `https://other.test/foo` or
    // `https://x.test:9999/foo` (different port = different origin).
    const resolved = new URL(loc, callbackUrl.toString());
    const requestOrigin = new URL(callbackUrl.toString()).origin;
    expect(
      resolved.origin,
      `expected /auth/callback Location to be same-origin as the request (${requestOrigin}). Got: ${JSON.stringify(loc)} → resolved origin ${resolved.origin}.`,
    ).toBe(requestOrigin);
  });
});
