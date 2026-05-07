// Playwright e2e config — issue #159 / AC 5.2.
//
// Runs the full Hashly stack (static frontend + Pages Functions worker)
// via `wrangler pages dev`, exactly mirroring the Cloudflare Pages
// deployment. The webServer block is what makes `npm run test:e2e`
// self-contained: Playwright boots wrangler, waits for /health, then
// runs specs against http://localhost:8788.
//
// PLAYWRIGHT_AUTH_STUB=1 unlocks the auth-stub endpoint at
// /__playwright/grant — required for any spec that needs a signed-in
// session. CI sets this; local devs running test:e2e get it via the
// shell. See `e2e/fixtures.ts` for the helper that drives the stub.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8788",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npx wrangler pages dev --port 8788 dist",
    url: "http://localhost:8788/health",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PLAYWRIGHT_AUTH_STUB: process.env.PLAYWRIGHT_AUTH_STUB ?? "1",
    },
  },
});
