## Why

v0.3 deployed to `hashly-md.pages.dev` on 2026-05-05. The static viewer renders public-repo specs anonymously and works end-to-end. The auth and save flows do **not** work in production: the frontend calls `/auth/*` and `/api/*` as same-origin paths (`src/save-flow.ts:27`, `src/session-indicator.ts:44,105`, `src/edit-mode.ts:318,373,424`), but no Pages-side router catches those prefixes — the standalone `hashly-worker` deploy lives at a separate `*.workers.dev` URL that the Pages origin cannot reach without either a custom domain (deferred per #98 item 12) or a Pages Functions service-binding proxy (never landed in repo).

The vision-doc note (`specs/hashly-vision.md:71`) framed v0.3.1 as "hosting consolidation" — accurate in mechanics but understated in scope. The functional reality: **v0.3.1 is the milestone that makes v0.3's auth and save flows reachable in production**. Until it lands, only the anonymous viewer is exercisable end-to-end.

Porting the worker source into Pages Functions also collapses two deploy cycles (`git push` for static + `cd worker && npx wrangler deploy` for backend) into one and consolidates secrets + KV onto the Pages project.

## What Changes

- **NEW**: Port `worker/src/{auth,env,index,proxy,save}.ts` (1,138 LOC, 5 files) into `functions/` with file-based routing — `functions/auth/start.ts`, `functions/api/save.ts`, `functions/api/github/[[path]].ts`, etc. Each file exports `onRequest` and delegates to a pure handler in `functions/_shared/`. The dispatch layer (`worker/src/index.ts`'s switch) is replaced by Pages' filesystem routing.
- **NEW**: Cloudflare Pages project picks up `functions/` automatically on next deploy. One `git push`, one deploy cycle.
- **REMOVED**: `worker/` directory — both the source and its npm workspace entry. Removal is a **hard in-milestone prerequisite**, not a follow-up: the workspace's stale `vitest@3.2.4` hoists `@vitest/pretty-format@3.2.4` into root `node_modules` and crashes the upgraded pool's miniflare (verified by 2026-05-05 spike).
- **NEW**: Bump root devDeps — `@cloudflare/vitest-pool-workers` `^0.8.0` → `^0.16.0`; `wrangler` `^4.87.0` → `^4.88.0`. The 0.16.0 pool exports the `cloudflareTest` and `buildPagesASSETSBinding` APIs needed for Pages-mode testing.
- **NEW**: Vitest config restructured around pool 0.16.0's plugin shape (`cloudflareTest({ ... })` rather than `defineWorkersConfig({ poolOptions: { workers: ... }})`). Pool ships a codemod (`vitest-v3-to-v4.mjs`) that automates the config-side migration.
- **NEW**: 20 existing tests in `worker/test/` move to `functions/__tests__/` (or equivalent) with a 2-line mechanical rewrite per file: `SELF.fetch` → `exports.default.fetch` (`cloudflare:test` → `cloudflare:workers` import). Test bodies, fixtures, and `test-helpers.ts` port unchanged.
- **NEW**: Vitest `globalSetup` step runs `wrangler pages functions build --outdir dist-functions --watch` before tests, bundling functions into a Worker entrypoint the pool can run.
- **BREAKING**: Fork the KV namespace — bind a fresh KV namespace to the Pages project rather than rebinding the existing `1198a0321a05437fb246d041ad7c7953` namespace currently attached to `hashly-worker`. Any sessions issued between v0.3 deploy (2026-05-05) and v0.3.1 land are invalidated; users sign in again. Cohort is near-empty since auth has been unreachable in production all along.
- **NEW**: Bind all five secrets (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `SESSION_HMAC_KEY`) to **both** production and preview environments of the Pages project, with a separate KV namespace for preview. Register the preview-deploy callback URL pattern in the GitHub App so OAuth callback completes on PR previews.
- **NEW**: Rotate `SESSION_HMAC_KEY` and the GitHub App private key as part of the migration — free, since the new namespace has zero existing sessions.
- **OUT (deferred follow-up, post-merge)**: Tear down the deployed `hashly-worker` Cloudflare Worker (the running service, separate from the source) after one deploy cycle (≥1 week of green Pages Functions auth + save flows in production). The deployed worker stays as a rollback target during that window even though its source is gone from the repo.
- **NEW (mechanical, alongside)**: Normalize structural headers on `openspec/specs/spec-link-viewer/spec.md` and `openspec/specs/spec-pr-editor/spec.md` — same `## Purpose` / `## Requirements` insertion as `github-app-backend`. All three specs now pass strict openspec validation. No requirement-level changes to either; description text untouched.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `github-app-backend`: (a) ADD a same-origin requirement (delta in `specs/github-app-backend/spec.md`). The current spec says nothing about where the backend lives, but the frontend's `fetch(..., { credentials: 'same-origin' })` calls (`src/save-flow.ts:29`, `src/session-indicator.ts:45,107`, `src/edit-mode.ts:319`) silently require backend = frontend origin. v0.3 shipped with this constraint violated (backend on `*.workers.dev`), making auth + save unreachable. v0.3.1 makes the implicit constraint hold and the spec documents it explicitly to prevent regression. (b) Structural normalization of `openspec/specs/github-app-backend/spec.md` itself: add the `## Purpose` and `## Requirements` section headers required by current openspec schema. Pre-existing schema-validation failure unrelated to v0.3.1's behavioral change, but folded in here because we're editing the same file anyway. Description text minimally clarified to note that "Cloudflare Worker" includes Pages Functions.

`spec-link-viewer` and `spec-pr-editor` were audited during exploration — both are behavioral specs with no deploy-topology requirements; no requirement-level deltas. Both also receive the same `## Purpose` / `## Requirements` structural normalization as `github-app-backend` (pre-existing schema-validation failure unrelated to behavior; folded into this changeset for repo hygiene). All three capability specs now pass strict openspec validation.

## Impact

- **Code**: `worker/` (1,138 LOC across 5 source files + 20 tests + workspace config) deleted. `functions/` added with handlers ported from `worker/src/` and shared helpers in `functions/_shared/`. `vitest.pages.config.ts` (or merged into root vitest config) added; `worker/vitest.config.ts` removed.
- **Dependencies**: Root `package.json` adds `@cloudflare/vitest-pool-workers@^0.16.0` (devDep), bumps `wrangler` to `^4.88.0`. Worker workspace and its 1,138-LOC dep tree (`@octokit/auth-app`, `@octokit/core`, the worker-pinned `wrangler@^3.95.0`, `vitest@~3.2.0`, `@cloudflare/vitest-pool-workers@^0.8.0`) deleted. Net devDep count likely down.
- **Secrets / infrastructure**: Five secrets and two KV namespaces (production + preview) re-bound at the Pages-project level. The deployed `hashly-worker` keeps its current secrets and KV for the one-cycle rollback window, then is `wrangler delete`'d in a follow-up commit.
- **GitHub App**: Callback URL allowlist updated to include preview deploys (wildcard if supported, else per-branch — exact mechanism resolved during migration). Existing production callback `https://hashly-md.pages.dev/auth/callback` unchanged.
- **Tests**: 20-file mechanical rewrite (codemod + sed). Test count and coverage unchanged. Real-`workerd` runtime assurance preserved (Decision 4 in design.md).
- **Documentation**: `CLAUDE.md` updated — drop the `cd worker && npm test` and `cd worker && npx wrangler deploy` commands; replace with single `npm test` and `git push` deploy. The `## Architecture` "Worker (`worker/`)" section becomes "Pages Functions (`functions/`)". `specs/hashly-vision.md:71` v0.3.1 entry status flipped from "planned" to "shipped" once merged.
- **Deploy operations**: Two deploys → one. The standalone `wrangler deploy` step retires (after the one-cycle rollback window).
- **Vision alignment**: Completes v0.3's stated commitment ("the validated PM/dev workflow actually requires" auth + save) by making those flows reachable in production. No vision-doc requirement changes.
