# v0.3 manual e2e checklist

The automated suites (Vitest + jsdom for the frontend, `@cloudflare/vitest-pool-workers` for the Worker) verify behavior against mocks. This checklist covers the end-to-end flows that require a real browser, real GitHub, and the deployed Worker — the cases where mocks can't catch divergence between mocked and real GitHub semantics.

Run before merging the v0.3 milestone PR (or before flipping the marketing announcement).

## Prerequisites

- [ ] Worker deployed to `hashly-md.pages.dev` (or staging route) with all secrets set per #98 external-action checklist (App ID, App private key, OAuth client ID/secret, session HMAC key, real KV namespace ID).
- [ ] Hashly GitHub App installed on at least one test repo with public spec(s).
- [ ] At least one test account with write access to the test repo, and one without.

## Anonymous read flow (AC 4.x)

- [ ] Open `https://hashly-md.pages.dev/?repo=<test-repo>&path=<spec-path>` in a fresh incognito window.
- [ ] Confirm: viewer renders the spec content with v0.2 polish (GFM tables, fenced code blocks styled, list rhythm, H1 underline, frontmatter recognized).
- [ ] Confirm: persistent header shows `<repo> · <path> @ <ref>` with a working "View on GitHub" link in the top-right.
- [ ] Confirm: `#hashly` wordmark visible.
- [ ] Click an in-doc anchor link (e.g. `[Section](#section)`) — verify it scrolls to the heading.
- [ ] Reference an image with a broken URL in the spec — verify alt-text fallback renders, not the OS "?" glyph.
- [ ] Toggle OS dark mode — verify the viewer + header + wordmark + GitHub link rebind to dark tokens (no flash, no broken contrast).
- [ ] Open the URL with bad params (`?foo=bar`) — verify landing page renders with example link.
- [ ] Open the URL pointing at a 404 path — verify "not found" error banner with safe wording (does not distinguish "private" vs "missing").
- [ ] Open the URL pointing at a private repo (anonymous) — verify same "not found / may be private" banner (no probe-leak).

## JIT auth flow (AC 5.x)

- [ ] On the spec viewer (still anonymous), click into the editor surface and type a key.
- [ ] Verify: redirect to GitHub OAuth/App authorize page.
- [ ] Authorize the app.
- [ ] Verify: redirect back to the original spec URL.
- [ ] Verify: viewer-header now shows the avatar + sign-out button in the top-right.
- [ ] Verify: viewer is editable (cursor, no read-only locks).
- [ ] Verify: post-auth-prompt banner appears above the editor with positive copy ("Signed in — you can edit now" or similar).
- [ ] Click "Sign out" — verify avatar disappears, editor reverts to read-only.
- [ ] Re-attempt auth: type in editor → redirect → cancel from GitHub (back button).
- [ ] Verify: arrives back on the spec URL with auth-cancelled banner; NO infinite redirect loop.

## No-write-access flow (AC 5.5 + 6.7)

- [ ] Sign in as a user without push access on the test repo.
- [ ] Try to type — verify: view-only-lock banner with verbatim text "view-only — no write access; ask the dev to add you".
- [ ] If the proactive lock somehow doesn't fire and the user reaches the Save button, click Save.
- [ ] Verify: save-error banner with verbatim text "ask the dev to add you as a collaborator (or install the Hashly GitHub App on the repo)".

## Save flow (AC 6.x)

- [ ] Sign in as a user with push access on the test repo.
- [ ] Edit a spec (add a sentence at the top of the body, leaving frontmatter untouched).
- [ ] Verify: Save button is enabled, distinct from disabled state.
- [ ] Click Save — verify: button shows "Saving…" + aria-busy + disabled state during the network round-trip.
- [ ] Verify: success banner appears with brand styling, distinct color from conflict and error variants, with "View pull request on GitHub" link.
- [ ] Click the link — verify it opens in a new tab pointing at the actual created PR.
- [ ] On GitHub: verify the PR exists, branch name is `hashly/spec-edit-<timestamp>`, content is the user's edit.
- [ ] Inspect the committed file: verify YAML frontmatter is byte-identical to the original (no reformatting, no whitespace changes, no quote-style changes).
- [ ] Edit again in the same session — click Save again.
- [ ] Verify: success banner reappears (same text — copy distinction is a v0.3.x follow-up).
- [ ] On GitHub: verify a new commit appears on the SAME PR (not a new PR) — dedup working.

## Stale-SHA / conflict flow (AC 6.4 + 6.5)

- [ ] Open spec in browser tab A; confirm baseSha captured.
- [ ] In a separate session (browser tab B or `git push`), commit a different change to the same file on the source ref.
- [ ] In tab A, edit and click Save.
- [ ] Verify: conflict banner appears with verbatim text "your edit and an upstream change overlap; please reload".
- [ ] Verify: Copy button is present and works (clipboard contains the user's edit).
- [ ] Verify: Reload button is present and triggers a page reload that loads the upstream content.

## Iframe embed (AC 4.8)

- [ ] Create a small HTML page on a different origin with `<iframe src="https://hashly-md.pages.dev/?repo=...&path=..." width="600" height="400">`.
- [ ] Open that page; verify: viewer renders inside the iframe without horizontal scrollbar at 600px width.
- [ ] Verify: persistent header coords (`<repo> · <path> @ <ref>`) truncate with ellipsis if too long, do not overflow.

## Dark-mode visual

- [ ] Toggle OS dark mode and re-run: anonymous read, JIT auth, save success, save conflict, save no-write banner.
- [ ] Verify: success / conflict / error banners are visually distinguishable (✓ / ⚠ / ✕ glyphs + distinct border-left colors).

## Worker security smoke

- [ ] Inspect any /api/save response body: verify no installation token, no session token, no private user data appears.
- [ ] Inspect cookies via DevTools: verify `hashly_session` cookie has HttpOnly, Secure, SameSite=Lax, sensible Max-Age.
- [ ] Try to POST `/api/save` from a different origin (e.g., `fetch('https://hashly-md.pages.dev/api/save', ...)` from a different domain's browser console): verify 403 (Origin gate).
