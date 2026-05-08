_Shipped on 2026-05-08 via per-issue PRs to `main` (#165, #168, #170, #172, #174, #178) — sections 1–5 + 8. Sections 6 (manual e2e) and 7 (production env binding) remain open by design — they require a real GitHub App and Cloudflare Pages dashboard access._

## 1. Auth correctness — fix #153

- [x] 1.1 Add `GITHUB_APP_CLIENT_ID: string` to `functions/_shared/env.ts`. Add the same key to `.dev.vars.example` with a placeholder.
- [x] 1.2 In `functions/_shared/auth.ts`, change the `AUTH_METHOD=app` branch of `handleAuthStart` to redirect to `https://github.com/login/oauth/authorize?client_id=<GITHUB_APP_CLIENT_ID>&state=<nonce>` instead of `/installations/new`. Preserve the existing CSRF state-cookie round-trip exactly.
- [x] 1.3 Update `functions/__tests__/auth-start.test.ts` (and `auth-method-flag.test.ts`) so the `AUTH_METHOD=app` case asserts the new redirect target — `Location` host is `github.com`, path is `/login/oauth/authorize`, query contains a non-empty `client_id` and the state nonce.
- [x] 1.4 Add a regression test asserting the `oauth-app` branch is unchanged (still redirects to `/login/oauth/authorize` with `GITHUB_OAUTH_CLIENT_ID`).
- [x] 1.5 Confirm existing `auth-callback.test.ts` coverage still asserts that `code` + `installation_id` together produce a session. Add a scenario for `installation_id` present without prior install state (the already-installed user path).
- [x] 1.6 Run the full test suite and confirm green.

## 2. Origin + method gate — #103, #111, #148

- [x] 2.1 Create `functions/_shared/origin-gate.ts` exporting `enforceOriginAndMethod(request, { allowedMethods, allowedOrigins })` returning either `null` (pass) or a `Response` (rejection: 403 for Origin, 405 for method). Rejection responses include `Cache-Control: no-store` and no body.
- [x] 2.2 Resolve `allowedOrigins` from `env.ALLOWED_ORIGINS` (comma-separated string). Default value when unset: `https://hashly-md.pages.dev,http://localhost:8788`. Suffix-match `*.hashly-md.pages.dev` for preview deploys.
- [x] 2.3 Wire the helper into every `functions/auth/*.ts` and `functions/api/**.ts` handler. Each handler declares its allowed methods explicitly.
- [x] 2.4 Write `functions/__tests__/origin-gate.test.ts` covering: allowed origin passes; foreign origin returns 403; missing Origin returns 403; preview-pattern origin passes; wrong method on a known route returns 405; supported method passes; rejection responses set `Cache-Control: no-store`.
- [x] 2.5 Add per-route smoke tests asserting the gate is wired (one POST-with-foreign-origin assertion per state-changing handler).
- [x] 2.6 Confirm wrong-method requests no longer fall through to SPA HTML — assertion: `GET /api/save` returns 405, not `index.html` (closes #148).
- [x] 2.7 Run full test suite green.

## 3. Sanitizer hardening — #105

- [x] 3.1 Locate the existing `sanitizeUrlAttributes` (or equivalent) and its current scheme allow-list.
- [x] 3.2 Add a normalization step before scheme matching: lowercase, strip zero-width characters (`U+200B`, `U+200C`, `U+200D`, `U+FEFF`), percent-decode once. Re-check disallowed-scheme prefix on the normalized value.
- [x] 3.3 Hook a MutationObserver scoped to the read-only viewer surface that re-runs the sanitizer on inserted nodes and on attribute mutations of link-bearing elements.
- [x] 3.4 Add tests covering each bypass listed in the spec delta: plain `javascript:`, U+200B insertion, percent-encoded `j%61vascript:`, mixed-case `JaVaScRiPt:`, dynamically inserted disallowed-scheme link, and an allowed-scheme passthrough negative.
- [x] 3.5 Quick benchmark the MutationObserver under a realistic spec render — assert no measurable typing-latency regression in the editor (edit-mode path is separate; observer is viewer-scoped).
- [x] 3.6 Run full test suite green.

## 4. Banner primitive + viewer/editor/save UX — #108, #114, #117, #119, #55

- [x] 4.1 Create `src/ui/banner.ts` exporting `showBanner({ kind, message, action?, dismissible })`. Implement focus management, ARIA semantics (`role="status"` vs `role="alert"`), dismiss control, and a single CSS module for styling. Include the `margin-right` on the icon (#117) here.
- [x] 4.2 Add jsdom tests for the banner primitive: ARIA role per kind; dismiss control returns focus to a sensible target; `action` callback wiring.
- [x] 4.3 Refactor the Save flow (`src/save-flow.ts`) to use the banner primitive for success / conflict / permission-denied / network-error outcomes. Add the "copy details" affordance with success feedback (#119).
- [x] 4.4 Add an in-flight guard in the save flow: while a save is pending, disarm the Save button and the `Cmd+S` handler; subsequent submissions are dropped (#55, #119).
- [x] 4.5 Add Save-flow tests asserting: each outcome renders the banner with the right kind/message; ARIA role matches kind; rapid Cmd+S dispatches exactly one `POST /api/save`; banner dismiss returns focus to the editor.
- [x] 4.6 Refactor the edit-mode JIT-auth path (`src/edit-mode.ts`) so the redirect to GitHub surfaces a visible "redirecting…" indicator before navigation (#114).
- [x] 4.7 Add a "back to read-only view" recovery affordance on the view-only lock screen (#114). Add jsdom tests for both.
- [x] 4.8 Refactor the viewer error path (`src/main.ts` viewer fail branch) to use the banner primitive: visible error message, retry affordance, back-to-landing affordance, `document.title` update on failure (#108).
- [x] 4.9 Add a viewer loading state during fetch (#108). Add jsdom tests for the loading indicator and each error-state scenario in the spec delta.
- [x] 4.10 Run full test suite green.

## 5. Playwright e2e suite (new test layer)

- [x] 5.1 Add `@playwright/test` to root devDeps. Run `npx playwright install --with-deps chromium` in dev. Add `playwright/.cache` and `test-results/` to `.gitignore`.
- [x] 5.2 Create `playwright.config.ts` at root: `testDir: "./e2e"`, single `chromium` project, `webServer: { command: "npx wrangler pages dev --port 8788 ...", url: "http://localhost:8788/health", timeout: 120000, reuseExistingServer: !process.env.CI }`. Set `use.baseURL: "http://localhost:8788"`.
- [x] 5.3 Add `npm run test:e2e` (Playwright) and `npm run test:all` (Vitest then Playwright) to root `package.json`. Update `CLAUDE.md` `## Commands` to document both.
- [x] 5.4 Create `functions/__playwright/grant.ts` — the auth-stub endpoint. Returns 404 unless `env.PLAYWRIGHT_AUTH_STUB === "1"`. When enabled, accepts `?state=<nonce>&scenario=<happy|no-write|conflict|net-fail>`, writes a fixture session to KV, sets the `hashly_session` cookie, and 302s to the `return` URL. Add a fixture installation token whose proxy responses are served by route-mocking inside Playwright tests.
- [x] 5.5 Update `functions/_shared/auth.ts` `handleAuthStart` so that when `env.PLAYWRIGHT_AUTH_STUB === "1"`, the redirect target is `/__playwright/grant?state=<nonce>&scenario=<scenario>` instead of GitHub. Pass `scenario` through from a query param the test sets on `/auth/start`.
- [x] 5.6 Add a Vitest unit test `functions/__tests__/playwright-stub.test.ts` asserting that without `PLAYWRIGHT_AUTH_STUB=1` the stub endpoint returns 404 and `handleAuthStart` redirects to GitHub as normal. (This is the "stub never ships to prod" guardrail.)
- [x] 5.7 Add `e2e/fixtures.ts` with helpers: `signIn(page, scenario)` triggers the stubbed flow; `mockGitHubProxy(page, responses)` route-mocks `/api/github/*` and `/api/save` responses for a given scenario.
- [x] 5.8 Write `e2e/viewer.spec.ts`: anonymous viewer loads a known fixture spec; loading state is visible during fetch; viewer error state appears with retry + back-to-landing affordances on a mocked 5xx; one sanitizer smoke (a `javascript:` link is neutralized in the rendered DOM).
- [x] 5.9 Write `e2e/jit-auth.spec.ts`: clicking `Edit` while signed-out shows the "redirecting to GitHub…" indicator, then completes the stub flow, then mounts the editor in edit mode with focus restored. Already-installed user case (#153) is exercised via the stub.
- [x] 5.10 Write `e2e/save.spec.ts`: signed-in user with push access edits and saves → success banner with PR URL, copy-to-clipboard feedback, banner dismiss returns focus to the editor, ARIA `role="status"`. Conflict scenario → conflict banner with the right copy and `role="alert"`. Permission-denied scenario → banner with sign-in + install affordances. Network-failure scenario → banner with copy-details affordance. Rapid `Cmd+S` during in-flight save → exactly one `POST /api/save` (assert via mocked counter).
- [x] 5.11 Write `e2e/lock.spec.ts`: signed-in user without push access reaches the view-only lock; the "back to read-only view" affordance returns to the viewer without reload.
- [x] 5.12 Write `e2e/origin-gate.spec.ts`: from inside the page, run `page.evaluate` to issue a `fetch` to `/api/save` with a hand-crafted `Origin` header set to `https://evil.example` and assert 403; issue `GET /api/save` and assert 405.
- [x] 5.13 Add a CI workflow step (`.github/workflows/ci.yml` or equivalent) that installs Playwright browsers (cached), runs `npm test` first, then `npm run test:e2e` with `PLAYWRIGHT_AUTH_STUB=1` set in the env. Upload `test-results/` and `playwright-report/` as artifacts on failure.
- [ ] 5.14 Run `npm run test:all` locally and confirm both Vitest and Playwright suites are green. _Vitest is green locally (425 + 207). Playwright local run was blocked in the dev container by a wrangler EACCES on `~/.config`; CI runs it instead. After the wrangler `--binding`/`--kv` fix in #174, e2e is green except 5 `test.fixme` save tests blocked on #179 (real prod gap: `attemptEditAction` doesn't seed `baseSha`) and 4 stale fixmes whose affordances shipped in #172 (small follow-up sweep)._

## 6. Manual end-to-end verification (closes #141)

Playwright covers most of the regression surface; this section is for the things only a real GitHub App + real network can cover.

- [ ] 6.1 Run `npx wrangler pages dev` locally with `.dev.vars` populated (including the new `GITHUB_APP_CLIENT_ID`, no `PLAYWRIGHT_AUTH_STUB`). Verify anonymous viewer loads a public spec.
- [ ] 6.2 With the Hashly App already installed on a test account, click `Edit` and confirm the OAuth round-trip lands on `/auth/callback` with `code` + `installation_id` and a `hashly_session` cookie is set. (This is the #153 acceptance — only verifiable end-to-end against real GitHub.)
- [ ] 6.3 With a fresh account that does NOT have the App installed, click `Edit` and confirm GitHub prompts the install flow + OAuth, landing back on `/auth/callback` with a session.
- [ ] 6.4 Make a small edit and Save against a real test repo. Confirm a real PR is opened with the expected branch + commit shape.
- [ ] 6.5 Confirm logout clears the session and the next Edit click triggers a fresh sign-in.

## 7. External actions / production verification (closes #98 and #142)

- [ ] 7.1 In the GitHub App settings, copy the App's Client ID. Bind `GITHUB_APP_CLIENT_ID` as a non-secret env var on Pages prod and Pages preview.
- [ ] 7.2 If `ALLOWED_ORIGINS` deviates from defaults (e.g., a future custom domain), bind it on prod and preview.
- [ ] 7.3 Verify the GitHub App's "Request user authorization (OAuth) during installation" toggle is ON. Verify the User authorization callback URL allowlist contains `https://hashly-md.pages.dev/auth/callback` and a preview-deploy pattern.
- [ ] 7.4 Confirm `PLAYWRIGHT_AUTH_STUB` is **not** set on either Pages prod or preview env. (Belt-and-suspenders alongside the unit-test guardrail from 5.6.)
- [ ] 7.5 If any operator items from #98 remain (KV bindings, secret rotation, callback URL allowlist), complete them before merge-to-prod.
- [ ] 7.6 Push the v0.3.2 PR. CI runs Vitest + Playwright; both green required before merge.
- [ ] 7.7 On the preview deploy, repeat manual steps 6.1–6.5 against the preview URL.
- [ ] 7.8 Merge to `main`. On prod (`hashly-md.pages.dev`), repeat manual steps 6.1–6.5 against a real spec link in a real test repo.
- [ ] 7.9 If v0.3.1's deployed `hashly-worker` Worker is still up as a rollback target, confirm v0.3.2 prod is green for one full week before tearing it down (separate follow-up commit).

## 8. Documentation + vision

- [x] 8.1 Update `CLAUDE.md`: note the new `GITHUB_APP_CLIENT_ID` env var; document `ALLOWED_ORIGINS` and its default; document `PLAYWRIGHT_AUTH_STUB` (local + CI only, never prod); add `npm run test:e2e` and `npm run test:all` under `## Commands`; document the `e2e/` directory under `## Architecture`.
- [x] 8.2 Update `specs/hashly-vision.md` `## Horizon & shape` to add a v0.3.2 entry summarizing scope ("auth-loop fix, security gates, UX polish, Playwright e2e — pitch-ready"). Flip v0.3.1's status to "shipped <date>" if not already.
- [x] 8.3 Open follow-up issues for the explicit-out-of-scope items not already filed: triple-encoded path sanitizer hardening from #105 (deferred), v0.4 SDD-wedge PRD kickoff, and Playwright extensions for v0.4 (axe a11y audits, visual regression, mobile viewports, Playwright-against-preview-URL job for #142).
- [x] 8.4 Run `openspec validate v0-3-2-pitch-ready --strict` and confirm green before opening the milestone PR.
