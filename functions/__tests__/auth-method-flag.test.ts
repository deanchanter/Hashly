// AC 3.8 — `AUTH_METHOD` env-var flag selects between the GitHub App
// install flow and the OAuth App user-to-server flow on `/auth/start`.
//
// Default: `app` → `https://github.com/login/oauth/authorize?client_id=<GITHUB_APP_CLIENT_ID>`
// Override: `oauth-app` → `https://github.com/login/oauth/authorize?client_id=<GITHUB_OAUTH_CLIENT_ID>`
//
// Issue #155 / #153 — both branches now use the same authorize endpoint;
// they differ only by which `client_id` env var is read. Previously the
// `app` branch sent users to /apps/<slug>/installations/new, which broke
// the JIT-auth flow for non-admin users.
//
// AC 3.10 lists "OAuth-App fallback flag honored" as one of the five
// required Worker unit tests; this file is where that lives.
//
// We can't override env via `(exports as any).default.fetch` (it uses the global test
// bindings), so we call the worker's default export directly with a
// hand-crafted env. Cloudflare's vitest pool documents this pattern as
// the supported way to test per-request env permutations.

import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { handleAuthStart } from "../_shared/auth";

// `handleAuthStart` is the route's entire body (the route file at
// `functions/auth/start.ts` is a 3-line passthrough). Calling it directly
// with a custom env is the Pages-equivalent of slice 2's
// `worker.fetch(req, customEnv, ctx)` pattern — there is no way to override
// per-request env via the bundled Pages dispatcher because the test pool's
// `exports.default.fetch` is a native binding locked to the configured
// miniflare bindings.
const worker = {
  fetch: (req: Request, customEnv: unknown, _ctx: unknown): Promise<Response> =>
    handleAuthStart(req, customEnv as never) as Promise<Response>,
};

const STATE_COOKIE_NAME = "hashly_oauth_state";

async function startAuthWith(envOverrides: Record<string, unknown>): Promise<Response> {
  const customEnv = { ...env, ...envOverrides };
  const req = new Request("https://worker.test/auth/start");
  const res = await worker.fetch(req as unknown as never, customEnv as never, undefined);
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

  it("Location includes client_id from env.GITHUB_OAUTH_CLIENT_ID (AC 1.4 regression — NOT the App client id)", async () => {
    const res = await startAuthWith({ AUTH_METHOD: "oauth-app" });
    const url = new URL(res.headers.get("Location") ?? "");
    // vitest config injects "test-oauth-client-id".
    expect(url.searchParams.get("client_id")).toBe("test-oauth-client-id");
    // Issue #155 — must read the OAuth-App client id, NOT the new
    // GITHUB_APP_CLIENT_ID (which is a separate secret for the App's
    // own OAuth-style handshake under AUTH_METHOD=app).
    expect(url.searchParams.get("client_id")).not.toBe("test-github-app-client-id");
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

describe("/auth/start — default branch (AC 3.8 default = `app`, post-#155)", () => {
  it("AUTH_METHOD=app → Location is the OAuth authorize URL with GITHUB_APP_CLIENT_ID (AC 1.2/1.3)", async () => {
    // Issue #155 / #153 — `app` mode now uses GitHub's standard
    // /login/oauth/authorize endpoint (user-to-server), identifying
    // the App via env.GITHUB_APP_CLIENT_ID. The legacy
    // /apps/<slug>/installations/new redirect is gone (it broke
    // non-admin JIT-auth users).
    const res = await startAuthWith({ AUTH_METHOD: "app" });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("Location") ?? "");
    expect(url.host).toBe("github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-github-app-client-id");
    const state = url.searchParams.get("state");
    expect(state).not.toBeNull();
    expect(state!.length).toBeGreaterThanOrEqual(32);
    // Negative: the legacy install URL must not appear.
    const loc = res.headers.get("Location") ?? "";
    expect(loc).not.toContain("/installations/new");
    expect(loc).not.toContain("/apps/");
  });

  it("AUTH_METHOD undefined → defaults to `app` behavior (authorize URL, AC 1.2)", async () => {
    // Mimic a deployment that has not yet set the env var. The worker
    // should not 500 or pick an unknown branch — it must default to
    // the new authorize URL per AC 1.2.
    const overriddenEnv: Record<string, unknown> = { ...env };
    delete overriddenEnv.AUTH_METHOD;
    const req = new Request("https://worker.test/auth/start");
    const res = await worker.fetch(req as never, overriddenEnv as never, undefined);

    expect((res as Response).status).toBe(302);
    const url = new URL((res as Response).headers.get("Location") ?? "");
    expect(url.host).toBe("github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-github-app-client-id");
  });

  it("AUTH_METHOD=app and AUTH_METHOD=oauth-app produce different client_id values (AC 1.2 vs AC 1.4)", async () => {
    // Post-#155 the two branches share the same /login/oauth/authorize
    // path, so the cross-check now pins the discriminator: client_id.
    // Guards against a hypothetical regression where someone merges
    // the env reads (e.g., always reads GITHUB_OAUTH_CLIENT_ID).
    const appRes = await startAuthWith({ AUTH_METHOD: "app" });
    const oauthRes = await startAuthWith({ AUTH_METHOD: "oauth-app" });
    const appClient = new URL(appRes.headers.get("Location") ?? "").searchParams.get("client_id");
    const oauthClient = new URL(oauthRes.headers.get("Location") ?? "").searchParams.get("client_id");
    expect(appClient).toBe("test-github-app-client-id");
    expect(oauthClient).toBe("test-oauth-client-id");
    expect(appClient).not.toBe(oauthClient);
  });
});
