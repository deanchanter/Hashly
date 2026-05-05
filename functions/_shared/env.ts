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
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  SESSION_HMAC_KEY: string;
  AUTH_METHOD: "app" | "oauth-app";
}
