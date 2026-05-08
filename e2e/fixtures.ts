// Playwright fixture helpers — issue #159 / AC 5.7.
//
// Two helpers are exposed:
//   1. `signIn(page, scenario)` — drives the `PLAYWRIGHT_AUTH_STUB`
//      endpoint to install a fixture session cookie keyed to one of
//      four scenarios. Each scenario shapes the KV record + GitHub
//      proxy responses so spec files can declaratively pick a state.
//   2. `mockGitHubProxy(page, responses)` — registers
//      `page.route` interceptors for `/api/github/*` and `/api/save`
//      calls so specs don't depend on real GitHub. `responses` is a
//      map of route patterns to fixture payloads.
//
// Both helpers are pure-fixture — they don't depend on any production
// code paths beyond the auth-stub endpoint (gated by env flag).

import type { Page, Route } from "@playwright/test";

export type AuthScenario =
  | "happy" // signed-in user with push access on the fixture repo
  | "no-write" // signed-in user but only read access — view-only lock path
  | "conflict" // signed-in + push, but PR creation will conflict
  | "net-fail"; // signed-in + push, but network error on save

/**
 * Drive the auth-stub flow to obtain a `hashly_session` cookie.
 *
 * Navigates to `/__playwright/grant?scenario=<scenario>&return=/` which
 * the stub endpoint translates into a KV write + Set-Cookie + 302.
 * Awaits the redirected page so the caller can immediately interact
 * with the (now signed-in) UI.
 */
export async function signIn(
  page: Page,
  scenario: AuthScenario,
  returnTo: string = "/",
): Promise<void> {
  const state = `pw-${scenario}-${Date.now().toString(36)}`;
  const url = `/__playwright/grant?state=${encodeURIComponent(state)}&scenario=${encodeURIComponent(
    scenario,
  )}&return=${encodeURIComponent(returnTo)}`;
  // The stub endpoint Set-Cookies and 302s to `return` — Playwright
  // follows redirects by default so the final URL is `returnTo`.
  await page.goto(url);
}

export type MockResponses = {
  // Map of GitHub proxy path patterns (regex sources) → response
  // payloads. The `/api/github/` prefix is implicit — pass e.g.
  // `"repos/[^/]+/[^/]+/contents/.+"` to match a contents fetch.
  githubProxy?: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> }>;
  // Map for `/api/save`. Each entry is a queue of responses; one is
  // popped per request (so specs can verify a sequence). When a single
  // response is provided it's reused for every call.
  save?: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>;
  // Optional callback fired on each /api/save POST (rapid-Cmd+S
  // dedup test uses this to assert call count).
  onSave?: (request: Route["request"] extends () => infer R ? R : never) => void;
};

/**
 * Stub `/api/github/*` and `/api/save` so specs run hermetically.
 *
 * This intercepts in the browser via `page.route` — the worker still
 * mounts (so origin gates / cookie checks still execute), but outbound
 * GitHub calls are short-circuited at the browser→worker boundary.
 */
export async function mockGitHubProxy(
  page: Page,
  responses: MockResponses,
): Promise<{ saveCallCount: () => number }> {
  let saveCalls = 0;

  if (responses.githubProxy) {
    for (const [pattern, payload] of Object.entries(responses.githubProxy)) {
      const re = new RegExp(`/api/github/${pattern}$`);
      await page.route(re, async (route) => {
        await route.fulfill({
          status: payload.status ?? 200,
          headers: {
            "Content-Type": "application/json",
            ...(payload.headers ?? {}),
          },
          body: JSON.stringify(payload.body ?? {}),
        });
      });
    }
  }

  if (responses.save) {
    const queue = [...responses.save];
    await page.route("**/api/save", async (route) => {
      saveCalls++;
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      await route.fulfill({
        status: next.status ?? 200,
        headers: {
          "Content-Type": "application/json",
          ...(next.headers ?? {}),
        },
        body: JSON.stringify(next.body ?? {}),
      });
    });
  }

  return { saveCallCount: () => saveCalls };
}
