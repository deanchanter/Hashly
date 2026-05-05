import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, buildPagesASSETSBinding } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ephemeral RSA keypair for the GitHub App private-key binding — regenerated
// each `vitest` invocation. PKCS#8 PEM is what crypto.subtle.importKey('pkcs8')
// accepts; @octokit/auth-app accepts it as well. No checked-in secret.
const { privateKey: TEST_RSA_PRIVATE_KEY_PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: path.join(__dirname, "dist-functions/index.js"),
      miniflare: {
        compatibilityDate: "2025-01-01",
        compatibilityFlags: ["nodejs_compat"],
        kvNamespaces: ["SESSIONS"],
        bindings: {
          GITHUB_APP_ID: "123456",
          GITHUB_APP_SLUG: "hashly-test",
          GITHUB_APP_PRIVATE_KEY: TEST_RSA_PRIVATE_KEY_PEM,
          GITHUB_OAUTH_CLIENT_ID: "test-oauth-client-id",
          GITHUB_OAUTH_CLIENT_SECRET: "test-oauth-client-secret",
          SESSION_HMAC_KEY: "test-hmac-key-do-not-use-in-prod-do-not-use-in-prod",
          AUTH_METHOD: "app",
        },
        serviceBindings: {
          ASSETS: await buildPagesASSETSBinding(path.join(__dirname, "dist")),
        },
      },
    }),
  ],
  test: {
    include: ["functions/__tests__/**/*.test.ts"],
    globalSetup: ["./pages-test-setup.ts"],
    setupFiles: ["./functions/__tests__/setup.ts"],
  },
});
