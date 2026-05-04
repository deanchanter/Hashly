// AC 3.8 — `AUTH_METHOD` env-var flag selects between the GitHub App
// install flow and the OAuth App user-to-server flow on `/auth/start`.
//
// Default: `app` → `https://github.com/apps/<slug>/installations/new`
// Override: `oauth-app` → `https://github.com/login/oauth/authorize?client_id=<oauth-client-id>`
//
// AC 3.10 lists "OAuth-App fallback flag honored" as one of the five
// required Worker unit tests; this file is where that lives.
//
// We can't override env via `SELF.fetch` (it uses the global test
// bindings), so we call the worker's default export directly with a
// hand-crafted env. Cloudflare's vitest pool documents this pattern as
// the supported way to test per-request env permutations.

import worker from "../src/index";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";

const STATE_COOKIE_NAME = "hashly_oauth_state";

async function startAuthWith(envOverrides: Record<string, unknown>): Promise<Response> {
  const customEnv = { ...env, ...envOverrides };
  const req = new Request("https://worker.test/auth/start");
  const ctx = createExecutionContext();
  const res = await worker.fetch(req as unknown as never, customEnv as never, ctx);
  await waitOnExecutionContext(ctx);
  return res as Response;
}

function getSetCookies(res: Response): string[] {
  return (res.headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie?.() ?? [];
}

describe("/auth/start — AUTH_METHOD=oauth-app branch (AC 3.8 + AC 3.10 fallback flag)", () => {
  it("returns 302", async () => {
    const res = await startAuthWith({ AUTH_METHOD: "oauth-app" });
    expect(res.status).toBe(302);
  });

  it("Location is the OAuth App authorize URL (NOT the App install URL)", async () => {
    const res = await startAuthWith({ AUTH_METHOD: "oauth-app" });
    const loc = res.headers.get("Location") ?? "";
    expect(loc).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    // Negative assertion: must not be the install URL.
    expect(loc).not.toContain("/apps/");
    expect(loc).not.toContain("/installations/new");
  });

  it("Location includes client_id from env.GITHUB_OAUTH_CLIENT_ID", async () => {
    const res = await startAuthWith({ AUTH_METHOD: "oauth-app" });
    const url = new URL(res.headers.get("Location") ?? "");
    // vitest config injects "test-oauth-client-id".
    expect(url.searchParams.get("client_id")).toBe("test-oauth-client-id");
  });

  it("Location still includes a state query param with the same entropy floor", async () => {
    const res = await startAuthWith({ AUTH_METHOD: "oauth-app" });
    const url = new URL(res.headers.get("Location") ?? "");
    const state = url.searchParams.get("state");
    expect(state).not.toBeNull();
    expect(state!.length).toBeGreaterThanOrEqual(32);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("state cookie behavior is identical to the app flow (HttpOnly, Secure, SameSite=Lax, Max-Age)", async () => {
    // Switching the flag must NOT weaken the CSRF cookie posture.
    const res = await startAuthWith({ AUTH_METHOD: "oauth-app" });
    const cookies = getSetCookies(res);
    const stateCookie = cookies.find((c) => c.startsWith(`${STATE_COOKIE_NAME}=`));
    expect(stateCookie, "state cookie must be set in oauth-app flow too").toBeDefined();
    const lower = stateCookie!.toLowerCase();
    expect(lower).toContain("httponly");
    expect(lower).toContain("secure");
    expect(lower).toContain("samesite=lax");
    expect(lower).toMatch(/max-age=\d+/);
  });

  it("state cookie value matches the URL state in oauth-app mode (CSRF binding preserved)", async () => {
    const res = await startAuthWith({ AUTH_METHOD: "oauth-app" });
    const url = new URL(res.headers.get("Location") ?? "");
    const urlState = url.searchParams.get("state");

    const cookies = getSetCookies(res);
    const stateCookie = cookies.find((c) => c.startsWith(`${STATE_COOKIE_NAME}=`));
    const cookieValue = stateCookie!.split(";")[0].split("=").slice(1).join("=");
    expect(cookieValue).toBe(urlState);
  });
});

describe("/auth/start — default branch (AC 3.8 default = `app`)", () => {
  it("AUTH_METHOD=app → Location is the GitHub App install URL", async () => {
    // Sanity that the explicit `app` value behaves like SELF.fetch did in
    // slice 2 (AC 3.4). This is mostly a regression lock against the
    // possibility of breaking the default while shipping the oauth flag.
    const res = await startAuthWith({ AUTH_METHOD: "app" });
    expect(res.status).toBe(302);
    const loc = res.headers.get("Location") ?? "";
    expect(loc).toMatch(
      /^https:\/\/github\.com\/apps\/hashly-test\/installations\/new(\?|$)/,
    );
  });

  it("AUTH_METHOD undefined → defaults to `app` behavior", async () => {
    // Mimic a deployment that has not yet set the env var. The worker
    // should not 500 or pick an unknown branch — it must default to
    // the install URL per AC 3.8 ("default `app`").
    const overriddenEnv: Record<string, unknown> = { ...env };
    delete overriddenEnv.AUTH_METHOD;
    const req = new Request("https://worker.test/auth/start");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req as never, overriddenEnv as never, ctx);
    await waitOnExecutionContext(ctx);

    expect((res as Response).status).toBe(302);
    const loc = (res as Response).headers.get("Location") ?? "";
    expect(loc).toMatch(
      /^https:\/\/github\.com\/apps\/hashly-test\/installations\/new(\?|$)/,
    );
  });

  it("AUTH_METHOD=app and AUTH_METHOD=oauth-app produce different Location origins/paths", async () => {
    // Cross-check that the flag actually does something — guards against
    // a hypothetical future regression where someone merges the two paths
    // by accident.
    const appRes = await startAuthWith({ AUTH_METHOD: "app" });
    const oauthRes = await startAuthWith({ AUTH_METHOD: "oauth-app" });
    const appLoc = appRes.headers.get("Location") ?? "";
    const oauthLoc = oauthRes.headers.get("Location") ?? "";
    expect(new URL(appLoc).pathname).not.toBe(new URL(oauthLoc).pathname);
  });
});
