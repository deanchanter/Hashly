// AC 3.9 — GET /health returns 200 (smoke endpoint).
//
// This is a behavioral test of the Worker's response, executed inside a real
// `workerd` runtime via `@cloudflare/vitest-pool-workers`. It deliberately
// uses `SELF.fetch(...)` so we test the deployed module-worker entrypoint
// (the thing Cloudflare actually runs), not an internal handler function.
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("GET /health", () => {
  it("returns 200", async () => {
    const res = await SELF.fetch("https://worker.test/health");
    expect(res.status).toBe(200);
  });

  it("responds to GET (not just any method)", async () => {
    const res = await SELF.fetch("https://worker.test/health", {
      method: "GET",
    });
    expect(res.status).toBe(200);
  });
});
