## Context

v0.3 shipped the web pivot (anonymous viewer + JIT-auth edit + PR-back save). v0.3.1 consolidated the standalone Worker into Pages Functions so frontend and backend share the `*.pages.dev` origin. The app now compiles and deploys cleanly, but field testing on `localhost:8788` against a real GitHub App surfaced a hard auth failure (#153) and the `git push`-then-publicize plan from the vision doc forced a security/UX re-read.

Three constraints shape v0.3.2:

1. **Don't reopen v0.3.1 mechanics.** Pages Functions, the route layout under `functions/`, the same-origin contract, the KV binding, and the `_shared/` helper convention are settled. v0.3.2 only edits *behavior* of those handlers.
2. **Don't expand surface area.** Vision says "after v0.3, push for the first tutorial mention." Anything that isn't a blocker for that pitch belongs in v0.4 or a triage bucket. The proposal's "out of scope" list is load-bearing — it's what keeps v0.3.2 small enough to ship in days.
3. **Real-`workerd` test coverage stays.** The `@cloudflare/vitest-pool-workers` Pages-mode setup from v0.3.1 is the test harness for new origin-gate / auth-redirect tests. No new test runtimes.

Stakeholders: solo build (deanchanter). Reviewers: the qa-tdd / builder / adversarial-reviewer agents during the ship-milestone loop.

## Goals / Non-Goals

**Goals**
- Already-installed users can click `Edit` and complete sign-in without uninstalling the App. (#153)
- The live `hashly-md.pages.dev` URL is safe to share publicly: state-changing endpoints reject unknown Origins; viewer sanitizer resists known bypasses; wrong-method requests don't return SPA HTML.
- A first-time visitor walking through view → edit → save sees no silent failures: every error path has visible copy and a recovery affordance.
- v0.3.1 deploy verification (#141, #142) and external setup (#98) are complete and recorded.
- A Playwright suite covers the user-visible flows in a real browser, runs in CI on every push, and is the load-bearing regression fence for v0.4 and beyond.

**Non-Goals**
- Deeper Worker hardening beyond Origin + method gates (#99, #112, #118 stay open).
- Three-way merge for stale-SHA conflicts (#124 stays open).
- Any v0.1/v0.2 cosmetic follow-ups (#28–#83) that aren't already on the embarrassment-in-a-demo path.
- SDD-native features: spec templates, frontmatter helpers, etc. — those define v0.4 and need their own PRD.
- Custom domain, analytics, multi-region. None of those block "tutorial author opens the URL and tries the demo."

## Decisions

### Decision 1: Use GitHub App user-to-server OAuth, not `/installations/new`

**What:** `handleAuthStart` under `AUTH_METHOD=app` redirects to `https://github.com/login/oauth/authorize?client_id=<GITHUB_APP_CLIENT_ID>&state=<nonce>` instead of `https://github.com/apps/<slug>/installations/new?state=<nonce>`.

**Why:** `/installations/new` is the *install* endpoint. GitHub only fires the OAuth round-trip on a fresh install; for users (or orgs) that already have the App installed, GitHub short-circuits to the management page and never invokes our `/auth/callback`. The user-to-server OAuth authorize endpoint works in both cases — fresh-install users get prompted to install before OAuth completes; already-installed users go straight through and we get `code` + `installation_id` on the callback. The existing `/auth/callback` already reads `installation_id`.

**Alternatives considered:**
- *Detect existing install client-side and skip `/auth/start`.* Rejected: requires another GitHub call before sign-in, leaks install state to the unauth frontend, and still needs a different redirect for the no-install case.
- *Document an "uninstall and retry" workaround.* Rejected: breaks the demo loop for any tutorial viewer who already installed the App, which is the exact audience we want.

**New env var:** `GITHUB_APP_CLIENT_ID` (separate from the existing `GITHUB_OAUTH_CLIENT_ID` used by `AUTH_METHOD=oauth-app`). Added to `.dev.vars.example` and bound to Pages prod + preview. CSRF state cookie round-trip is unchanged.

### Decision 2: One Origin/method gate, applied uniformly

**What:** A shared helper `functions/_shared/origin-gate.ts` exports `enforceOriginAndMethod(request, { allowedMethods, allowedOrigins })`. Every `onRequestPost` handler and the `/api/*` handlers call it first; mismatch returns 403 (Origin) or 405 (method) with no body, `Cache-Control: no-store`. Allowed origins come from `env.ALLOWED_ORIGINS` (comma-separated), defaulting to `https://hashly-md.pages.dev` plus `http://localhost:8788` in dev.

**Why:** Three issues (#103, #111, #148) all touch the same dispatch layer. Doing them as one helper avoids three separate per-route diffs, gives one test file (`functions/__tests__/origin-gate.test.ts`) that covers all routes, and makes the policy auditable in one place. Pages' filesystem routing means GET-only routes (e.g., `/auth/start`) currently fall through to SPA HTML for POSTs; the gate fixes this for free.

**Alternatives considered:**
- *Per-route hand-coded checks.* Rejected: invites drift; the whole point of the issues is "we forgot a check on route X."
- *CSRF token + Origin check.* Deferred: session cookie is already `SameSite=Lax`, which combined with Origin-allowlist is sufficient for v0.3.2's threat model. CSRF tokens belong in #99/#102 deeper hardening.

**Preview deploys:** `https://*.hashly-md.pages.dev` pattern is included via a small wildcard matcher in the gate (suffix match on `.hashly-md.pages.dev`). No regex eval on request data.

### Decision 3: Sanitizer hardening — normalize then match, plus MutationObserver

**What:** Update `sanitizeUrlAttributes`:
1. Normalize the `href`/`src` value before matching: lowercase, strip zero-width characters (`​-‍﻿`), percent-decode once, then re-check for the disallowed-scheme prefix.
2. Re-sanitize on DOM mutation: a viewer-scope MutationObserver watches for inserted `<a>`/`<img>`/`<source>`/etc. and reapplies the sanitizer.

**Why:** #105 lists U+200B and percent-encoded scheme bypasses as known evasions; the current sanitizer matches the raw attribute string. Normalize-then-match is the standard fix. The MutationObserver covers Milkdown's runtime insertions (paste, IME composition completion) that bypass the initial pass.

**Alternatives considered:**
- *Replace the hand-rolled sanitizer with DOMPurify.* Rejected for v0.3.2: pulls in a runtime dep, expands bundle size, and the surface we need to cover is small (allowlist of `http`, `https`, `mailto`, `#` anchors). Reconsider in v0.4 if the wedge work introduces user-controlled HTML beyond markdown.
- *Server-side sanitization in the worker.* Not applicable: the viewer fetches markdown from GitHub directly, not through the backend.

Triple-encoded paths from #105 are out of scope here — they're a markdown-renderer concern, not a scheme-bypass concern. Filed as a follow-up.

### Decision 4: UX polish via shared "feedback banner" primitive, not per-flow snowflakes

**What:** Introduce `src/ui/banner.ts` exporting `showBanner({ kind: 'success' | 'error' | 'info', message, action?, dismissible })`. Save flow (#119), edit-mode (#114), and viewer error (#108) all call it instead of each ad-hoc-ing their own DOM. Banner handles focus management, ARIA `role="status"` / `role="alert"`, dismiss button, and keyboard semantics in one place.

**Why:** Three issues with overlapping requirements (visible feedback, dismissible, ARIA, focus). Solving them once is cheaper than three times and prevents drift. Also makes #117's icon-spacing fix a one-line CSS change against a single component.

**Alternatives considered:**
- *Per-flow components.* Rejected: triples the test surface and guarantees inconsistent ARIA.
- *Use a UI library (e.g., shadcn).* Rejected for v0.3.2: not in the toolchain; introducing it is v0.4-shaped scope.

### Decision 5: Playwright as the third test layer, with auth stubbed at the boundary

**What:** Introduce Playwright as an `e2e/` suite alongside the existing two Vitest layers. Playwright drives Chromium (and optionally WebKit/Firefox) against a locally-booted `wrangler pages dev` server. The suite covers the user-visible paths that jsdom and the workerd pool can't credibly exercise together: anonymous viewer load with real Milkdown rendering, JIT-auth click → redirect handoff, Save flow with banner assertions, view-only lock recovery, viewer error/loading state transitions, and Origin/method gate rejection observed from the browser.

Auth is stubbed at the `/auth/*` boundary using a `PLAYWRIGHT_AUTH_STUB=1` env var that the Pages Functions read at startup: when set, `/auth/start` returns a synthetic 302 to a same-origin `/__playwright/grant?state=...` endpoint that immediately mints a session cookie via the same code path `/auth/callback` uses on success, with a fixture installation token. Real GitHub is never contacted. The stub is gated behind the env var so it cannot ship to production.

**Why:** The decision points stack:
- *Why Playwright over Cypress / wdio?* `@playwright/test` ships its own runner, has the cleanest `wrangler pages dev` integration (one `webServer` config entry), and supports parallel browsers without extra config. Cypress requires more dev-machine setup and its proxy model fights with `workerd`'s same-origin contract.
- *Why a third layer instead of expanding jsdom?* jsdom can't run real Milkdown reliably (ProseMirror's contenteditable behavior is browser-engine-specific), can't catch CSS/visual regressions, and can't exercise the `wrangler pages dev` request path. The new visible-feedback requirements (banners, focus management, ARIA) are exactly the kind of thing jsdom rubber-stamps but real users find broken.
- *Why stub auth instead of using a real test GitHub App?* Real OAuth in CI requires a dedicated test App with secrets in CI, plus a stable test GitHub user — more infrastructure than v0.3.2 wants to take on, and the OAuth round-trip itself is covered by the Vitest auth-start / auth-callback unit tests. Playwright's job is to verify the *frontend* given a successful (or failed) auth response, not to revalidate GitHub.
- *Why a stub endpoint and not Playwright route-mocking?* Route-mocking via `page.route()` works for outbound `fetch`, but the JIT-auth flow does a top-level navigation to `/auth/start` (302 → GitHub → 302 → `/auth/callback`). A real same-origin stub endpoint follows the actual production navigation contract; route-mocking would either require intercepting the navigation (fragile) or short-circuiting the redirect chain (changes the code path under test).

**What's covered, what isn't:**
- *Covered:* anonymous viewer happy path; sanitizer bypass smoke (one or two cases — exhaustive coverage stays in the unit tests); JIT-auth click → stub handoff → editor mounts in edit mode; Save success / conflict / permission-denied / network-error banners with focus + ARIA assertions; view-only lock recovery; Origin/method gate rejection from a `fetch` issued by an attacker-origin page (simulated via `page.evaluate`); Cmd+S in-flight guard.
- *Not covered:* real GitHub OAuth (Vitest unit-tested), real PR creation against a real repo (#141/#142 manual verification still required pre-merge), accessibility audits (deferred — `@axe-core/playwright` is v0.4-shaped scope), visual regression (deferred), mobile viewports (deferred).

**Stub endpoint details:** `functions/__playwright/grant.ts` exists only when `PLAYWRIGHT_AUTH_STUB === "1"`. It accepts `?state=<nonce>&scenario=<happy|no-write|conflict|net-fail>` and writes a fixture session to KV with the matching capability. The `scenario` parameter lets a single Playwright test trigger any save outcome without flaky network manipulation. The file is excluded from production builds via a `wrangler pages dev`-only check that returns 404 when the env var is unset, so even if the file ships, it's inert.

**Alternatives considered:**
- *Skip Playwright for v0.3.2; expand the manual checklist.* Rejected: manual checklists rot, and the new visible-feedback requirements specifically need keyboard/focus/ARIA assertions that humans miss.
- *Use Vitest browser mode instead of Playwright.* Rejected: still in 0.x stability for our tooling versions, and the `wrangler pages dev` integration story is unproven.
- *Run Playwright against the deployed preview URL instead of local `wrangler pages dev`.* Considered for #142 verification specifically; documented as a follow-up, but the core suite stays local for speed and offline-dev viability.

### Decision 6: External-actions / deploy verification belongs in the milestone, not after

**What:** #98, #141, #142 are tasks in v0.3.2's `tasks.md`, gated as the last items before merge-to-prod. The milestone PR is not mergeable until those tasks are checked.

**Why:** v0.3.1 left them open as "post-merge follow-ups" (#143). That's fine when the next milestone is "more code"; it's not fine when the next milestone is "publicize the URL." If we don't gate, we risk pitching a URL whose auth secrets weren't rotated or whose preview deploys can't run OAuth.

## Risks / Trade-offs

- **Risk:** `GITHUB_APP_CLIENT_ID` rollout drift — prod env updated, preview env forgotten.
  → **Mitigation:** A test in `auth-start.test.ts` asserts the redirect URL contains a non-empty `client_id`. Operator task explicitly lists both prod *and* preview bindings.
- **Risk:** Origin allow-list bricks legitimate flows during local dev or for a future custom-domain rollout.
  → **Mitigation:** `localhost:8788` is in the default allow-list. Custom-domain support is a one-line env var change, not a code change. Wildcard pattern is suffix-matched, not regex-evaluated.
- **Risk:** MutationObserver re-sanitizer fires on every Milkdown DOM update and degrades typing latency.
  → **Mitigation:** Observer is scoped to the viewer surface (read-only mode only) and to attribute changes on link-bearing elements; in edit mode the existing edit path is still authoritative. Quick benchmark in test.
- **Risk:** Banner primitive becomes a kitchen-sink — every future flow piles props onto it.
  → **Mitigation:** Keep the API to four props (kind, message, action, dismissible). Reject v0.4 additions unless they're earned.
- **Trade-off:** We're shipping Origin-gate without CSRF tokens. If `SameSite=Lax` enforcement degrades in a future browser (it won't, but never say never), we're exposed. Acceptable for v0.3.2; flag in #99 follow-up.
- **Trade-off:** Three-way merge (#124) is still deferred. Concurrent edits to non-overlapping regions of the same file will still conflict-fail. Acceptable: the demo loop is single-user.
- **Risk:** Playwright `webServer` boot of `wrangler pages dev` is flaky on CI cold starts (port allocation, KV-binding init).
  → **Mitigation:** Playwright config sets `webServer.timeout: 120_000` and `reuseExistingServer: !process.env.CI`. CI workflow boots the server in a separate step with a healthcheck loop hitting `/health` before invoking `playwright test`.
- **Risk:** The `__playwright/grant` stub endpoint accidentally ships to production and grants sessions to anyone.
  → **Mitigation:** Endpoint short-circuits to 404 unless `env.PLAYWRIGHT_AUTH_STUB === "1"`. The env var is bound only in local dev and the GitHub Actions test job — never on the Pages project. A unit test in `functions/__tests__/playwright-stub.test.ts` asserts the 404 path under default env.
- **Trade-off:** Playwright adds ~200MB of browser binaries to CI. Acceptable: cached across runs; first run is the slow one. If it bites, switch to the official Microsoft Playwright Docker image in CI to skip the install step.

## Migration Plan

v0.3.2 is in-place behavior changes — no data migration, no breaking client surface.

**Deploy order:**
1. Land code + tests on `milestone/v0-3-2-pitch-ready`.
2. Bind `GITHUB_APP_CLIENT_ID` to Pages prod + preview env (operator task; pre-merge).
3. Bind `ALLOWED_ORIGINS` if non-default values needed (operator task; pre-merge).
4. Verify on a preview deploy: anonymous viewer, sign-in (already-installed user), save, logout. (#141)
5. Merge to `main`. Production auto-deploys.
6. Verify on prod against a real spec link. (#142)
7. Update `specs/hashly-vision.md` v0.3.2 entry to "shipped".

**Rollback:** Single revert commit on `main`. KV namespace and secrets unchanged from v0.3.1; no rollback hazard there. The deployed `hashly-worker` (slated for `wrangler delete` post-v0.3.1) stays as the deeper rollback target until v0.3.2 is verified green.

## Open Questions

- Does GitHub App OAuth consent prompt the user on every sign-in, or remember consent? (Affects sign-in friction in the demo loop. Test during #141.)
- Is `localhost:8788` the right dev origin, or do we standardize on a different port for `wrangler pages dev`? (Doesn't block; just feeds the allow-list default.)
- Should v0.3.2 also turn on the Cloudflare Pages "preview deployments require auth" toggle to keep preview URLs out of search indexes? (Operator-side; no code impact.)
