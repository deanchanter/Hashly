import { generateKeyPairSync } from "node:crypto";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Cloudflare's recommended Vitest pool runs each test inside a real `workerd`
// instance — this is required for the Worker runtime APIs (Web Crypto,
// Request/Response semantics, Cloudflare bindings) to behave correctly.
// Plain Node Vitest cannot stand in for `workerd`.
//
// `miniflare.bindings` injects test-only env vars / bindings on top of
// whatever `wrangler.toml` declares. These values are deliberately fake;
// real secrets live only in `worker/.dev.vars` (gitignored) at dev time.
//
// We generate a fresh ephemeral RSA keypair per test run for the GitHub App
// private-key binding. PKCS#8 PEM is what `crypto.subtle.importKey('pkcs8')`
// natively accepts; `@octokit/auth-app` also accepts PKCS#8. No checked-in
// secret, no static keys to rotate.
const { privateKey: TEST_RSA_PRIVATE_KEY_PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            // GitHub App identity (used when AUTH_METHOD=app, the default)
            GITHUB_APP_ID: "123456",
            GITHUB_APP_SLUG: "hashly-test",
            // Ephemeral test PEM — re-generated each `vitest` invocation.
            GITHUB_APP_PRIVATE_KEY: TEST_RSA_PRIVATE_KEY_PEM,
            // OAuth App identity (used when AUTH_METHOD=oauth-app)
            GITHUB_OAUTH_CLIENT_ID: "test-oauth-client-id",
            GITHUB_OAUTH_CLIENT_SECRET: "test-oauth-client-secret",
            // Session signing key — opaque session IDs are HMACed with this.
            // Tests never send real GitHub tokens through the worker.
            SESSION_HMAC_KEY: "test-hmac-key-do-not-use-in-prod-do-not-use-in-prod",
            // Default auth mode; individual tests can override via
            // `withAuthMethod` or by spinning up a per-test config.
            AUTH_METHOD: "app",
          },
        },
      },
    },
  },
});
