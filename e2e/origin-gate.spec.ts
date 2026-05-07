// Issue #159 / AC 5.12 — origin + method gate (cross-pin to #156).
//
// `enforceOriginAndMethod` (functions/_shared/origin-gate.ts) is unit-
// tested at the worker boundary; this e2e check verifies the gate
// from a real browser context, exercising the full Pages routing
// stack so a regression in route mounting / preflight handling
// surfaces here.

import { test, expect } from "@playwright/test";

test.describe("origin + method gate on /api/save (AC 5.12)", () => {
  test("cross-origin POST is rejected with 403", async ({ page }) => {
    // Land on the same origin first so `fetch` runs with that
    // document's origin. Override the Origin header to a hostile
    // value — the worker must reject it regardless of body shape.
    await page.goto("/health");

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The worker reads `request.headers.get('Origin')`. Browser
          // semantics will normally set Origin automatically; setting
          // it explicitly here is a regression probe for the gate.
          Origin: "https://evil.example",
        },
        body: JSON.stringify({}),
      });
      return { status: res.status };
    });

    expect(result.status).toBe(403);
  });

  test("GET /api/save returns 405 (method not allowed)", async ({ page }) => {
    await page.goto("/health");
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/save", { method: "GET" });
      return { status: res.status };
    });
    expect(result.status).toBe(405);
  });

  test("same-origin POST passes the gate (does NOT 403)", async ({ page }) => {
    // Sanity branch: a normal in-app POST must reach the handler.
    // Without a session cookie the handler will return 401, and
    // without a body it might return 400 — what we forbid here is a
    // 403 (origin reject) or a 405 (method reject).
    await page.goto("/health");
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      return { status: res.status };
    });
    expect(result.status).not.toBe(403);
    expect(result.status).not.toBe(405);
  });
});
