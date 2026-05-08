// Issue #159 / AC 5.9 — JIT auth flow e2e.
//
// Pins the "click Edit while signed-out → bounce through /auth/start
// → land back signed-in → editor mounts in edit mode" round trip,
// exercised end-to-end via the PLAYWRIGHT_AUTH_STUB endpoint
// (`functions/__playwright/grant.ts`).

import { test, expect } from "@playwright/test";

const RAW_URL_PATTERN = /raw\.githubusercontent\.com/;

const FIXTURE_MARKDOWN = `# JIT auth fixture\n\nBody.\n`;

async function mockViewerFetch(page: import("@playwright/test").Page) {
  await page.route(RAW_URL_PATTERN, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: FIXTURE_MARKDOWN,
    }),
  );
}

async function mockGithubProxyPushAccess(page: import("@playwright/test").Page) {
  // `attemptEditAction` calls `fetch('/api/github/repos/<owner>/<name>')`
  // and reads `permissions.push`. Stub it to `true` so the flow falls
  // into the "allowed" branch and `enterEditMode` mounts.
  await page.route(/\/api\/github\/repos\/[^/]+\/[^/]+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        full_name: "example/repo",
        permissions: { push: true },
      }),
    }),
  );
}

test.describe("JIT auth (AC 5.9)", () => {
  test("Edit while signed-out → /auth/start → stub → editor mounts in edit mode", async ({
    page,
  }) => {
    await mockViewerFetch(page);
    await mockGithubProxyPushAccess(page);

    await page.goto("/?repo=example/repo&path=README.md&ref=main");
    await expect(page.locator("h1")).toContainText("JIT auth fixture");

    // Click the visible Edit button in the viewer header (primary
    // entry point). The flow:
    //   1. /api/session-status → 401 (no cookie yet)
    //   2. window.location.assign('/auth/start?return=<current href>')
    //   3. /auth/start (with PLAYWRIGHT_AUTH_STUB=1) → 302 to
    //      /__playwright/grant?scenario=happy
    //   4. grant endpoint sets hashly_session cookie, 302 to `return`
    //   5. bootstrap consumes PENDING_EDIT_KEY → attemptEditAction →
    //      session-status now 200 → enterEditMode mounts the toolbar.
    const editBtn = page.getByTestId("header-edit-button");
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // After the round-trip the edit toolbar must be present and the
    // post-auth prompt should announce the restore.
    await expect(page.getByTestId("edit-toolbar")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("post-auth-prompt")).toBeVisible();
  });

  test("already-signed-in user goes straight into edit mode (no redirect)", async ({
    page,
  }) => {
    await mockViewerFetch(page);
    await mockGithubProxyPushAccess(page);

    // Stamp a session cookie via the stub endpoint without bouncing
    // through /auth/start (no PENDING_EDIT_KEY, so no post-auth
    // prompt — the user is already signed in).
    await page.goto("/__playwright/grant?state=pre&scenario=happy&return=/");

    await page.goto("/?repo=example/repo&path=README.md&ref=main");
    await expect(page.locator("h1")).toContainText("JIT auth fixture");

    const editBtn = page.getByTestId("header-edit-button");
    await editBtn.click();

    await expect(page.getByTestId("edit-toolbar")).toBeVisible();
    // Already-signed-in path doesn't go through the bootstrap
    // restore branch, so the post-auth prompt MUST NOT render.
    await expect(page.getByTestId("post-auth-prompt")).toHaveCount(0);
  });

  // The AC also calls out a "redirecting…" indicator visible during
  // the bounce. The current bootstrap relies on the browser's native
  // navigation indicator; there's no in-DOM "redirecting" surface.
  // Marked fixme so the gap is loud if the team adds one.
  test.fixme("renders an in-DOM 'redirecting…' indicator during the bounce (AC 5.9 future UI)", async ({
    page,
  }) => {
    await mockViewerFetch(page);
    await page.goto("/?repo=example/repo&path=README.md&ref=main");
    const [indicator] = await Promise.all([
      page.waitForSelector('[data-testid="auth-redirecting"]', { timeout: 5_000 }),
      page.getByTestId("header-edit-button").click(),
    ]);
    expect(indicator).toBeTruthy();
  });
});
