## Why

v0.3 deployed and v0.3.1 consolidated hosting onto Pages Functions, but the live URL is not yet pitch-ready: an already-installed user clicking `Edit` is stuck in a redirect loop (#153 — `/auth/callback` never fires), several user-visible failure paths are silent, and the public Worker surface lacks Origin/method gates that should land before we publicize the URL to tutorial authors. The vision says "after v0.3, push for the first tutorial mention" — v0.3.2 is the smallest set of fixes that lets us actually do that.

Out of scope, intentionally: deeper hardening (#99/#102/#112/#118), v0.1/v0.2 cosmetic follow-ups (#28–#83), three-way merge (#124), and any SDD-wedge feature work (deferred to v0.4 per vision).

## What Changes

**Auth correctness (blocker)**
- Fix #153: `handleAuthStart` under `AUTH_METHOD=app` SHALL redirect to GitHub's user-to-server OAuth authorize endpoint (`https://github.com/login/oauth/authorize?client_id=<APP_CLIENT_ID>&state=<nonce>`) instead of `/installations/new`, so already-installed users complete the OAuth round-trip and land on `/auth/callback` with `code` + `installation_id`. Adds new env var `GITHUB_APP_CLIENT_ID` (separate from existing `GITHUB_OAUTH_CLIENT_ID`).

**Security gates before publicizing the URL**
- #103: Add an Origin allow-list to the backend. State-changing requests (`POST /api/save`, `POST /api/github/*`, `POST /auth/logout`) SHALL reject requests whose `Origin` header is not in the allow-list (production Pages origin + preview-deploy pattern + localhost dev).
- #111: Method allow-list at the route layer — wrong-method requests SHALL return 405 (not 404, not SPA HTML — fixes #148 along the way), and the Origin check from #103 SHALL apply uniformly. Add `Cache-Control: no-store` on auth + API responses; cap `return` URL length on `/auth/start`.
- #105: URL-scheme sanitizer hardening for the viewer — block U+200B and other zero-width characters inside scheme prefixes, percent-encoded scheme bypasses (e.g. `j%61vascript:`), and add a MutationObserver re-sanitization pass so dynamically inserted links cannot smuggle disallowed schemes.

**UX polish that prevents tutorial-demo embarrassment**
- #119: Save UX polish — error copy clarity, dismissible banner, focus management after save, sign-in CTA when session expired, app-install link on permission-denied, Cmd+S parity with the Save button (in-flight guard via #55), clipboard-copy feedback on the PR URL, focus ring + contrast on the banner.
- #114: Edit-mode UX polish — preserve focus on mode toggle, surface redirect/loading feedback during JIT auth, refine copy on the view-only lock, recovery affordance from the lock screen, ARIA semantics on the editor host.
- #108: Viewer error/loading UX — `mountViewer` rejection is no longer silent; add a retry/back affordance, a loading state during fetch, and update `document.title` on failure.
- #117: Save banner icon needs `margin-right` (one-line fix; bundled because it lives in the same file).

**Deploy + setup closeout (carried from v0.3.1)**
- Close out #141 (local end-to-end verification), #142 (production deploy verification), and #98 (external-actions: GitHub App config, secret rotation, KV bindings) so the live URL is verified working before we publicize it.

**Browser-driven end-to-end testing (new)**
- Add Playwright as a third test runner alongside the existing Vitest jsdom (frontend unit) and `@cloudflare/vitest-pool-workers` (Pages Functions) suites. Playwright SHALL drive a real Chromium against `wrangler pages dev`, exercising the user-visible flows that jsdom can't credibly cover: anonymous viewer load, JIT-auth redirect handoff, Save success/conflict/permission-denied banners, view-only lock recovery, and the Origin/method gate from the browser side. Real GitHub OAuth is **not** exercised in Playwright — auth is stubbed at the `/auth/*` boundary so the suite runs deterministically in CI without a real GitHub App.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `github-app-backend`:
  - ADD a requirement that `AUTH_METHOD=app` SHALL use GitHub's user-to-server OAuth authorize endpoint, so already-installed users complete the round-trip back to `/auth/callback`. (Fixes #153; the current spec's "User installs the GitHub App on a repo" scenario implicitly assumed a fresh install every time.)
  - ADD a requirement that state-changing endpoints SHALL validate the request `Origin` against an allow-list and SHALL return 405 (not 404 / not SPA HTML) for unsupported methods on known routes. (#103, #111, #148.)
- `spec-link-viewer`:
  - MODIFY the URL-scheme allow-list requirement to make explicit that the sanitizer SHALL reject zero-width-character bypasses, percent-encoded scheme prefixes, and SHALL re-sanitize dynamically inserted links. (#105.)
  - ADD a requirement that viewer fetch failures SHALL surface a visible error state with a retry affordance, not a silent blank surface. (#108.)
- `spec-pr-editor`:
  - ADD requirements that the JIT-auth path SHALL surface visible loading/redirect feedback (not a silent navigation) and that the view-only lock screen SHALL provide a recovery affordance. (#114.)
  - ADD a requirement that the Save flow SHALL provide visible, dismissible feedback for success / conflict / permission-denied / network-error states, and SHALL guard against duplicate concurrent submissions. (#119, #55.)

## Impact

- **Code**:
  - `functions/_shared/auth.ts` — `handleAuthStart` redirect target swap; reads `GITHUB_APP_CLIENT_ID` from env.
  - `functions/_shared/env.ts` — add `GITHUB_APP_CLIENT_ID: string`.
  - New shared middleware (e.g. `functions/_shared/origin-gate.ts`) for Origin + method validation; applied to all `onRequestPost` handlers and to `/api/*`.
  - `src/sanitize.ts` (or wherever `sanitizeUrlAttributes` lives) — tighten regex, add normalization step, add MutationObserver hookup.
  - `src/save-flow.ts`, `src/edit-mode.ts`, `src/main.ts` (viewer error path), `src/styles/*` — UX polish slices for #108/#114/#117/#119.
- **Tests**:
  - `functions/__tests__/auth-start.test.ts` — assert new redirect target under `AUTH_METHOD=app`.
  - New `functions/__tests__/origin-gate.test.ts` — Origin allow-list + 405 coverage.
  - Viewer + editor jsdom tests for the new visible-feedback requirements.
  - Sanitizer tests for U+200B / percent-encoded / dynamic-insertion bypasses.
  - New Playwright suite under `e2e/` covering anonymous viewer, JIT-auth redirect (stubbed), Save banner outcomes, view-only lock recovery, and Origin/method gate rejection from the browser. Runs against `wrangler pages dev` locally and in CI.
- **Tooling / dev deps**:
  - Add `@playwright/test` to root devDeps. Add `npm run test:e2e` (Playwright) and a combined `npm run test:all` (Vitest + Playwright). Add a CI workflow step that boots `wrangler pages dev` and runs Playwright headlessly. Add `playwright/.cache` and `test-results/` to `.gitignore`.
- **Secrets / infrastructure**:
  - Add `GITHUB_APP_CLIENT_ID` to Pages production + preview env. Add to `.dev.vars.example`.
  - Operator: complete #98 external-actions (callback URL allowlist, KV bindings, secret rotation) and #141/#142 verification before merge-to-prod.
- **Documentation**:
  - `CLAUDE.md` — note the new env var; cross-reference the Origin allow-list as a deploy prerequisite.
  - `specs/hashly-vision.md` — add v0.3.2 entry under Horizon & shape; flip v0.3.1 to "shipped" when verified.
- **Out of scope (explicit)**: #99 / #102 / #112 / #118 deeper hardening; #28–#83 cosmetic v0.1/v0.2 follow-ups; #124 three-way merge; any SDD-wedge feature work. These stay open for v0.4 / later triage.
