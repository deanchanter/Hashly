// Typed environment bindings for the Hashly Worker.
//
// Bindings come from `wrangler.toml` (KV) and from `.dev.vars` / Cloudflare
// secrets at deploy time. The vitest pool injects fakes for tests via
// `miniflare.bindings` in `vitest.config.ts`.
export interface Env {
  SESSIONS: KVNamespace;
  GITHUB_APP_ID: string;
  GITHUB_APP_SLUG: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  SESSION_HMAC_KEY: string;
  AUTH_METHOD: "app" | "oauth-app";
  ALLOWED_ORIGINS?: string;
  // Issue #159 / AC 5.6 — Playwright auth-stub gate. Must remain undefined
  // in production. When the value is exactly the string "1" (and only "1"),
  // `/__playwright/grant` becomes reachable and `handleAuthStart` redirects
  // there instead of GitHub. Any other value MUST be inert.
  PLAYWRIGHT_AUTH_STUB?: string;
}
