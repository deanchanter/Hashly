// Issue #159 fix-loop — defense-in-depth guardrails on the Playwright
// auth stub. Adversarial-reviewer flagged 3 critical findings; this
// file pins the regression tests for all three.
//
// Threat model: the env-var gate (`PLAYWRIGHT_AUTH_STUB === "1"`) is
// a single point of failure. If a misconfigured Cloudflare Pages
// project, a copy-paste from a preview env, or an accidental commit
// to wrangler.toml ever leaks the flag to production, the stub would
// happily mint a forged session keyed to any user. These tests pin
// three independent secondary defenses so the flag-leak alone is
// insufficient to compromise the prod surface:
//
//   Crit 1 — hostname allowlist. Stub + handleAuthStart bypass MUST
//            check the request hostname is `localhost`, `127.0.0.1`,
//            or a `*.localhost` / preview-deploy pattern. The bare
//            production hostname (`hashly-md.pages.dev`) MUST NOT
//            unlock the stub even with the flag on.
//
//   Crit 3 — session ID namespace. Fixture sessions MUST be minted
//            with a `pw__` prefix. Any session reader (the canonical
//            one is `handleSessionStatus`) MUST refuse to recognize
//            a `pw__`-prefixed session ID unless the same gate
//            (flag + hostname) returns true.
//
//   Crit 2 — CSRF (state-cookie validation in the stub). Captured
//            in this file as a `describe.skip` block with explicit
//            test bodies so the gap is documented. Team-lead marked
//            this optional in the fix-loop directive; covered by
//            the hostname allowlist for prod, but a flag-enabled
//            preview deploy could still see CSRF-driven session
//            mints. Promote to active when the team chooses.

import { describe, it, expect } from "vitest";
import { handleAuthStart, handleSessionStatus } from "../_shared/auth";
import type { Env } from "../_shared/env";
import { onRequest as grantOnRequest } from "../__playwright/grant";

// In-memory KV stub so tests can exercise put/get without the pool's
// per-test reset machinery — these tests synthesize their own envs.
function makeKV() {
  const store = new Map<string, string>();
  return {
    namespace: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
      delete: async (k: string) => {
        store.delete(k);
      },
    } as unknown as KVNamespace,
    store,
  };
}

function makeEnv(
  overrides: Partial<Env & { PLAYWRIGHT_AUTH_STUB?: string }> = {},
  kv?: KVNamespace,
): Env & { PLAYWRIGHT_AUTH_STUB?: string } {
  const fallbackKV = kv ?? makeKV().namespace;
  return {
    SESSIONS: fallbackKV,
    GITHUB_APP_ID: "123456",
    GITHUB_APP_SLUG: "hashly-test",
    GITHUB_APP_PRIVATE_KEY: "",
    GITHUB_APP_CLIENT_ID: "test-github-app-client-id",
    GITHUB_OAUTH_CLIENT_ID: "test-oauth-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "test-oauth-client-secret",
    SESSION_HMAC_KEY: "test-hmac",
    AUTH_METHOD: "app",
    ALLOWED_ORIGINS: "https://hashly-md.pages.dev",
    ...overrides,
  } as Env & { PLAYWRIGHT_AUTH_STUB?: string };
}

function makeCtx(request: Request, env: Env & { PLAYWRIGHT_AUTH_STUB?: string }) {
  return {
    request,
    env,
    params: {},
    data: {},
    next: async () => new Response(null, { status: 404 }),
    waitUntil: () => {},
    passThroughOnException: () => {},
    functionPath: "/__playwright/grant",
  } as unknown as Parameters<typeof grantOnRequest>[0];
}

// Hostnames that must NOT be able to unlock the stub even with the
// flag set. The PROD hostname is the canonical concern; the others
// are defense-in-depth probes against pattern-matching mistakes.
const PROD_HOSTNAMES = [
  "hashly-md.pages.dev", // canonical prod
  "www.hashly-md.pages.dev", // www variant
  "evil.example.com", // arbitrary attacker-controlled
  "hashly.example", // a future custom domain — also prod-like
];

// Hostnames that MUST keep working with the flag set. These are the
// local-dev / preview-deploy patterns Playwright's webServer + CI
// preview deploys actually use.
const ALLOWED_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "test.localhost", // *.localhost
];

describe("Crit 1 — hostname allowlist (flag-leak defense)", () => {
  describe("/__playwright/grant", () => {
    for (const host of PROD_HOSTNAMES) {
      it(`returns 404 with PLAYWRIGHT_AUTH_STUB=1 when hostname is "${host}"`, async () => {
        const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" });
        const req = new Request(
          `https://${host}/__playwright/grant?state=x&scenario=happy&return=/`,
        );
        const res = await grantOnRequest(makeCtx(req, env));
        expect(
          res.status,
          `host=${host} must NOT unlock the stub even with the flag set`,
        ).toBe(404);
      });
    }

    for (const host of ALLOWED_HOSTNAMES) {
      it(`returns 3xx with PLAYWRIGHT_AUTH_STUB=1 when hostname is "${host}" (local dev path)`, async () => {
        const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" });
        const proto = host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")
          ? "http"
          : "https";
        const req = new Request(
          `${proto}://${host}:8788/__playwright/grant?state=x&scenario=happy&return=/`,
        );
        const res = await grantOnRequest(makeCtx(req, env));
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
      });
    }
  });

  describe("handleAuthStart stub-redirect bypass", () => {
    for (const host of PROD_HOSTNAMES) {
      it(`redirects to github.com (NOT /__playwright/grant) with flag=1 when hostname is "${host}"`, async () => {
        const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" });
        const req = new Request(`https://${host}/auth/start?scenario=happy`);
        const res = await handleAuthStart(req, env);
        expect(res.status).toBe(302);
        const loc = new URL(res.headers.get("Location") ?? "");
        expect(
          loc.host,
          `host=${host} must redirect to github.com even with flag set`,
        ).toBe("github.com");
        expect(loc.pathname).toBe("/login/oauth/authorize");
      });
    }

    it('redirects to /__playwright/grant when flag=1 AND hostname is localhost (local dev still works)', async () => {
      const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" });
      const req = new Request("http://localhost:8788/auth/start?scenario=no-write");
      const res = await handleAuthStart(req, env);
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get("Location") ?? "", "http://localhost:8788");
      expect(loc.pathname).toBe("/__playwright/grant");
      expect(loc.searchParams.get("scenario")).toBe("no-write");
    });
  });
});

describe("Crit 3 — session ID namespace prefix (pw__)", () => {
  it("the stub mints session IDs prefixed with `pw__`", async () => {
    const { namespace, store } = makeKV();
    const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" }, namespace);
    const req = new Request(
      "http://localhost:8788/__playwright/grant?state=x&scenario=happy&return=/",
    );
    const res = await grantOnRequest(makeCtx(req, env));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);

    // Cookie value carries the session ID; KV write uses the same key.
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    const match = /hashly_session=([^;]+)/.exec(setCookie);
    expect(match, "Set-Cookie must include hashly_session=<id>").not.toBeNull();
    const sessionId = match![1] ?? "";
    expect(sessionId.startsWith("pw__")).toBe(true);

    // KV write key matches the cookie value.
    expect(store.has(sessionId)).toBe(true);
    // No collision with prod-shape (un-prefixed) IDs in the same KV.
    for (const key of store.keys()) {
      expect(key.startsWith("pw__")).toBe(true);
    }
  });

  it("handleSessionStatus refuses pw__-prefixed session IDs when PLAYWRIGHT_AUTH_STUB is unset (production default)", async () => {
    // Arrange: a pw__-prefixed record already in KV (e.g. left over
    // from a flag-enabled preview deploy whose flag was later removed
    // — the cookie may still be in user agents).
    const { namespace, store } = makeKV();
    store.set(
      "pw__forged-session-id",
      JSON.stringify({
        access_token: "stolen-token",
        installation_id: "0",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        user: { login: "attacker", avatar_url: "https://evil.example/x.png" },
      }),
    );
    const env = makeEnv({}, namespace); // flag undefined — production default

    const req = new Request("https://hashly-md.pages.dev/api/session-status", {
      headers: { Cookie: "hashly_session=pw__forged-session-id" },
    });
    const res = await handleSessionStatus(req, env);
    expect(res.status).toBe(401);
  });

  it("handleSessionStatus refuses pw__-prefixed session IDs even with flag=1 if hostname is prod", async () => {
    const { namespace, store } = makeKV();
    store.set(
      "pw__leaked-session",
      JSON.stringify({
        access_token: "x",
        installation_id: "0",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );
    const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" }, namespace);

    const req = new Request("https://hashly-md.pages.dev/api/session-status", {
      headers: { Cookie: "hashly_session=pw__leaked-session" },
    });
    const res = await handleSessionStatus(req, env);
    expect(res.status).toBe(401);
  });

  it("handleSessionStatus accepts pw__-prefixed session IDs ONLY with flag=1 AND allowed hostname", async () => {
    const { namespace, store } = makeKV();
    store.set(
      "pw__local-dev-session",
      JSON.stringify({
        access_token: "fixture",
        installation_id: "0",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        user: { login: "hashly-e2e-user", avatar_url: "https://example.test/x.png" },
      }),
    );
    const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" }, namespace);

    const req = new Request("http://localhost:8788/api/session-status", {
      headers: { Cookie: "hashly_session=pw__local-dev-session" },
    });
    const res = await handleSessionStatus(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; user?: { login: string } };
    expect(body.ok).toBe(true);
    expect(body.user?.login).toBe("hashly-e2e-user");
  });

  it("handleSessionStatus continues to accept un-prefixed (production-shape) session IDs in production", async () => {
    // Regression check: the prefix-refusal logic must NOT break the
    // canonical prod path. A real user with a real un-prefixed
    // session (minted by /auth/callback) must still resolve to 200.
    const { namespace, store } = makeKV();
    store.set(
      "real-session-id-no-prefix",
      JSON.stringify({
        access_token: "real-token",
        installation_id: "999",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        user: { login: "real-user", avatar_url: "https://avatars.githubusercontent.com/x" },
      }),
    );
    const env = makeEnv({}, namespace); // production default

    const req = new Request("https://hashly-md.pages.dev/api/session-status", {
      headers: { Cookie: "hashly_session=real-session-id-no-prefix" },
    });
    const res = await handleSessionStatus(req, env);
    expect(res.status).toBe(200);
  });
});

// Crit 2 — CSRF in the stub. Team-lead marked optional; pinning the
// shape of the eventual test here so the gap stays visible in the
// suite output. Promote `describe.skip` → `describe` when the team
// decides to land state-cookie validation in the stub.
describe.skip("Crit 2 — stub state-cookie CSRF validation (optional, deferred)", () => {
  it("rejects requests where the URL state does not match the state cookie", async () => {
    const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" });
    const req = new Request(
      "http://localhost:8788/__playwright/grant?state=url-state&scenario=happy&return=/",
      { headers: { Cookie: "hashly_oauth_state=cookie-state-mismatch" } },
    );
    const res = await grantOnRequest(makeCtx(req, env));
    expect(res.status).toBe(400);
  });

  it("rejects requests with no state cookie at all", async () => {
    const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" });
    const req = new Request(
      "http://localhost:8788/__playwright/grant?state=x&scenario=happy",
    );
    const res = await grantOnRequest(makeCtx(req, env));
    expect(res.status).toBe(400);
  });
});
