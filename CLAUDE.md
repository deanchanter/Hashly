# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Hashly** — a free, WYSIWYG markdown reader/editor for Spec-Driven Development workflows. v0.3 is a web app at <https://hashly.pages.dev>: paste a GitHub spec link as a URL parameter, edit WYSIWYG, save → opens a pull request on the source repo. Frontend is Vite + TypeScript + [Milkdown](https://milkdown.dev/); backend is a Cloudflare Worker holding GitHub App credentials.

The desktop app (Tauri-based, macOS only) was sunset in v0.3. v0.2.3 was the final desktop release; the `src-tauri/` crate remains in the repo for rollback safety but is no longer in the active build path. Full deletion is a post-merge follow-up to #95 once v0.3 has shipped green for one week. The repo was previously named `pomodoro`; update any stale references.

Specs live in `specs/` (historical milestones) and `openspec/changes/` (current pivot). Product direction: `specs/hashly-vision.md`. Latest shipped milestone: `openspec/changes/v0-3-web-pivot/` (web pivot — sunsets desktop, adds anonymous-read viewer + JIT-auth edit + PR-back save). Previous milestone: `specs/v0.2.3-bundle-signing/` (final desktop release).

## Commands

Run from the repo root:

- `npm install` — one-time install of the JS toolkit (Vite, TypeScript, Milkdown, etc.). Required before the first `npm run dev`.
- `npm run dev` — Vite dev server at <http://localhost:1420>. Loads `index.html` → `src/main.ts`. URL params drive the viewer (`?repo=...&path=...&ref=...`).
- `npm run build` — Vite production build (output: `dist/`).
- `npm test` — runs the Vitest + jsdom frontend suite (`tsc --noEmit && vitest run`). Tests live in `src/__tests__/`. `vitest.setup.ts` opts existing v0.2 tests into Tauri mode by default; web-mode tests opt out per-test.
- `cd worker && npm test` — runs the Worker test suite (Vitest + `@cloudflare/vitest-pool-workers` against real `workerd`). Tests in `worker/test/`.
- `cd worker && npx wrangler deploy` — deploys the Worker (requires Cloudflare account + secrets per #98 external-actions checklist).

The legacy `cargo tauri dev` / `cargo tauri build` commands no longer build a runnable app (workspace has no active members; the `src-tauri/` crate's CI cargo job has been removed). They're preserved on disk for rollback only.

## Architecture

- **Workspace** (`/Cargo.toml`): empty after v0.3 sunset. `src-tauri/` directory exists on disk but is not built. Full deletion is a post-#95 follow-up.
- **Frontend** (`src/`, `index.html`, `package.json`): Vite + TypeScript. Entry HTML `/index.html`, bootstrap in `src/main.ts`. The bootstrap branches on `window.__TAURI_INTERNALS__`:
  - **Web mode** (browser): `bootstrapWeb` orchestrates `parseSpecUrl(href)` → `renderLanding` (no/invalid params) | `renderViewerHeader` + `mountViewer` (success) | `renderViewerError` (fetch fail). Read-only Milkdown viewer with URL-scheme allowlist sanitizer (`sanitizeUrlAttributes`), heading-anchor IDs, broken-image fallback. JIT auth via keydown listener → `attemptEditAction` → `enterEditMode` (push-perm holders) | `renderViewOnlyLock` (no push) | redirect to `/auth/start` (unauth). Save flow via `submitSave` → `POST /api/save` → renders success/conflict/error banner.
  - **Tauri mode** (existing v0.2 desktop tests): preserved unchanged. Tauri-coupled save/open paths in `src/main.ts` continue to work; v0.2 frontend tests assert their behavior. (The Tauri runtime itself is no longer built — these tests run in jsdom with `__TAURI_INTERNALS__ = {}` set globally.)
- **Worker** (`worker/`): Cloudflare Worker (own npm workspace). Endpoints: `GET /health`, `GET /auth/start`, `GET /auth/callback`, `POST /auth/logout`, `GET /api/session-status`, `POST /api/github/*` (proxy with installation token), `POST /api/save` (creates branch + commits + opens PR). Hand-rolled router. WebCrypto SubtleCrypto for JWT signing (no nodejs_compat needed). Session cookie HttpOnly + Secure + SameSite=Lax; opaque session ID keyed to KV-stored installation token + user record.
- **JS toolchain: Vite + TypeScript + Milkdown.** `dist/` is Vite build output and is gitignored — don't edit files there. v0.2 rendering polish (GFM tables, fenced code, list rhythm, H1 underline, broken-image fallback, frontmatter recognition) is preserved and applies in both viewer and editor modes.
- **Tests**: frontend in `src/__tests__/` (Vitest + jsdom); worker in `worker/test/` (Vitest + `@cloudflare/vitest-pool-workers`); legacy Rust integration tests in `src-tauri/tests/` are no longer run (src-tauri removed from active workspace).

## v0.3 external actions

The Cloudflare deployment + GitHub App registration + secret provisioning are tracked in #98 (a single tracking issue for the human-only, non-TDD work the ship-milestone loop cannot automate). The web app is non-functional in production until those steps complete; tests cover all behavior in isolation.
