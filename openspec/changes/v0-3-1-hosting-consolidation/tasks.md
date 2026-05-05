## 1. Prerequisites — clean the workspace

- [ ] 1.1 Delete the `worker/` directory entirely from the repo (source, tests, `package.json`, `wrangler.toml`, `tsconfig.json`, `vitest.config.ts`, `node_modules` if present). Spike (design.md Decision 4) verified that leaving the workspace in place poisons `npm install` for the upgraded pool.
- [ ] 1.2 Remove the `"workspaces": ["worker"]` entry from root `package.json`.
- [ ] 1.3 Delete root `package-lock.json` and `node_modules/`, then `npm install` to confirm a clean re-resolve at the root with no worker-side hoisting collisions.

## 2. Dependency bumps

- [ ] 2.1 Add `@cloudflare/vitest-pool-workers@^0.16.0` to root `devDependencies`.
- [ ] 2.2 Bump root `wrangler` from `^4.87.0` to `^4.88.0` (matches what pool 0.16.0 ships with).
- [ ] 2.3 Run `npm install` and verify hoisted `node_modules/@vitest/pretty-format` resolves to `^4.1.x` (not 3.x — that's the spike-confirmed failure mode).
- [ ] 2.4 Update `CLAUDE.md` `## Commands` section: drop `cd worker && npm test` and `cd worker && npx wrangler deploy`; replace with single `npm test` and `git push` deploy.

## 3. Pages Functions scaffold

- [ ] 3.1 Create `functions/_shared/env.ts` — port `Env` interface from `worker/src/env.ts`.
- [ ] 3.2 Create `functions/_shared/auth.ts` — port helper functions from `worker/src/auth.ts` that are imported by other modules (e.g., `parseCookieHeader`).
- [ ] 3.3 Create `functions/_shared/proxy.ts` — port `handleGitHubProxy` body from `worker/src/proxy.ts`.
- [ ] 3.4 Create `functions/_shared/save.ts` — port `handleSave` body from `worker/src/save.ts`.
- [ ] 3.5 Create stub `functions/health.ts` exporting `onRequest` returning 200 "ok" (matches v0.3 worker `GET /health`).

## 4. Vitest config — Pages mode

- [ ] 4.1 Create `vitest.pages.config.ts` (or merge into root `vitest.config.ts` with a separate project) using `cloudflareTest({ main: "./dist-functions/index.js", miniflare: { ... } })` per design.md Decision 4.
- [ ] 4.2 Inject test-only bindings into `miniflare.bindings` (KV namespace `SESSIONS`, fake secrets — copy the fixture pattern from old `worker/vitest.config.ts:18-49` including ephemeral RSA keypair generation).
- [ ] 4.3 Wire `buildPagesASSETSBinding(path.join(__dirname, "dist"))` so the static-assets binding mocks for tests that hit non-`/api/*` paths.
- [ ] 4.4 Create `pages-test-setup.ts` (or equivalent) as a Vitest `globalSetup` that runs `wrangler pages functions build --outdir dist-functions --watch`, waiting for first build before tests start.
- [ ] 4.5 Add `dist-functions/` to root `.gitignore`.
- [ ] 4.6 Run vitest with the Pages config and `functions/health.ts` plus a single ported test — confirm green before porting more.

## 5. Port routes — file-based, one handler at a time

Each task below: (a) create `functions/<route>.ts` exporting `onRequest` (or `onRequestGet` / `onRequestPost`) that delegates to the shared helper, (b) port the corresponding test file from `worker/test/` into a new test directory, (c) apply the 2-line rewrite (`SELF.fetch` → `exports.default.fetch`, `cloudflare:test` → `cloudflare:workers`), (d) confirm green before moving on.

- [ ] 5.1 `functions/auth/start.ts` — paired with `auth-start.test.ts`.
- [ ] 5.2 `functions/auth/callback.ts` — paired with `auth-callback.test.ts`, `auth-callback-success.test.ts`, `auth-callback-user-info.test.ts`, `auth-return-url.test.ts`.
- [ ] 5.3 `functions/auth/logout.ts` — paired with `auth-logout.test.ts`.
- [ ] 5.4 `functions/api/session-status.ts` — paired with `session-status.test.ts`.
- [ ] 5.5 `functions/api/github/[[path]].ts` — paired with `api-proxy.test.ts`, `api-proxy-get.test.ts`.
- [ ] 5.6 `functions/api/save.ts` — paired with `save-success.test.ts`, `save-conflict.test.ts`, `save-no-write.test.ts`, `save-encoding.test.ts`, `save-validation.test.ts`, `save-failure-paths.test.ts`, `save-path-validator.test.ts`, `save-dedup.test.ts`, `save-dedup-branch-sha.test.ts`.
- [ ] 5.7 Port shared `test-helpers.ts` into the new test directory.
- [ ] 5.8 Port `auth-method-flag.test.ts` and `health.test.ts` (the latter against the stub from 3.5).
- [ ] 5.9 Run the full ported test suite — all 20 tests green against Pages Functions.

## 6. Same-origin requirement coverage (specs/github-app-backend ADDED)

- [ ] 6.1 Add a same-origin integration test asserting `exports.default.fetch("https://x.test/auth/start")` returns 302 to GitHub (proves `/auth/start` reachable as same-origin path).
- [ ] 6.2 Add a same-origin integration test asserting `exports.default.fetch("https://x.test/api/session-status", { headers: { Cookie: "..." } })` succeeds without CORS preflight (cookie attached, no `Access-Control-*` headers required upstream).
- [ ] 6.3 Add a same-origin integration test asserting the OAuth callback redirect (`Location` header on `/auth/callback` response) targets a same-origin URL when the `return` parameter is same-origin.

## 7. Cloudflare configuration (operator-driven, not TDD)

- [ ] 7.1 In Cloudflare dashboard: create a fresh KV namespace `hashly-pages-sessions-prod`. Note the ID for `wrangler.toml` if the project uses one, or for the dashboard binding if not.
- [ ] 7.2 Create a second KV namespace `hashly-pages-sessions-preview` for branch-preview deploys.
- [ ] 7.3 In the Pages project's Settings → Environment variables (Production): add the five secrets — `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `SESSION_HMAC_KEY`. Use the dashboard's secret-input UI; mark each as encrypted.
- [ ] 7.4 Repeat 7.3 for the Preview environment with the same values (or rotated values for the secrets if scope-of-leak hygiene matters more than preview convenience).
- [ ] 7.5 Bind `SESSIONS` KV → production namespace (Production env) and preview namespace (Preview env). Ensure the binding name matches what `Env.SESSIONS` expects in code.
- [ ] 7.6 Generate a fresh `SESSION_HMAC_KEY` value (random 32+ bytes, base64) and store as the new prod secret. Discard the old `hashly-worker` value (free rotation since the new KV namespace has zero existing sessions).
- [ ] 7.7 Generate a fresh GitHub App private key (rotate via the GitHub App admin UI), download the `.pem`, store as the new `GITHUB_APP_PRIVATE_KEY` secret. Revoke the old key after the deploy verifies green.
- [ ] 7.8 In the GitHub App settings: ensure `https://hashly-md.pages.dev/auth/callback` is in the callback URL allowlist (likely already there from v0.3).
- [ ] 7.9 In the GitHub App settings: add a wildcard preview-callback URL pattern (e.g., `https://*.hashly-md.pages.dev/auth/callback`). If GitHub rejects wildcards, document the per-branch registration flow in `CLAUDE.md` and accept the operator overhead.

## 8. Local end-to-end verification

- [ ] 8.1 Run `npm test` at root — all 20 ported tests + 3 new same-origin tests green.
- [ ] 8.2 Run `npx wrangler pages dev` (or `npm run dev` with Pages adapter) and exercise: anonymous viewer load, sign-in flow, save flow, session-status check, logout. Use the test GitHub App + a personal test repo.
- [ ] 8.3 Verify `_shared/auth.ts` and `_shared/save.ts` are NOT addressable as routes (Pages Functions ignores `_`-prefixed paths) — manual check by hitting `https://localhost:.../`_shared/auth.ts`.

## 9. Deploy + production verification

- [ ] 9.1 Push the v0.3.1 PR. Cloudflare Pages auto-deploys a preview build.
- [ ] 9.2 On the preview URL: anonymous viewer renders a public spec link → green.
- [ ] 9.3 On the preview URL: sign-in flow completes (preview-env secrets + KV in play, preview callback registered) → green.
- [ ] 9.4 On the preview URL: save creates a PR on a test repo → green.
- [ ] 9.5 Merge to `main`. Production auto-deploys.
- [ ] 9.6 On production (`hashly-md.pages.dev`): repeat 9.2–9.4 against a real spec link.
- [ ] 9.7 Update `specs/hashly-vision.md:71` v0.3.1 entry: status flips to "shipped 2026-MM-DD."

## 10. Post-merge follow-ups (NOT in this PR)

- [ ] 10.1 [Defer ≥1 week] Tear down the deployed `hashly-worker` Cloudflare Worker. Confirm: production Pages Functions has been green for ≥7 days. Then `cd /tmp && wrangler delete hashly-worker` (with the worker's wrangler.toml — restored from git history, since the source is gone). Delete the old KV namespace `1198a0321a05437fb246d041ad7c7953` after worker delete confirms.
- [ ] 10.2 [Defer ≥1 week] Revoke the old `SESSION_HMAC_KEY` and old GitHub App private-key entries from the Cloudflare and GitHub dashboards. (Already replaced in 7.6 and 7.7; revocation is just bookkeeping.)
- [ ] 10.3 [Optional] File a separate change to delete `src-tauri/` entirely (post-#95 follow-up unblocked by ≥1 week of green v0.3 web app).
