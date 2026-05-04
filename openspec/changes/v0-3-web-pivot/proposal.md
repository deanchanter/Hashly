## Why

The Hashly desktop app does not serve the audience the vision (`specs/hashly-vision.md`) commits to: non-engineers participating in Spec-Driven Development workflows. A validated real instance of the gap: a dev drafts a spec in-repo, Slacks a link to the PM for validation, the PM responds with prose feedback in Slack, and the dev manually translates those messages back into spec edits and opens a PR. The desktop app does not appear anywhere in that loop — it cannot, because the spec lives in GitHub and the PM does not have a local checkout.

Compounding pressure: the v0.2.3 release surfaced ongoing macOS signing/Gatekeeper friction (brew applies quarantine; unsigned apps are rejected with "could not verify"), revealing that even the desktop persona pays a tax that the vision has not budgeted for. Market scan (May 2026) confirms no current tool serves "non-dev clicks a Slack link to a GitHub-hosted spec, edits WYSIWYG, change lands as a PR" — JekyllPad is closest but is freemium with a 5-posts/month cap and direct-commit only; StackEdit is two-pane preview not WYSIWYG and lacks a paste-a-URL flow; the entire SDD-tools landscape (Spec Kit, Kiro, OpenSpec, BMAD, Tessl) is dev-shaped end-to-end.

## What Changes

- **BREAKING**: Sunset the Tauri desktop app. v0.2.3 is the final desktop release; no further desktop development. The Rust crate, Tauri config, native menus, file dialogs, signing/notarization considerations, and `cargo tauri build` workflow are retired.
- **NEW**: A web app at a public URL that takes a GitHub-hosted markdown file URL as a parameter and renders it WYSIWYG (Milkdown carries over from desktop) for anonymous readers without sign-in.
- **NEW**: Just-in-time GitHub authentication — sign-in is requested only on the first edit attempt, never to read a public-repo spec.
- **NEW**: Save action creates a pull request on the source repo (not a direct commit). Auto-rebase the PM's edits onto the latest file SHA when the file has moved since the page loaded; surface unresolvable conflicts.
- **NEW**: Hard-fail with a "ask the dev to add you as a collaborator" message when the authenticated user has no write permission on the target repo. No fork-and-PR-from-fork in v0.3.
- **NEW**: Backend OAuth handler (Cloudflare Worker) holding GitHub App credentials; access token stored in an httpOnly session cookie; a GitHub App authenticates by default, with an OAuth App fallback path if App-install friction blocks early users.
- **NEW**: Light/dark mode (vision hard constraint, carries over).
- **NEW**: Free forever, no quota (vision commitment).
- **OUT**: The v0.2.4 README hotfix correcting the brew-strips-quarantine documentation lie is skipped — the desktop README is now a tombstone document and v0.3 replaces the install story entirely.

## Capabilities

### New Capabilities

- `spec-link-viewer`: Open any GitHub-hosted markdown file via a URL query parameter and render it WYSIWYG in the browser. Anonymous read for public repos, no sign-in required. Light and dark mode. Tutorial-embeddable as an `<iframe>` or plain link.
- `spec-pr-editor`: Authenticated edit-and-save flow that creates a pull request on the source repo. JIT OAuth (only on first edit). Auto-rebase the user's edits when the underlying file SHA has advanced. Hard-fail with a copy-friendly message when the user lacks write permission on the repo.
- `github-app-backend`: A Cloudflare Worker holding GitHub App credentials and the OAuth client secret. Issues an httpOnly session cookie after a successful authentication callback. Defaults to a GitHub App for fine-grained, installation-scoped, short-lived tokens. OAuth App fallback path available behind a config flag if App-install friction proves prohibitive.

### Modified Capabilities

_None. `openspec/specs/` is empty (this is the first OpenSpec change in the repo). The desktop app's behavior was specified in `specs/v0.1-wysiwyg-editor/`, `specs/v0.2-mvp-completion/`, etc., which are milestone-shaped historical artifacts, not OpenSpec capability specs._

## Impact

- **Code**: The Rust crate (`src-tauri/`) and `Cargo.lock` / `Cargo.toml` are removed from the active build path. The Vite + TypeScript frontend (`src/`, `index.html`, `package.json`) carries over and grows: routing for `?repo=...&path=...` URLs, a viewer mode, an editor mode, GitHub auth UI, save-and-PR flow, conflict-resolution UI, light/dark mode preserved.
- **Tests**: Existing Rust integration tests in `src-tauri/tests/` (`config.rs`, `frontend.rs`, `readme.rs`, `templates_menu.rs`) are retired. Vitest + jsdom suite in `src/__tests__/` carries over and grows to cover the new flows.
- **New dependencies**: Octokit (GitHub REST + GraphQL SDK) on the frontend for read paths; the backend Worker uses `@octokit/auth-app` and `@octokit/core` (or equivalent fetch-based calls). A small CSRF/state library or hand-rolled token check for the OAuth callback. No new persisted DB.
- **New infrastructure**: A Cloudflare Worker (or equivalent — Vercel function, Netlify function) for the OAuth callback and token-refresh endpoint. A registered GitHub App. A registered OAuth App as fallback. A hosting target for the static frontend (Cloudflare Pages, GitHub Pages, etc.). A domain (TBD).
- **Documentation**: README replaces desktop install story with a "visit the URL, paste a GitHub spec link" story. `specs/hashly-vision.md` v0.3 horizon entry gets reconciled (vision says "web build, so tutorials and courses can embed or link directly"; v0.3 delivers that *plus* the GitHub-PR flow). The desktop install section becomes a brief "v0.2.3 is the final desktop release" note pointing at the GitHub release page.
- **Distribution**: Hashly's distribution channel changes from "GitHub release `.dmg` + Homebrew cask" to "URL." The Homebrew cask repo (`deanchanter/homebrew-hashly`) gets a final commit pinning to v0.2.3 with a deprecation note, then is left alone.
- **Vision alignment**: v0.3 delivers the vision's stated v0.3 scope ("web build, so tutorials and courses can embed or link directly") and goes one step beyond by adding the GitHub-PR flow that the validated PM/dev workflow actually requires. The vision non-goal "no collaboration" is not violated — PR-as-export is asynchronous, single-author-at-a-time, and uses GitHub's existing review surface for any back-and-forth; Hashly itself adds no presence, comments, or real-time multi-user features.
