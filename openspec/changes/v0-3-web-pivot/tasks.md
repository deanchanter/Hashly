## 1. Pre-cut & repo prep

- [ ] 1.1 Branch from `main` to `milestone/v0-3-web-pivot` and push to origin
- [ ] 1.2 Decide and record hosting target (Cloudflare Pages + Workers vs. alternatives) in `design.md` Open Questions
- [ ] 1.3 Check `hashly.app` (and runner-up domains) for availability and pricing; record decision in `design.md`
- [ ] 1.4 Add a top-level `web/` (frontend) and `worker/` (backend) directory split, OR confirm existing `src/` continues to host the frontend; document the structure in the README
- [ ] 1.5 Add `.dev.vars.example` documenting the env vars the Worker needs (App ID, App private key path, OAuth client ID/secret, session signing key); never commit real secrets

## 2. GitHub App + OAuth App registration

- [ ] 2.1 Register a new GitHub App named `Hashly` with permissions: Contents read/write, Pull requests read/write, Metadata read; install URL points at the Hashly app
- [ ] 2.2 Configure the App's callback URL to `<backend-domain>/auth/callback`
- [ ] 2.3 Generate and download the App private key; store in 1Password (or equivalent); never commit to repo
- [ ] 2.4 Register a fallback OAuth App with the same callback URL; record client ID/secret separately
- [ ] 2.5 Document install flow for end users in a draft README section (will land in step 9.x)

## 3. Backend: Cloudflare Worker scaffold

- [ ] 3.1 Initialize a Wrangler project under `worker/` (or chosen path); commit `wrangler.toml` with route + binding placeholders
- [ ] 3.2 Add dependencies: `@octokit/auth-app`, `@octokit/core`, a JWT/cookie library or hand-rolled HMAC for session signing
- [ ] 3.3 Implement `GET /auth/start` — redirects to GitHub OAuth/App authorization URL with a CSRF state parameter stored in a short-lived cookie
- [ ] 3.4 Implement `GET /auth/callback` — verifies state, exchanges code for token, issues opaque session cookie (HttpOnly, Secure, SameSite=Lax), redirects back to original spec URL
- [ ] 3.5 Implement `POST /api/github/*` proxy — attaches the user's installation token server-side and forwards to the GitHub API
- [ ] 3.6 Implement `POST /auth/logout` — invalidates the session cookie
- [ ] 3.7 Implement config flag toggle (env var) selecting `app` vs. `oauth-app` auth method; default `app`
- [ ] 3.8 Add Worker unit tests for: cookie attribute correctness (HttpOnly + Secure + SameSite), state-parameter CSRF check, token-not-leaked-to-response-body
- [ ] 3.9 Deploy Worker to a staging route; verify a manual sign-in round-trip end-to-end

## 4. Frontend: routing & viewer mode

- [ ] 4.1 Add URL-parameter routing (`?repo=owner/name&path=specs/foo.md&ref=main`); parse on load, validate shape
- [ ] 4.2 Implement landing page for missing/invalid params with example link and short explanation
- [ ] 4.3 Add anonymous public-repo fetch via the GitHub raw content REST endpoint (no auth)
- [ ] 4.4 Mount Milkdown in read-only mode with the v0.2 frontend's existing rendering polish (GFM tables, fenced code, list rhythm, H1 underline, broken-image fallback, frontmatter)
- [ ] 4.5 Add persistent header showing `<repo>` `<path>` `<ref>` with a link out to github.com
- [ ] 4.6 Add `prefers-color-scheme` light/dark handling using the v0.2 brand palette; carry over the `#hashly` wordmark
- [ ] 4.7 Add error states: 404 (file not found), 403 (private repo, anonymous), network error
- [ ] 4.8 Verify rendering inside a 600px-wide `<iframe>` on a third-party page; fix any CSS that breaks the embed

## 5. Frontend: edit mode + JIT auth

- [ ] 5.1 Switch Milkdown into editable mode when the user attempts a content-modifying action (typing, formatting affordance click)
- [ ] 5.2 On first edit attempt by an unauthenticated user, pause the action, redirect to backend `/auth/start` with the current spec URL as the post-auth return target
- [ ] 5.3 On post-auth return, restore the edit context and re-apply the user's pending action (or prompt them to re-do it if state can't be safely restored)
- [ ] 5.4 Add a "session active" indicator (e.g., signed-in user's GitHub avatar in the header) and a `Sign out` action that calls `/auth/logout`
- [ ] 5.5 Detect no-write-access state via a backend permission-check call right after auth; if read-only, lock the editor with a "view-only — no write access; ask the dev to add you" message
- [ ] 5.6 Confirm the editor preserves YAML frontmatter byte-identically when the user edits surrounding content (regression test)

## 6. Frontend: save flow

- [ ] 6.1 Implement `Save` button that, when clicked, sends the current editor content + base SHA to a backend endpoint
- [ ] 6.2 Backend: `POST /api/save` — creates branch `hashly/spec-edit-<timestamp>`, commits the new content, opens a PR against the source ref; returns PR URL
- [ ] 6.3 Frontend: on save success, show a toast/banner with the PR URL and a "view on GitHub" link
- [ ] 6.4 Backend: detect stale-SHA before write — fetch latest content, attempt a three-way merge (`diff3`-style); if no overlapping conflicts, proceed with merged content
- [ ] 6.5 Frontend: on stale-SHA conflict (overlapping edits), display "your edit and an upstream change overlap; please reload" message; preserve user's in-memory content so they can copy it out before reload
- [ ] 6.6 Backend: on second `Save` within the same session, detect existing PR for this branch and push a new commit instead of opening a duplicate PR
- [ ] 6.7 Add hard-fail UX for no-write-access at save time (backup for the proactive lock in 5.5): the message must include the literal text "ask the dev to add you as a collaborator (or install the Hashly GitHub App on the repo)"

## 7. Tests

- [ ] 7.1 Carry over the existing Vitest + jsdom suite under `src/__tests__/`; remove tests that depend on Tauri APIs
- [ ] 7.2 Add a Vitest test asserting URL-parameter parsing handles valid, invalid, and edge-case inputs
- [ ] 7.3 Add a Vitest test asserting the viewer renders public-repo content from a mocked fetch
- [ ] 7.4 Add a Vitest test asserting frontmatter round-trips byte-identically through the editor
- [ ] 7.5 Add a Worker unit test for the cookie-attribute requirements (HttpOnly, Secure, SameSite=Lax)
- [ ] 7.6 Add a Worker unit test asserting the access token never appears in any response body
- [ ] 7.7 Add a manual e2e checklist (markdown checklist in the PR description) covering: anonymous read, JIT auth, save → PR, stale-SHA auto-rebase, stale-SHA conflict, no-write-access hard-fail, iframe embed

## 8. Hosting & deploy

- [ ] 8.1 Provision Cloudflare Pages project pointed at the frontend build output
- [ ] 8.2 Bind Worker to the same domain via routes (e.g., `/auth/*` and `/api/*`)
- [ ] 8.3 Configure secrets (App private key, OAuth secret, session HMAC key) via `wrangler secret put`
- [ ] 8.4 Add custom domain (or document the `.pages.dev` subdomain v0.3 ships with)
- [ ] 8.5 Verify production round-trip: load a real public-repo spec link, sign in, save, confirm PR appears
- [ ] 8.6 Add a `/health` endpoint on the Worker for basic uptime checking

## 9. Sunset desktop

- [ ] 9.1 Remove `src-tauri/` from active build path: delete from workspace `Cargo.toml`, remove `beforeDevCommand`/`beforeBuildCommand` references, remove Cargo invocations from CI
- [ ] 9.2 Rewrite the project README: open with the web URL and "paste a GitHub spec link" usage, demote desktop to a "v0.2.3 was the final desktop release" note linking to the GitHub release page
- [ ] 9.3 Update `specs/hashly-vision.md` v0.3 entry to reflect the GitHub-PR addition (the literal text is "web build, so tutorials and courses can embed or link directly" — extend it to acknowledge PR-back); record any vision-level reconciliation
- [ ] 9.4 Commit a final cask formula update on `deanchanter/homebrew-hashly` adding a deprecation note (e.g., a `caveats` block: "Hashly is now a web app at <URL>; v0.2.3 is the final desktop release")
- [ ] 9.5 Add a banner or note on the GitHub v0.2.3 release page pointing at the web URL
- [ ] 9.6 After v0.3 ships green for one week, delete `src-tauri/` and root `Cargo.toml`/`Cargo.lock` in a follow-up commit (do NOT do this before v0.3 is verified working — keeps rollback cheap)

## 10. Ship & post-ship

- [ ] 10.1 Open the milestone PR (`milestone/v0-3-web-pivot` → `main`) with the manual e2e checklist (7.7) in the description
- [ ] 10.2 Run `/ultrareview` (or equivalent) on the PR before merge
- [ ] 10.3 Merge to `main`; tag `v0.3.0`
- [ ] 10.4 Publish the LinkedIn post announcing v0.3 with a working spec link to demonstrate
- [ ] 10.5 Monitor first 5 attempted edit sessions for App-install friction (per design Risk mitigation); record outcomes
- [ ] 10.6 Decide at end of week 1: do we flip to OAuth App fallback (>=2 of 5 install drop-offs) or stay on GitHub App?
- [ ] 10.7 Three-month review point: did at least one non-dev complete a save? Record outcome against the v0.3 success signal in `specs/hashly-vision.md` and write a follow-up note (extend horizon, pivot, or call the bet won)

## 11. Open questions to resolve during implementation

- [ ] 11.1 Confirm hosting choice (Cloudflare vs. alternatives) — see design.md Open Questions
- [ ] 11.2 Confirm domain — see design.md Open Questions
- [ ] 11.3 Decide embed strategy (documented `?embed=1` flag vs. relying on the standard URL working in iframes) — see design.md Open Questions
- [ ] 11.4 Decide anonymous-read rate-limit handling (proxy through Worker only if/when first complaint surfaces) — see design.md Open Questions
- [ ] 11.5 Reconcile the vision doc v0.3 entry as part of step 9.3
