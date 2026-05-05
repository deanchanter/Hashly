# Tasks — v0.3 web pivot

**Status:** Shipped 2026-05-05 (originals merged via PRs #104, #110, #116, #121, #122, #123). Per-issue PRs replaced the originally-planned single milestone PR — see `/feedback_per_issue_prs.md` and the README for the user-driven flow.

Deferred items track to follow-up issues; human-only deploy/announce work tracks to #98.

## 1. Pre-cut & repo prep

- [x] 1.1 Branch from `main` to `milestone/v0-3-web-pivot` and push to origin — _done differently: per-issue branches (`issue-89-worker-scaffold`, `issue-90-viewer`, etc.) per user override_
- [x] 1.2 Decide and record hosting target (Cloudflare Pages + Workers vs. alternatives) in `design.md` Open Questions — _Cloudflare chosen, recorded_
- [x] 1.3 Check `hashly.app` (and runner-up domains) for availability and pricing; record decision in `design.md` — _decision: ship on `*.pages.dev` for v0.3 (`hashly-md.pages.dev` actual); custom domain deferred to #98 item 12_
- [x] 1.4 Add a top-level `web/` (frontend) and `worker/` (backend) directory split, OR confirm existing `src/` continues to host the frontend; document the structure in the README — _monorepo: `src/` for frontend, new `worker/` for backend; documented in README + CLAUDE.md_
- [x] 1.5 Add `.dev.vars.example` documenting the env vars the Worker needs — _shipped in #89 (`worker/.dev.vars.example`)_

## 2. GitHub App + OAuth App registration

- [ ] 2.1 Register a new GitHub App named `Hashly` — _human-only, tracked in #98 item 3_
- [ ] 2.2 Configure the App's callback URL to `<backend-domain>/auth/callback` — _human-only, #98 item 3_
- [ ] 2.3 Generate and download the App private key; store in 1Password — _human-only, #98 item 3_
- [ ] 2.4 Register a fallback OAuth App with the same callback URL — _human-only, #98 item 4_
- [x] 2.5 Document install flow for end users in a draft README section — _README rewritten in #95 with web-URL story; install flow naturally surfaces during JIT auth_

## 3. Backend: Cloudflare Worker scaffold

- [x] 3.1 Initialize a Wrangler project under `worker/`; commit `wrangler.toml` with route + binding placeholders — #89
- [x] 3.2 Add dependencies: `@octokit/auth-app`, `@octokit/core`, JWT/cookie/HMAC primitive — #89 (declared; runtime hand-rolls JWT signing via WebCrypto SubtleCrypto, no octokit at runtime)
- [x] 3.3 Implement `GET /auth/start` — #89 (`worker/src/auth.ts`)
- [x] 3.4 Implement `GET /auth/callback` — #89, extended in #91 to thread return URL + enrich user record
- [x] 3.5 Implement `POST /api/github/*` proxy — #89, route guard relaxed to any-method in #92 AC 5.5
- [x] 3.6 Implement `POST /auth/logout` — #89
- [x] 3.7 Implement config flag toggle (`AUTH_METHOD`) selecting `app` vs `oauth-app`; default `app` — #89
- [x] 3.8 Add Worker unit tests for cookie attribute correctness, state-CSRF check, token-not-leaked-to-response-body — #89 (`worker/test/auth-callback*.test.ts`, `auth-start.test.ts`, `auth-logout.test.ts`, `api-proxy.test.ts`)
- [ ] 3.9 Deploy Worker to a staging route; verify a manual sign-in round-trip end-to-end — _human-only, #98 item 7_

## 4. Frontend: routing & viewer mode

- [x] 4.1 URL-parameter routing (`?repo=...&path=...&ref=...`) with parse + validate — #90 (`src/router.ts`); hardened in iter-2 to reject `..`/`.` segments + tighten ref charset
- [x] 4.2 Landing page for missing/invalid params — #90 (`src/landing.ts`)
- [x] 4.3 Anonymous public-repo fetch via `raw.githubusercontent.com` — #90 (`src/fetch-spec.ts`)
- [x] 4.4 Mount Milkdown read-only with v0.2 polish — #90 (`src/viewer.ts`); broken-image fallback + heading IDs added in fix-loop-1
- [x] 4.5 Persistent header showing `<repo> <path> <ref>` with github.com link — #90 (`src/viewer-header.ts`)
- [x] 4.6 `prefers-color-scheme` + `#hashly` wordmark — #90 (CSS tokens preserved from v0.2; wordmark wired in fix-loop-1 #7)
- [x] 4.7 Error states: 404 / 403 / network — #90 (`src/viewer-error.ts`)
- [x] 4.8 Verify rendering inside 600px iframe; fix CSS — #90 (`src/__tests__/iframe-sizing.test.ts`); manual iframe verification in `manual-e2e-checklist.md`

## 5. Frontend: edit mode + JIT auth

- [x] 5.1 Switch Milkdown into editable mode on user edit attempt — #91 (`src/edit-mode.ts` `enterEditMode` + keydown trigger added in fix-loop-2)
- [x] 5.2 JIT auth: pause + redirect to `/auth/start` with return URL — #91 (`attemptEditAction` + worker return-URL threading)
- [x] 5.3 Post-auth restore via sessionStorage flag — #91; back-button cancel loop fixed in fix-loop-1 #5; banner contradiction fixed in fix-loop-2 #2
- [x] 5.4 Session indicator (avatar) + sign-out — #91 (`src/session-indicator.ts`); wired into bootstrap in fix-loop-1 #1
- [x] 5.5 Detect no-write-access via permission check; lock editor with verbatim "view-only — no write access; ask the dev to add you" — #91; tristate `'allowed' | 'denied' | 'unknown'` added in fix-loop-3 to preserve retries on transient failures
- [x] 5.6 Frontmatter byte-identical regression — #91 (`src/__tests__/edit-mode-frontmatter.test.ts`)

## 6. Frontend: save flow

- [x] 6.1 Save button click → POST /api/save with content + baseSha — #92 (`src/edit-mode.ts` click handler, in-flight state added in fix-loop-1 #7)
- [x] 6.2 Backend `POST /api/save` — branch + commit + open PR; returns PR URL — #92 (`worker/src/save.ts`); PUT-sha fixed in fix-loop-1 #1, dedup branch-sha fixed in fix-loop-2 #1
- [x] 6.3 Frontend success banner with PR URL — #92 (`src/save-result.ts` `renderSaveSuccess`); brand CSS + dark-mode tokens + icon glyphs in fix-loop iters
- [x] 6.4 Backend stale-SHA detection — #92, **scoped down**: strict SHA-equality (no diff3 three-way merge); spec updated to match. Three-way merge for non-overlapping edits tracked in **#124** as deferred follow-up
- [x] 6.5 Frontend stale-SHA conflict UX with verbatim copy — #92 (`renderSaveConflict`); Copy + Reload buttons (Reload added in fix-loop-1 #17)
- [x] 6.6 Backend dedup PR within session — #92 (KV cache keyed by JSON-stringified tuple); branch-side sha lookup added in fix-loop-2 to fix end-to-end correctness against real GitHub
- [x] 6.7 Save-time no-write-access fail with verbatim phrase — #92; UI wiring (renderSaveError) added in fix-loop-1 #2

## 7. Tests

- [x] 7.1 Carry over Vitest + jsdom suite — #91 (`vitest.setup.ts` opts existing v0.2 tests into Tauri mode by default; web-mode tests opt out per-test). _Tauri-dep test removal deferred to post-#95 src-tauri delete (AC 9.6 follow-up)_
- [x] 7.2 URL-parameter parsing test — #90 (`src/__tests__/router.test.ts`, 34 tests including ref-traversal hardening)
- [x] 7.3 Viewer renders public-repo content from mocked fetch — #90 (`viewer.test.ts` + `fetch-spec.test.ts`)
- [x] 7.4 Frontmatter byte-identical round-trip — #91 (`edit-mode-frontmatter.test.ts`); extended in #92 to verify survival across save flow
- [x] 7.5 Worker cookie-attribute test — #89 (`auth-start.test.ts`, `auth-callback-success.test.ts`, `auth-logout.test.ts`)
- [x] 7.6 Worker token-not-leaked test — #89 + #91 (`api-proxy.test.ts`, `auth-callback-success.test.ts`, `session-status.test.ts`)
- [x] 7.7 Manual e2e checklist — #93 (`openspec/changes/v0-3-web-pivot/manual-e2e-checklist.md`)

## 8. Hosting & deploy

- [ ] 8.1 Provision Cloudflare Pages project — _human-only, #98 item 2 (DONE per user's `hashly-md.pages.dev` deploy)_
- [ ] 8.2 Bind Worker to the same domain via routes — _human-only, #98 item 6_
- [ ] 8.3 Configure secrets via `wrangler secret put` — _human-only, #98 item 5_
- [ ] 8.4 Add custom domain (or document `.pages.dev` subdomain) — _human-only, #98 item 12 (DONE: documented in README; custom domain deferred)_
- [ ] 8.5 Verify production round-trip: load real public-repo spec link, sign in, save, confirm PR appears — _human-only, manual-e2e-checklist.md_
- [x] 8.6 `/health` endpoint on Worker — #89 (AC 3.9)

## 9. Sunset desktop

- [x] 9.1 Remove `src-tauri/` from active build path: workspace `Cargo.toml`, beforeDevCommand/beforeBuildCommand, CI Cargo invocations — #95
- [x] 9.2 Rewrite README — #95
- [x] 9.3 Update `specs/hashly-vision.md` v0.3 entry to reflect the GitHub-PR addition — #95
- [ ] 9.4 Commit a final cask formula update on `deanchanter/homebrew-hashly` adding a deprecation note — _human-only, #98 item 9_
- [ ] 9.5 Add a banner or note on the GitHub v0.2.3 release page — _human-only, #98 item 10_
- [ ] 9.6 After v0.3 ships green for one week, delete `src-tauri/` and root `Cargo.toml`/`Cargo.lock` — _post-merge follow-up issue (TBD), explicitly NOT in #95 scope_

## 10. Ship & post-ship

- [x] 10.1 Open milestone PR with manual e2e checklist — _done differently: per-issue PRs (#104, #110, #116, #121, #122, #123); manual checklist lives in `openspec/changes/v0-3-web-pivot/manual-e2e-checklist.md`_
- [ ] 10.2 Run `/ultrareview` on the PR before merge — _user-driven; ship-milestone loop's adversarial-reviewer + ux-reviewer ran per-issue equivalents (3 critical-find rounds avg per issue)_
- [ ] 10.3 Merge to `main`; tag `v0.3.0` — _all 6 PRs merged; tag pending_
- [ ] 10.4 Publish the LinkedIn post announcing v0.3 — _human-only, #98 item 11_
- [ ] 10.5 Monitor first 5 attempted edit sessions — _human-only, post-launch_
- [ ] 10.6 Decide at end of week 1: flip to OAuth App fallback or stay on GitHub App — _human-only decision, #98 item 13_
- [ ] 10.7 Three-month review point — _human-only, future_

## 11. Open questions to resolve during implementation

- [x] 11.1 Confirm hosting choice — Cloudflare Pages + Workers (design.md decision; ports to Pages Functions in v0.3.1 per vision doc)
- [x] 11.2 Confirm domain — `hashly-md.pages.dev` for v0.3; custom domain deferred to #98 item 12
- [x] 11.3 Decide embed strategy — standard URL works in iframes (no `?embed=1` flag needed); pinned by `iframe-sizing.test.ts`
- [x] 11.4 Decide anonymous-read rate-limit handling — deferred per design (revisit on first complaint)
- [x] 11.5 Reconcile vision doc v0.3 entry — #95

## Follow-ups filed during shipping

- **#99-#103** — five follow-ups from #89 (worker hardening, AUTH_METHOD oauth-app callback, session HMAC envelope, test hardening, CORS allow-list)
- **#105-#109** — five follow-ups from #90 (sanitizer hardening, fetchSpec resilience, viewer visual polish, error/loading UX, copy + a11y)
- **#111-#114** — four follow-ups from #91 (worker hardening, frontend hardening, JIT keyboard polish, edit-mode UX polish)
- **#117-#119** — three follow-ups from #92 (icon CSS, worker save hardening, save UX polish)
- **#124** — three-way merge for non-overlapping stale-SHA edits (AC 6.4 scope-down)
