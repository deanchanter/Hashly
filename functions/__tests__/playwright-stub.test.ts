// Issue #159 / AC 5.6 — **CRITICAL guardrail**: the Playwright auth-stub
// MUST NEVER be active in production.
//
// Two invariants are pinned here so a regression in either causes a
// hard test failure (and a hard CI red):
//
//   1. `/__playwright/grant` returns 404 unless `env.PLAYWRIGHT_AUTH_STUB`
//      is exactly the string `"1"`. Any other value (undefined, "", "0",
//      "true", "yes") MUST behave as if the endpoint does not exist.
//
//   2. `handleAuthStart` MUST redirect to GitHub's normal authorize URL
//      when `env.PLAYWRIGHT_AUTH_STUB` is not `"1"`. The stub redirect
//      target (`/__playwright/grant`) is gated on the same flag — so a
//      production env (where the var is unset) gets the real GitHub
//      flow, every time.
//
// These tests are unit-style: they import the handler functions directly
// and invoke them with synthesized env shapes, so the assertions don't
// depend on the vitest pool's binding fixtures (which deliberately leave
// PLAYWRIGHT_AUTH_STUB undefined to mirror prod).

import { describe, it, expect } from "vitest";
import { handleAuthStart } from "../_shared/auth";
import type { Env } from "../_shared/env";
// The stub handler — file does not yet exist; importing it is itself a
// red signal until the builder lands `functions/__playwright/grant.ts`.
import { onRequest as grantOnRequest } from "../__playwright/grant";

// Build a baseline env that mirrors `vitest.pages.config.ts` bindings
// minus PLAYWRIGHT_AUTH_STUB. Tests then layer the flag on top.
function makeEnv(overrides: Partial<Env & { PLAYWRIGHT_AUTH_STUB?: string }> = {}) {
  const base = {
    SESSIONS: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as unknown as KVNamespace,
    GITHUB_APP_ID: "123456",
    GITHUB_APP_SLUG: "hashly-test",
    GITHUB_APP_PRIVATE_KEY: "",
    GITHUB_APP_CLIENT_ID: "test-github-app-client-id",
    GITHUB_OAUTH_CLIENT_ID: "test-oauth-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "test-oauth-client-secret",
    SESSION_HMAC_KEY: "test-hmac",
    AUTH_METHOD: "app" as const,
    ALLOWED_ORIGINS: "https://worker.test",
  };
  return { ...base, ...overrides } as Env & { PLAYWRIGHT_AUTH_STUB?: string };
}

function makeCtx(request: Request, env: Env & { PLAYWRIGHT_AUTH_STUB?: string }) {
  // Minimal Pages Function context shape — only `request` and `env`
  // are read by the stub handler.
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

describe("AC 5.6 — Playwright stub guardrail (stub never ships to prod)", () => {
  describe("/__playwright/grant — 404 unless PLAYWRIGHT_AUTH_STUB === '1'", () => {
    it("returns 404 when env.PLAYWRIGHT_AUTH_STUB is undefined (production default)", async () => {
      const env = makeEnv();
      const req = new Request("https://worker.test/__playwright/grant?state=x&scenario=happy");
      const res = await grantOnRequest(makeCtx(req, env));
      expect(res.status).toBe(404);
    });

    it('returns 404 when env.PLAYWRIGHT_AUTH_STUB is the empty string', async () => {
      const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "" });
      const req = new Request("https://worker.test/__playwright/grant?state=x&scenario=happy");
      const res = await grantOnRequest(makeCtx(req, env));
      expect(res.status).toBe(404);
    });

    it('returns 404 when env.PLAYWRIGHT_AUTH_STUB is "0"', async () => {
      const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "0" });
      const req = new Request("https://worker.test/__playwright/grant?state=x&scenario=happy");
      const res = await grantOnRequest(makeCtx(req, env));
      expect(res.status).toBe(404);
    });

    it('returns 404 for truthy-but-not-exact values like "true" or "yes"', async () => {
      // Belt-and-suspenders: the gate is `=== "1"`, not a JS truthy check.
      // A misconfigured deploy that sets the var to "true" should still
      // be inert.
      for (const flag of ["true", "yes", "TRUE", "1 ", " 1"]) {
        const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: flag });
        const req = new Request("https://worker.test/__playwright/grant?state=x&scenario=happy");
        const res = await grantOnRequest(makeCtx(req, env));
        expect(res.status, `flag=${JSON.stringify(flag)} must yield 404`).toBe(404);
      }
    });

    it('redirects (3xx) when env.PLAYWRIGHT_AUTH_STUB === "1"', async () => {
      // Sanity branch — confirms the handler isn't unconditionally 404.
      // The full stub behavior (KV write, cookie, return URL) lives in
      // a Playwright-driven e2e test. Here we just pin the gate.
      const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" });
      const req = new Request(
        "https://worker.test/__playwright/grant?state=abc&scenario=happy&return=/",
      );
      const res = await grantOnRequest(makeCtx(req, env));
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.status).toBeLessThan(400);
    });
  });

  describe("handleAuthStart — bypass-stub gate", () => {
    it("redirects to github.com when env.PLAYWRIGHT_AUTH_STUB is undefined", async () => {
      const env = makeEnv();
      const req = new Request("https://worker.test/auth/start");
      const res = await handleAuthStart(req, env);
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get("Location") ?? "");
      expect(loc.host).toBe("github.com");
      expect(loc.pathname).toBe("/login/oauth/authorize");
    });

    it("redirects to github.com when env.PLAYWRIGHT_AUTH_STUB is the empty string", async () => {
      const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "" });
      const req = new Request("https://worker.test/auth/start");
      const res = await handleAuthStart(req, env);
      const loc = new URL(res.headers.get("Location") ?? "");
      expect(loc.host).toBe("github.com");
    });

    it('redirects to /__playwright/grant when env.PLAYWRIGHT_AUTH_STUB === "1"', async () => {
      // Sanity: with the flag on, the redirect target swings to the
      // local stub. The scenario query param threads through so
      // `/__playwright/grant` knows which fixture session to mint.
      const env = makeEnv({ PLAYWRIGHT_AUTH_STUB: "1" });
      const req = new Request("https://worker.test/auth/start?scenario=no-write");
      const res = await handleAuthStart(req, env);
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get("Location") ?? "", "https://worker.test");
      expect(loc.pathname).toBe("/__playwright/grant");
      expect(loc.searchParams.get("scenario")).toBe("no-write");
    });
  });
});
