// Issue #159 / AC 5.10 — Save flow e2e.
//
// Pins the four save outcomes (success, conflict, permission-denied,
// network-failure) and the rapid-Cmd+S / double-click dedup invariant
// (exactly one POST per in-flight save).

import { test, expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const RAW_URL_PATTERN = /raw\.githubusercontent\.com/;
const FIXTURE_MARKDOWN = `# Save flow fixture\n\nBody.\n`;

async function mountSignedInEditor(page: Page) {
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
      body: JSON.stringify({ permissions: { push: true } }),
    }),
  );

  // Stamp the session cookie via the stub.
  await page.goto("/__playwright/grant?state=pre&scenario=happy&return=/");

  await page.goto("/?repo=example/repo&path=README.md&ref=main");
  await expect(page.locator("h1")).toContainText("Save flow fixture");
  await page.getByTestId("header-edit-button").click();
  await expect(page.getByTestId("edit-toolbar")).toBeVisible();
}

test.describe("save flow (AC 5.10)", () => {
  test("success → save-success banner with PR URL + role=status", async ({ page }) => {
    await mountSignedInEditor(page);

    let saveCalls = 0;
    await page.route("**/api/save", (route) => {
      saveCalls++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          prUrl: "https://github.com/example/repo/pull/42",
        }),
      });
    });

    await page.getByTestId("edit-toolbar-save").click();

    const banner = page.getByTestId("save-success");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "status");
    await expect(banner.getByRole("link", { name: /pull request/i })).toHaveAttribute(
      "href",
      "https://github.com/example/repo/pull/42",
    );
    expect(saveCalls).toBe(1);
  });

  test("conflict → save-conflict banner with role=alert + Copy + Reload affordances", async ({
    page,
  }) => {
    await mountSignedInEditor(page);
    await page.route("**/api/save", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          kind: "conflict",
          message: "your edit and an upstream change overlap; please reload",
        }),
      }),
    );

    await page.getByTestId("edit-toolbar-save").click();

    const banner = page.getByTestId("save-conflict");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner.getByRole("button", { name: /copy/i })).toBeVisible();
    await expect(banner.getByRole("button", { name: /reload/i })).toBeVisible();
  });

  test("permission-denied (no-write) → save-error banner with the worker's message", async ({
    page,
  }) => {
    await mountSignedInEditor(page);
    await page.route("**/api/save", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          kind: "no-write",
          message: "You don't have write access to this repository.",
        }),
      }),
    );

    await page.getByTestId("edit-toolbar-save").click();

    const banner = page.getByTestId("save-error");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner).toContainText(/write access/i);
  });

  test("network-failure → save-error banner with transient-friendly copy", async ({
    page,
  }) => {
    await mountSignedInEditor(page);
    await page.route("**/api/save", (route) => route.abort("failed"));

    await page.getByTestId("edit-toolbar-save").click();

    const banner = page.getByTestId("save-error");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/couldn't reach the server/i);
  });

  test("rapid double-click on Save → exactly one POST /api/save in flight", async ({
    page,
  }) => {
    // Dedup invariant — `pendingSaves` map in src/edit-mode.ts gates
    // a second click while the first is in flight. We hold the
    // response open with a Promise the test resolves manually so the
    // second click is guaranteed to fire while the first is pending.
    await mountSignedInEditor(page);

    let saveCalls = 0;
    let releaseFirst: ((route: Route) => Promise<void>) | null = null;
    const firstHandled = new Promise<Route>((resolve) => {
      releaseFirst = async (route: Route) => resolve(route);
    });

    await page.route("**/api/save", async (route) => {
      saveCalls++;
      if (saveCalls === 1) {
        // Park the first request — don't fulfill yet.
        await releaseFirst!(route);
      } else {
        // Any subsequent call (regression!) gets a sentinel response
        // so we can detect it cleanly.
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, prUrl: "https://github.com/x/y/pull/2" }),
        });
      }
    });

    const saveBtn = page.getByTestId("edit-toolbar-save");
    await saveBtn.click();
    // Click again immediately. The disabled-while-saving UI will gate
    // the second event from the button itself, BUT the dedup layer
    // also lives in the click handler (`pendingSaves`). Forcing the
    // click bypasses the disabled gate so we exercise the handler-
    // level dedup invariant from AC 5.10.
    await saveBtn.click({ force: true }).catch(() => {});

    const parked = await firstHandled;
    // Resolve the first request now.
    await parked.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, prUrl: "https://github.com/example/repo/pull/1" }),
    });

    await expect(page.getByTestId("save-success")).toBeVisible();
    expect(saveCalls).toBe(1);
  });

  // AC 5.10 also enumerates "copy-clipboard feedback" and "dismiss
  // returns focus" affordances on the success banner, plus
  // "copy-details" on the network error. The current banners (see
  // src/save-result.ts) don't render those controls — only the
  // conflict banner has Copy+Reload. Marked fixme so future work is
  // visible from the e2e suite.
  test.fixme("save-success offers a Copy / Dismiss control set (AC 5.10 future UI)", async ({
    page,
  }) => {
    await mountSignedInEditor(page);
    await page.route("**/api/save", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, prUrl: "https://github.com/example/repo/pull/9" }),
      }),
    );
    await page.getByTestId("edit-toolbar-save").click();
    await expect(page.getByRole("button", { name: /copy/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /dismiss/i })).toBeVisible();
  });
});
