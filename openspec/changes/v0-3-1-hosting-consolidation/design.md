## Context

v0.3 shipped to `hashly-md.pages.dev` on 2026-05-05. The static viewer renders public-repo specs anonymously. The auth and save flows do **not** work in production: the frontend calls `/auth/*` and `/api/*` as same-origin paths (`src/save-flow.ts:27`, `src/session-indicator.ts:44,105`, `src/edit-mode.ts:318,373,424`), but no Pages-side router catches those prefixes. The standalone `hashly-worker` was deployed via `cd worker && npx wrangler deploy` to a `*.workers.dev` URL — Cloudflare's free `*.pages.dev` domain has no mechanism to forward path prefixes to a separate Worker without either (a) a custom domain (deferred per #98 item 12) or (b) a Pages Functions service-binding proxy (never landed in repo).

The vision-doc entry for v0.3.1 (`specs/hashly-vision.md:71`) frames this as "hosting consolidation" — accurate in mechanics but understated in scope. The functional reality: **v0.3.1 is the milestone that makes v0.3's auth and save flows reachable in production**. Until it lands, only the anonymous viewer is exercisable end-to-end.

The fix moves the Worker's source into Pages Functions (`functions/`) so the static frontend and the backend share one origin, one deploy, and one bound set of secrets + KV. No new behavior; no new endpoints; no new requirements on the three existing capability specs.

## Goals / Non-Goals

**Goals:**
- `/auth/start`, `/auth/callback`, `/auth/logout`, `/api/session-status`, `/api/github/*`, `/api/save` reachable on `https://hashly-md.pages.dev` end-to-end.
- One deploy cycle: `git push` → Cloudflare Pages auto-deploys both static assets and Functions. No `cd worker && npx wrangler deploy` step.
- Secrets and KV bound at the Pages-project level. The standalone `hashly-worker` deploy is retired.
- Existing test surface (20 worker tests) survives the move with minimal diff.

**Non-Goals:**
- No new endpoints. No new auth paths. No spec changes to `github-app-backend`, `spec-link-viewer`, or `spec-pr-editor`.
- No custom domain (still deferred per #98 item 12).
- No three-way merge (still deferred to #124).
- No deletion of `worker/` source until Pages Functions is verified green in production for one deploy cycle.

## Decisions

### Decision 1 — File-based routing under `functions/`

**Choice**: Mirror the existing endpoints as file-based Pages Functions:

```
functions/
├── auth/
│   ├── start.ts          → GET  /auth/start
│   ├── callback.ts       → GET  /auth/callback
│   └── logout.ts         → POST /auth/logout
├── api/
│   ├── session-status.ts → GET  /api/session-status
│   ├── save.ts           → POST /api/save
│   └── github/
│       └── [[path]].ts   → ANY  /api/github/*
└── _shared/
    ├── auth.ts           (helpers from worker/src/auth.ts)
    ├── env.ts            (Env type)
    ├── proxy.ts          (handleGitHubProxy logic)
    └── save.ts           (handleSave logic)
```

**Rationale**: File-based routing matches Pages Functions' idiomatic shape and gives per-route observability in the Cloudflare dashboard. The route shape mirrors the spec's resource model. Each file exports `onRequest` (or `onRequestGet`/`onRequestPost`) and delegates to a pure handler imported from `_shared/`, so the handler-level logic that already exists in `worker/src/{auth,proxy,save}.ts` ports near-verbatim — only the dispatch layer (`worker/src/index.ts`'s switch) is replaced by the filesystem.

**Alternatives considered**:
- **Catch-all `functions/[[path]].ts` re-using the existing switch**: smaller diff (literally copy `worker/src/index.ts`), but loses per-route observability and is non-idiomatic for Pages. Rejected.
- **Hono / itty-router inside a catch-all**: adds a dependency to solve a problem the filesystem already solves. Rejected.

### Decision 2 — Fork the KV namespace

**Choice**: Create a fresh KV namespace bound to the Pages project. Do **not** rebind the existing namespace (`1198a0321a05437fb246d041ad7c7953`) currently attached to `hashly-worker`. Document in the migration tasks that any active sessions from 2026-05-05 will be invalidated; users sign in again.

**Rationale**: Fewer moving pieces. Rebinding requires unbinding from the worker first — a non-atomic two-step against shared production state. Forking is one create + one bind, fully reversible if the deploy is rolled back. Session count is tiny (the auth flow has been broken in production since deploy), so the UX cost is near-zero.

**Trade-off acknowledged**: technically a behavior change — sessions from before v0.3.1 stop working. Acceptable given (a) the auth flow itself is unreachable in production today, so the cohort is essentially empty, and (b) this is a one-time event tied to the migration.

**Alternatives considered**:
- **Rebind the same namespace**: preserves sessions but requires an unbind step against a live worker. Rejected — solves a problem we don't have.

### Decision 3 — Bind real secrets to the preview environment

**Choice**: Configure all five secrets (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `SESSION_HMAC_KEY`) in **both** the production and preview environments of the Pages project. Use a separate KV namespace for preview to avoid preview auth flows writing into production session storage. Register the preview-deploy callback URL pattern (`https://*.hashly-md.pages.dev/auth/callback`, or per-branch as Cloudflare assigns) in the GitHub App so OAuth callback completes on preview branches.

**Rationale**: Branch-preview deploys are the primary way the milestone-PR review surface gets exercised before merge. If preview deploys can only render the anonymous viewer (because secrets and KV are production-only), reviewers cannot verify the auth and save paths on the PR before approving. That defeats the purpose of having previews.

**Trade-off acknowledged**: GitHub Apps treat callback URLs as an explicit allowlist. Cloudflare Pages assigns preview URLs of the form `<branch>.<project>.pages.dev` — these need to be either wildcard-registered (if the GitHub App allows it) or registered per branch (operationally annoying). The migration tasks must cover this.

**Alternatives considered**:
- **Production-only secrets, preview = viewer-only**: rejected — milestone-PR review can't validate auth/save.
- **Shared KV between prod and preview**: rejected — preview auth artifacts would pollute production session storage.

### Decision 4 — Pages-mode pool for tests (Path X′), spike-validated

**Choice**: Keep `@cloudflare/vitest-pool-workers`, but adopt the v4 plugin shape (`cloudflareTest({ main: "./dist-functions/index.js", ... })` rather than the v3 `defineWorkersConfig({ poolOptions: { workers: ... }})` shape). A Vitest `globalSetup` step runs `wrangler pages functions build --outdir dist-functions --watch` before tests, bundling `functions/**/*.ts` into a single Worker entrypoint. Tests black-box that bundle via `exports.default.fetch(...)` rather than `SELF.fetch(...)`.

**Rationale**: The pool does not execute Pages Functions natively — it executes Workers. Pages Functions get bundled to a Worker entrypoint by `wrangler pages functions build`, and the pool tests against that. The behavioral surface (pathname + method → response) is preserved; the test invocation idiom changes.

**Spike outcome (2026-05-05)**: Path X′ proven on a worktree branch. Single `functions/health.ts` → bundled to `dist-functions/index.js` → tested via `exports.default.fetch("https://x.test/health")` → green in 1.4s. Spike artifacts discarded; design captures the verified pattern.

**Verified prerequisites for the milestone**:
- `@cloudflare/vitest-pool-workers` upgrade `^0.8.0` → `^0.16.0` (root devDep). The 0.16.0 release exports `cloudflareTest` and `buildPagesASSETSBinding`; 0.8.x does not.
- Root `wrangler` upgrade `^4.87.0` → `^4.88.0` (matches what pool 0.16.0 ships with).
- Root `vitest` stays at `^4.1.5` (pool 0.16.0 peer-dep allows this; pool's transitive `@vitest/runner@4.1.5` resolves cleanly when the worker workspace is removed).
- The worker workspace's stale `vitest@3.2.4` causes `@vitest/pretty-format@3.2.4` to hoist into root `node_modules`, which crashes the pool's bundled miniflare with a `'createDOMElementFilter' export not found` SyntaxError. **Therefore** the v0.3.1 task list MUST delete the `worker/` workspace (or remove it from `package.json#workspaces`) BEFORE the first `npm install` against the new Pages-mode setup. This makes the worker-workspace deletion a hard prerequisite, not a "follow-up cleanup" — and tightens Decision 5 below.

**Test rewrite scope**: each of the 20 existing tests in `worker/test/` needs a 2-line mechanical edit:

```diff
- import { SELF } from "cloudflare:test";
+ import { exports } from "cloudflare:workers";
  // ...
- const res = await SELF.fetch("https://worker.test/health");
+ const res = await exports.default.fetch("https://worker.test/health");
```

Test bodies, assertions, fixtures, and the `test-helpers.ts` module port unchanged. A codemod is shipped in the pool — `node_modules/@cloudflare/vitest-pool-workers/codemods/vitest-v3-to-v4.mjs` — that automates the vitest-config side of this transition (`defineWorkersProject` → `cloudflareTest` plugin); the test-body rewrite is a separate `sed`-able pass.

**Alternatives considered**:
- **Path Y (test-shim)**: a `worker/test-shim/index.ts` re-implements the dispatch switch, tests run against the shim, prod runs Pages Functions. Two routers to keep in sync — exactly the duplication v0.3.1 is supposed to remove. Rejected.
- **Path Z (direct handler import)**: rewrite each test to import the function and invoke with constructed `Request` + `env`. Loses the real-`workerd` runtime assurance the existing suite was deliberately built around. Rejected — Path X′ retains the assurance at lower diff cost.

### Decision 5 — Delete `worker/` workspace immediately; keep the deployed `hashly-worker` for rollback

**Choice**: Two-stage retirement, split because the spike (Decision 4) revealed the workspace deletion is non-optional.

- **Stage 1 (in this milestone, hard prerequisite)**: Delete the `worker/` directory from disk and remove it from `package.json#workspaces`. Required before the new Pages-mode tests can install cleanly — the workspace's stale `vitest@3.2.4` poisons hoisting for the pool's miniflare.
- **Stage 2 (post-merge follow-up)**: Keep the deployed `hashly-worker` Cloudflare Worker (the running service, not the source) live for one deploy cycle (≥1 week of green auth + save flows on Pages Functions in production). Then `wrangler delete` it. The `wrangler.toml` and KV namespace `1198a0321a05437fb246d041ad7c7953` are torn down at this point.

**Rationale**: The v0.3 design.md retention pattern — "keep rollback surface for one cycle" — was designed for a low-traffic Rust crate (`src-tauri/`) that didn't poison the build. The Worker source is different: leaving it in the workspace breaks the new tests. So the source goes immediately, and the rollback surface lives only at the deployed level (where it is one `wrangler deploy worker/` command back if we re-add the directory from git history).

**Rollback recipe (if needed)**: `git revert` the delete-worker commit, `cd worker && npm install && npx wrangler deploy`, point Pages routing back to the worker via the dashboard. Documented in tasks.md when written.

**Updated R1 / R3 / R5 implication**: the rollback path is more involved than v0.3's `src-tauri/` rollback (which was a no-op since `src-tauri/` was already not built). We accept this for the spike-driven hoisting reason.

## Risks

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | ~~Pool's Pages-mode doesn't support `SELF.fetch` cleanly~~ — **resolved by 2026-05-05 spike**. Pool 0.16.0 supports Pages via `cloudflareTest` plugin + `wrangler pages functions build`; existing tests need a 2-line mechanical rewrite (`SELF.fetch` → `exports.default.fetch`). Severity downgraded Medium → Low. | Low | Codemod ships with pool (`vitest-v3-to-v4.mjs`); test-body rewrite is `sed`-able |
| R2 | GitHub App callback URL allowlist doesn't accept wildcards → per-branch registration needed | Medium | Document in tasks; if too painful, restrict callback to production and accept "preview = viewer-only" |
| R3 | Pages Functions has different request size or CPU limits than Workers, breaking `/api/save` for large files | Low | Markdown specs are small (typical < 50 KB); verify with manual test on a real spec post-deploy |
| R4 | Secret migration leaks secrets in transit (e.g., logged in `wrangler pages secret put` output, or screenshotted from dashboard) | Low | Use dashboard for one-time secret entry; rotate `SESSION_HMAC_KEY` and the GitHub App private key as part of the migration |
| R5 | `*.pages.dev` preview URLs cycle (Cloudflare assigns new subdomains per branch) and the GitHub App's allowlist drifts | Low | Document in operator runbook; revisit when custom domain lands |

## Open questions

1. ~~Does `@cloudflare/vitest-pool-workers` Pages-mode support `SELF.fetch` against file-based functions?~~ **Resolved 2026-05-05**: yes via `cloudflareTest` plugin and `exports.default.fetch` (not `SELF.fetch`). Pool must be on `^0.16.0`; worker workspace must be deleted to avoid hoisting collisions.
2. Does the GitHub App registration accept a wildcard callback URL for `*.hashly-md.pages.dev`, or must each preview branch be registered individually? **Resolved during migration — first preview deploy will reveal which.**
3. Should `SESSION_HMAC_KEY` be rotated as part of the migration even if KV is forked? **Recommended: yes, since the new namespace has zero existing sessions, rotation is free.**

## Out of scope

- Custom domain (deferred per #98 item 12).
- Three-way merge for stale-SHA conflicts (#124).
- Any change to the three capability specs (`github-app-backend`, `spec-link-viewer`, `spec-pr-editor`) — pure implementation move.
- Deletion of `src-tauri/` (separate post-#95 follow-up, not gated on this milestone).
