## Context

Hashly v0.1 → v0.2.3 shipped a Tauri-based desktop markdown editor (Rust core + Vite/TypeScript/Milkdown frontend). Two converging pressures motivate the v0.3 pivot:

1. **Validated audience gap**: a real instance of the target persona (PM validating dev-drafted SDD specs) cannot be served by a desktop app — the spec lives in GitHub, the PM has no local checkout, and the current workaround (Slack + manual translation by the dev) is inefficient and error-prone.
2. **macOS distribution friction**: v0.2.3's ad-hoc-signing fix resolved the v0.2.2 "is damaged" bug, but Sequoia still rejects the unsigned bundle on first launch with "Apple could not verify…", and Homebrew applies quarantine by default rather than stripping it as the v0.2.3 spec assumed. Every new desktop user pays a tax that does not amortize.

The vision (`specs/hashly-vision.md`) already plans `v0.3 — Web build, so tutorials and courses can embed or link directly`. v0.3 delivers that *and* the GitHub-PR flow that the validated workflow requires. Market scan (May 2026) confirms no current tool serves the "click-Slack-link → WYSIWYG → PR" flow at the free + PR-first + spec-template-aware intersection (JekyllPad is closest but freemium + commit-direct-only).

**Constraints carried from the vision**:
- Free forever (no monetization, no quota).
- Light and dark mode (hard constraint).
- No PKM, no plugin system, no AI features, no real-time collaboration.

**Authoring constraint**: solo build, target horizon "this week." Aggressive, used as a forcing function for scope discipline.

## Goals / Non-Goals

**Goals:**
- Anyone with a public GitHub spec link can open it WYSIWYG in a browser without sign-in.
- A non-dev with a GitHub account and write access on the repo can edit a spec and have the change land as a pull request, without ever invoking `git`.
- The cost of a stolen access token is bounded — single repo, short lifetime — by using a GitHub App rather than an OAuth App.
- The web app is tutorial-embeddable as either a link or an `<iframe>`.
- The Tauri desktop app is cleanly retired without leaving broken documentation.

**Non-Goals:**
- Authoring brand-new specs from scratch in the browser (the validated workflow is dev-drafts → PM-edits; greenfield authoring is a v0.4+ question).
- Editing private-repo files for users who lack write access — no fork-and-PR-from-fork in v0.3.
- Real-time collaboration, presence, inline comments, or any multi-user-at-the-same-time feature (vision non-goal).
- Universal binary, mobile, sync, AI features, plugin economy (vision non-goals).
- Republishing v0.2.x with a fix — the desktop app is sunset, not iterated.
- Custom domain, SEO, or marketing site beyond what's required to host the app.

## Decisions

### Decision 1 — Backend OAuth handler, not pure-static PKCE

**Choice**: A Cloudflare Worker (or equivalent function) holds the GitHub App private key and OAuth client secret server-side. After a successful authentication callback, the Worker issues an httpOnly session cookie. The browser never sees the access token.

**Rationale**: Pure-static PKCE is plausible — GitHub supports it — but the access token would have to live in `localStorage` or in-memory state where any XSS bug or compromised npm dependency can read it. For a tool whose core action is "grant repo write access," the higher security bar is worth a small piece of infrastructure. httpOnly cookies make XSS dramatically less catastrophic; the token is unreachable from JS.

**Alternatives considered**:
- **Pure-static frontend with PKCE**: rejected on safety grounds. Token-in-browser-storage is the wrong default for a write-capable tool.
- **Self-hosted backend (e.g., Node on a VPS)**: rejected on hobby-project cost and maintenance. Cloudflare Workers' free tier (100k req/day) comfortably absorbs expected hobby traffic.
- **Use a third-party auth-as-a-service (Clerk, Auth0)**: rejected — adds vendor coupling and a paid path; the auth needed is single-provider (GitHub) and well within ~100 lines of Worker code.

### Decision 2 — GitHub App by default, OAuth App as fallback

**Choice**: Default to a registered GitHub App for authentication. Users (or org admins) install the App on the specific repo they want to edit. Tokens are installation-scoped, fine-grained (single repo, content read/write), and short-lived (~1 hour with refresh).

**Rationale**: GitHub Apps minimize blast radius. An OAuth App with `repo` scope grants write access to *every* repo the user has access to; a leak is catastrophic. A GitHub App installation grants access only to the specific repo the user installed it on. Token expiry is short by default.

**Risk**: Some org admins block third-party GitHub App installations, or PMs lack permission to install Apps on the dev's repo. The fallback path is an OAuth App registration, behind a config flag, that the user-facing app can switch to if early adopters cannot install the App. Decision deferred to first-real-friction signal.

**Alternatives considered**:
- **Personal access tokens (PATs)**: rejected — UX is hostile (user must visit GitHub, generate a token, paste it back); fine-grained PATs help but the ceremony is too much for a non-dev PM.
- **OAuth App as primary**: rejected — too-broad scope; the security cost is real.

### Decision 3 — Save creates a pull request, not a direct commit

**Choice**: The "Save" action creates a branch on the target repo (e.g., `hashly/spec-edit-<timestamp>`), commits the user's edits to it, and opens a pull request against the file's source branch. No direct commits to the default branch.

**Rationale**: SDD review culture depends on the PR as the unit of review. Direct commits would bypass the dev's review process — exactly the loop the validated workflow needs to preserve. A PR also gives the user (and the dev) an audit trail and a place for follow-up discussion using GitHub's native facilities, which keeps Hashly itself outside the "no collaboration" non-goal.

**Alternatives considered**:
- **Direct commit to default branch**: rejected — bypasses review, violates SDD culture, and matches JekyllPad's weakness, not its strength.
- **Direct commit + auto-open a PR after the fact**: rejected — same problem in two steps; the PR-first model is cleaner.
- **Stage the edit and ask the user to confirm "open PR"**: deferred — could be added later as a "draft" mode; v0.3 ships with implicit PR-on-save for the simplest UX.

### Decision 4 — Auto-rebase on stale SHA, hard-fail on no-write-access

**Choice**: When `Save` is invoked and the file's SHA on the target branch has advanced since the page loaded, attempt an auto-rebase: re-fetch the latest content, three-way merge the user's edits onto it, and proceed if there are no overlapping changes. If the merge has conflicts, surface them to the user with a "your edit and the dev's edit overlap; please reload" message (no inline conflict resolution UI in v0.3 — that's a future polish). When the user has no write permission on the repo, hard-fail with a copy-friendly message asking them to be added as a collaborator. No fork-and-PR-from-fork in v0.3.

**Rationale**: PMs walk into meetings; specs move under their feet. Auto-rebase covers the common case (non-overlapping edits to the same file) without manual ceremony. Hard-failing on no-write-access is honest about Hashly's position in the workflow — Hashly is a tool that operates *within* the dev/PM team's existing GitHub trust boundary, not a bridge across it. Fork-PR is a meaningful chunk of work and adds confusing UX (PR comes from a fork the dev doesn't recognize); deferred.

### Decision 5 — Sunset, not parallel-track, the Tauri app

**Choice**: v0.2.3 is the final desktop release. No further desktop development. The Rust crate is removed from the active build path. The Homebrew cask gets a final commit pinning to v0.2.3 with a deprecation note, then is left alone.

**Rationale**: Solo build; parallel-tracking two surfaces (desktop + web) would mean shipping every feature twice and maintaining the macOS signing/Gatekeeper saga forever. The validated audience does not use the desktop app. The cost of saying goodbye to the Tauri work cleanly is much lower than the cost of carrying it.

**Alternatives considered**:
- **Freeze desktop at v0.2.3, no new dev, no removal**: rejected — leaves a broken README (brew-quarantine lie) in the canonical install story; users will continue to find and try the desktop app and hit the friction.
- **Parallel track**: rejected per above.

## Risks / Trade-offs

- **GitHub App install friction blocks early adoption** → Mitigation: ship OAuth App fallback path (Decision 2). Monitor first 5 attempted edit sessions for install drop-off; if >2 fail at install, flip the flag to OAuth App and revisit.
- **Auto-rebase silently merges semantically-conflicting edits** → Mitigation: only auto-rebase when there are no textual conflicts on the same lines; surface any conflict explicitly. Three-way merge with `diff3`-style markers, not "ours wins."
- **Cloudflare Worker free tier exhausted by abuse / DoS** → Mitigation: rate-limit the auth callback by IP, cap concurrent sessions per user. Hobby-tier traffic is far below the limits in normal use; the risk is non-organic spikes.
- **Audience hypothesis still unvalidated at scale** (vision-level risk) → Mitigation: ship to a URL, post on LinkedIn (per Phase 7), watch for the first non-dev edit session as the success signal. Three-month review point.
- **Aggressive "this week" timeline forces scope cuts mid-build** → Mitigation: scope cuts already pre-baked into Out-of-Scope (no fork-PR, no inline conflict UI, no comments, no greenfield authoring). If the timeline slips, those stay cut for v0.3 regardless.
- **Stolen httpOnly cookie still grants repo write for ~1 hour** → Mitigation: GitHub App tokens are installation-scoped to a single repo by design; even a successful theft is bounded. Cookie has `Secure`, `SameSite=Lax`, short max-age; rotation on suspicious activity is post-v0.3.
- **GitHub or JekyllPad closes the gap mid-build** → Acceptance: hobby-project; the spec-template-aware + free-forever + PR-first differentiation remains, even if commodity WYSIWYG-on-GitHub becomes table stakes.
- **Vision non-goal "no collaboration" interpretation drift** → Mitigation: explicit guardrail in the spec — PR-as-export is permitted, but inline comments, presence, real-time multi-user editing, and notification surfaces are all out of scope.

## Migration Plan

1. **Pre-cut**: branch off `main` to a `milestone/v0.3-web-pivot` branch.
2. **Frontend split**: keep `src/`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`. Remove `src-tauri/` from the active build path; do not delete the directory until v0.3 ships green, in case of rollback.
3. **Routing & viewer**: add URL-parameter routing (`?repo=...&path=...&ref=...`); add anonymous read-only mode using GitHub's public REST API.
4. **Backend**: register a GitHub App (and an OAuth App as fallback). Stand up a Cloudflare Worker for the OAuth callback + token-refresh + cookie issuance.
5. **Auth & editor**: JIT auth challenge on first edit; httpOnly cookie session; post-auth, switch the viewer into editor mode without a page reload if possible.
6. **Save flow**: branch + commit + PR via Octokit. Auto-rebase on stale SHA. Hard-fail on no-write-access.
7. **Hosting**: deploy frontend (Cloudflare Pages or GitHub Pages); wire Worker to the same domain.
8. **Documentation**: README rewrite. v0.2.3 desktop release page gets a "v0.3 supersedes this — visit [URL]" note. Homebrew cask gets a final deprecation commit.
9. **Tear down**: only after v0.3 ships and works, remove `src-tauri/` and `Cargo.toml` from the repo root in a follow-up commit.

**Rollback strategy**: `main` continues to point at v0.2.3 until v0.3's PR merges. If v0.3 ships and immediately breaks, revert the merge commit; v0.2.3 is unaffected on the desktop side, and the web URL can be temporarily replaced with a "site under maintenance" placeholder.

## Open Questions

- **Hosting choice — DECIDED**: Cloudflare Pages (frontend) + Cloudflare Workers (backend), single-vendor + single-domain so cookies work without CORS. **Prerequisite**: the author does not yet have a Cloudflare account; creating one is step 1 of the v0.3 external-actions checklist.
- **Domain — DECIDED**: `<project>.pages.dev` (the subdomain Cloudflare allocates when the Pages project is provisioned) for v0.3. A real domain (`hashly.app` or `hashly.dev`, ~$15/yr) is deferred to a post-v0.3 follow-up. The cookie/HTTPS posture is the same on `*.pages.dev` (HSTS-enforced).
- **Repo structure — DECIDED**: monorepo. Existing `src/` continues to host the frontend; a new `worker/` directory at repo root holds the backend (Wrangler project, Worker source). Single repo, single PR review surface for cross-cutting changes.
- **Frontmatter handling on save**: the desktop v0.2 work added frontmatter recognition. Confirm during implementation that round-tripping frontmatter through the WYSIWYG editor preserves it byte-identically — any reformatting on save is a regression.
- **Embedding stance**: do we publish documented `<iframe>` embed dimensions and a `?embed=1` flag that suppresses the chrome, or just rely on the standard URL working in an iframe? The vision says "embed or link directly"; the implementation can ship the simpler version first.
- **Anonymous-read rate-limit**: the GitHub public REST API gives 60 req/hour/IP unauthenticated. If a tutorial gets popular, viewers behind a shared NAT could hit the cap. Mitigation: optionally route anonymous reads through the Worker using a server-side token. Defer; revisit on first rate-limit complaint.
- **Vision update**: the vision doc's v0.3 entry says "web build, so tutorials and courses can embed or link directly" — narrower than what v0.3 ships. Reconcile during implementation: either update the vision to reflect the GitHub-PR addition, or document v0.3 as "vision v0.3 + an extension."
- **OAuth-App fallback flip criterion**: how many failed install attempts trigger flipping to OAuth App? Proposed: 2 of first 5 edit sessions. Decision deferred to first-week telemetry review.
