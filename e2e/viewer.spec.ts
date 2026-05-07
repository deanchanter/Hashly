// Issue #159 / AC 5.8 — anonymous viewer e2e.
//
// Pins the read-only viewer flow: load → render → error states → URL
// sanitizer smoke. Anonymous (no session cookie); the viewer fetches
// markdown from `raw.githubusercontent.com` directly so we route those
// URLs to local fixtures via `page.route`.

import { test, expect } from "@playwright/test";

const RAW_URL_PATTERN = /raw\.githubusercontent\.com/;

const FIXTURE_MARKDOWN = `# Hello e2e

This is a fixture spec used by the Playwright suite.

A normal link: [GitHub](https://github.com/example/repo).

A poisoned link: [click me](javascript:alert(1)).

\`\`\`js
console.log("hi");
\`\`\`
`;

test.describe("anonymous viewer (AC 5.8)", () => {
  test("loads a fixture spec and mounts the viewer", async ({ page }) => {
    await page.route(RAW_URL_PATTERN, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: FIXTURE_MARKDOWN,
      }),
    );

    await page.goto("/?repo=example/repo&path=README.md&ref=main");
    // Heading anchor is generated from the H1 text — see
    // `headingIdGenerator` in src/viewer.ts. Wait for it as proof
    // that the viewer mounted with the fetched content.
    await expect(page.locator("h1")).toContainText("Hello e2e");
    await expect(page).toHaveTitle(/README\.md — Hashly/);
  });

  test("shows an error surface (role=alert) when the spec fetch returns 5xx", async ({
    page,
  }) => {
    await page.route(RAW_URL_PATTERN, (route) =>
      route.fulfill({ status: 503, body: "service unavailable" }),
    );

    await page.goto("/?repo=example/repo&path=README.md&ref=main");
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/GitHub returned an unexpected status/i);
  });

  test("shows a not-found surface when the fetch returns 404", async ({ page }) => {
    await page.route(RAW_URL_PATTERN, (route) =>
      route.fulfill({ status: 404, body: "not found" }),
    );
    await page.goto("/?repo=example/repo&path=missing.md&ref=main");
    await expect(page.getByRole("alert")).toContainText(/couldn't find this spec/i);
  });

  // AC 5.8 explicitly calls out a "retry + back" affordance on the
  // viewer-error surface. The current `renderViewerError` only paints
  // copy — no actionable controls. Marked fixme so the gap is loud
  // when the team adds those buttons (issue #92 follow-up).
  test.fixme("viewer-error offers retry + back buttons (AC 5.8 future UI)", async ({
    page,
  }) => {
    await page.route(RAW_URL_PATTERN, (route) =>
      route.fulfill({ status: 503, body: "" }),
    );
    await page.goto("/?repo=example/repo&path=README.md&ref=main");
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /back/i })).toBeVisible();
  });

  test("sanitizer smoke — javascript: link href is neutralized in the DOM (AC 5.8)", async ({
    page,
  }) => {
    await page.route(RAW_URL_PATTERN, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: FIXTURE_MARKDOWN,
      }),
    );

    await page.goto("/?repo=example/repo&path=README.md&ref=main");
    await expect(page.locator("h1")).toContainText("Hello e2e");

    // Find every anchor; assert NONE carries a `javascript:` scheme.
    // The sanitizer rewrites unsafe schemes to `about:blank` (or
    // strips the href entirely). Either is acceptable; what we
    // forbid is a clickable javascript: payload.
    const hrefs = await page.$$eval("a[href]", (anchors) =>
      anchors.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    for (const href of hrefs) {
      expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
    }
  });

  test("invalid URL params land on the landing page error", async ({ page }) => {
    await page.goto("/?repo=invalid&path=foo.md");
    await expect(page.getByRole("alert")).toContainText(/owner\/name/i);
  });
});
