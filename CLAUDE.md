# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Hashly** — a free, WYSIWYG markdown reader/editor for Spec-Driven Development workflows. v0.3 is a web app at <https://hashly-md.pages.dev>: paste a GitHub spec link as a URL parameter, edit WYSIWYG, save → opens a pull request on the source repo. Frontend is Vite + TypeScript + [Milkdown](https://milkdown.dev/); backend is a Cloudflare Worker holding GitHub App credentials.

The desktop app (Tauri-based, macOS only) was sunset in v0.3. v0.2.3 is the final desktop release tag and the canonical rollback target. The `src-tauri/` crate and root workspace `Cargo.toml` were removed from `main` in `chore/remove-tauri-legacy`; desktop builds from current `main` no longer work. The repo was previously named `pomodoro`; update any stale references.

Specs live in `specs/` (historical milestones) and `openspec/changes/` (current pivot). Product direction: `specs/hashly-vision.md`. Latest shipped milestone: `openspec/changes/v0-3-web-pivot/` (web pivot — sunsets desktop, adds anonymous-read viewer + JIT-auth edit + PR-back save). Previous milestone: `specs/v0.2.3-bundle-signing/` (final desktop release).

## Commands

Run from the repo root:

- `npm install` — one-time install of the JS toolkit (Vite, TypeScript, Milkdown, etc.). Required before the first `npm run dev`.
- `npm run dev` — Vite dev server at <http://localhost:1420>. Loads `index.html` → `src/main.ts`. URL params drive the viewer (`?repo=...&path=...&ref=...`).
- `npm run build` — Vite production build (output: `dist/`).
- `npm test` — runs the full Vitest suite. Frontend tests (jsdom) live in `src/__tests__/`; backend tests (Pages Functions on real `workerd` via `@cloudflare/vitest-pool-workers`) live in `functions/__tests__/`.
- `npm run test:e2e` — Playwright end-to-end suite (chromium). Specs live in `e2e/`; config in `playwright.config.ts`. Boots `wrangler pages dev` on port 8788 via Playwright's `webServer`. Requires `PLAYWRIGHT_AUTH_STUB=1` to unlock the auth-stub endpoint at `/__playwright/grant` (issue #159).
- `npm run test:all` — Vitest then Playwright in series. Used in CI; run locally before opening a PR.
- `git push` — Cloudflare Pages auto-deploys from the connected branch; `functions/` ship in the same deploy as the static frontend (no separate worker deploy step).

## Architecture

- **Frontend** (`src/`, `index.html`, `package.json`): Vite + TypeScript. Entry HTML `/index.html`, bootstrap in `src/main.ts`. The bootstrap is web-only: `bootstrapWeb` orchestrates `parseSpecUrl(href)` → `renderLanding` (no/invalid params) | `renderViewerHeader` + `mountViewer` (success) | `renderViewerError` (fetch fail). Read-only Milkdown viewer with URL-scheme allowlist sanitizer (`sanitizeUrlAttributes`), heading-anchor IDs, broken-image fallback. JIT auth has two entry points — the visible `Edit` button rendered into the viewer header (primary) and a content-modifying `keydown` listener on the editor host (secondary) — both routing through `attemptEditAction` → `enterEditMode` (push-perm holders) | `renderViewOnlyLock` (no push) | redirect to `/auth/start` (unauth). Save flow via `submitSave` → `POST /api/save` → renders success/conflict/error banner.
- **Worker** (`worker/`): Cloudflare Worker (own npm workspace). Endpoints: `GET /health`, `GET /auth/start`, `GET /auth/callback`, `POST /auth/logout`, `GET /api/session-status`, `POST /api/github/*` (proxy with installation token), `POST /api/save` (creates branch + commits + opens PR). Hand-rolled router. WebCrypto SubtleCrypto for JWT signing (no nodejs_compat needed). Session cookie HttpOnly + Secure + SameSite=Lax; opaque session ID keyed to KV-stored installation token + user record.
- **JS toolchain: Vite + TypeScript + Milkdown.** `dist/` is Vite build output and is gitignored — don't edit files there. v0.2 rendering polish (GFM tables, fenced code, list rhythm, H1 underline, broken-image fallback, frontmatter recognition) is preserved and applies in both viewer and editor modes.
- **Tests**: frontend in `src/__tests__/` (Vitest + jsdom); worker in `worker/test/` (Vitest + `@cloudflare/vitest-pool-workers`).

## v0.3 external actions

The Cloudflare deployment + GitHub App registration + secret provisioning are tracked in #98 (a single tracking issue for the human-only, non-TDD work the ship-milestone loop cannot automate). The web app is non-functional in production until those steps complete; tests cover all behavior in isolation.
