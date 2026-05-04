import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Cloudflare's recommended Vitest pool runs each test inside a real `workerd`
// instance — this is required for the Worker runtime APIs (Web Crypto,
// Request/Response semantics, Cloudflare bindings) to behave correctly.
// Plain Node Vitest cannot stand in for `workerd`.
export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
