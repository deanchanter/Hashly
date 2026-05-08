// Issue #159 / AC 5.11 — view-only lock e2e.
//
// Pins the "signed-in but no push access" branch: clicking Edit
// surfaces the view-only lock banner instead of the editor toolbar.

import { test, expect } from "@playwright/test";

const RAW_URL_PATTERN = /raw\.githubusercontent\.com/;
const FIXTURE_MARKDOWN = `# Lock fixture\n\nBody.\n`;

test.describe("view-only lock (AC 5.11)", () => {
  test("signed-in user with no push access lands on the view-only lock", async ({
    page,
  }) => {
    await page.route(RAW_URL_PATTERN, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: FIXTURE_MARKDOWN,
      }),
    );
    // Crucial: `permissions.push === false` is the deterministic-deny
    // signal. Anything else (missing field, 4xx) routes through the
    // 'unknown' branch (still locked, but with retryable listener).
    await page.route(/\/api\/github\/repos\/[^/]+\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ permissions: { push: false } }),
      }),
    );

    // Stamp the signed-in cookie via the stub (no-write scenario for
    // documentation; the lock decision lives on the GitHub proxy
    // response, not on the session record).
    await page.goto("/__playwright/grant?state=pre&scenario=no-write&return=/");

    await page.goto("/?repo=example/repo&path=README.md&ref=main");
    await expect(page.locator("h1")).toContainText("Lock fixture");

    await page.getByTestId("header-edit-button").click();

    const lock = page.getByTestId("view-only-lock");
    await expect(lock).toBeVisible();
    await expect(lock).toContainText(/view-only/i);
    // The editor toolbar must NOT have mounted — the user still sees
    // the read-only viewer.
    await expect(page.getByTestId("edit-toolbar")).toHaveCount(0);
  });

  // AC 5.11 calls out a "back to read-only view" affordance that
  // returns to the viewer without a full reload. The current
  // `renderViewOnlyLock` (src/edit-mode.ts:449) renders only static
  // copy. Marked fixme so the future UI work is visible from the
  // e2e suite.
  test.fixme(
    "view-only lock offers a 'back to read-only view' button that does not reload (AC 5.11 future UI)",
    async ({ page }) => {
      await page.route(RAW_URL_PATTERN, (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: FIXTURE_MARKDOWN,
        }),
      );
      await page.route(/\/api\/github\/repos\/[^/]+\/[^/]+$/, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ permissions: { push: false } }),
        }),
      );
      await page.goto("/__playwright/grant?state=pre&scenario=no-write&return=/");
      await page.goto("/?repo=example/repo&path=README.md&ref=main");
      await page.getByTestId("header-edit-button").click();

      // Mark the document so we can detect a navigation/reload.
      await page.evaluate(() => {
        (window as unknown as { __noReloadSentinel: boolean }).__noReloadSentinel = true;
      });

      await page
        .getByRole("button", { name: /back to read-only/i })
        .click();

      await expect(page.getByTestId("view-only-lock")).toHaveCount(0);
      const stillThere = await page.evaluate(
        () => (window as unknown as { __noReloadSentinel?: boolean }).__noReloadSentinel,
      );
      expect(stillThere).toBe(true);
    },
  );
});
