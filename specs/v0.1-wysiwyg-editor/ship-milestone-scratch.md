# ship-milestone scratch — v0.1-wysiwyg-editor

Started: 2026-04-30 (continuation; milestone branch already exists with #14, #18, #20, #21, #22 shipped)

User decision: ship everything except #12 (.dmg release). User will manually verify macOS-dependent behavior.

## Planned ordering (topo-aware)

1. #25 — converge strip_comments helper (Rust tests)
2. #15 — UX polish: cursor + tabindex (CSS + TS)
3. #24 — CI SHA pinning (yaml only)
4. #17 — heading slugger (TS, precondition for #3)
5. #16 — dragover guard (TS, precondition for #4)
6. #3 — render full CommonMark fixture (TS)
7. #11 — malformed markdown render (TS, depends on #3)
8. #4 — File > Open menu + CSP (Rust + TS)
9. #10 — binary/non-UTF-8 friendly error (Rust + TS, depends on #4)
10. #6 — read↔edit toggle (TS, depends on #4)
11. #7 — Cmd+S save + dirty indicator (Rust + TS, depends on #6)
12. #8 — unsaved-close dialog (Rust + TS, depends on #7)
13. #5 — Finder double-click handler (Rust config + TS, depends on #4)
14. #9 — light/dark mode follows OS (CSS + TS)

Skipped: #12 (.dmg release) — by user request.

## Per-issue ship log

### #25 — Converge strip_comments helper

Commits:
- `8a0b209 refactor(#25): extract shared strip_comments into tests/common/mod.rs`
- `16113ef test(#25): co-locate string-literal/escape/comment self-tests with shared helper`
- `81cf4c1 refactor(#25): migrate build_strictness.rs and frontend.rs to shared strip_comments`

Tests: cargo (full) green; npm test green. build_strictness 10→7, +3 in strip_comments_self crate, +1 in strip_comments_shared crate, frontend.rs 11 unchanged.

Critical fixed: 0
Non-critical filed: 0 (security teammate failed to deliver findings; team-lead did adversarial pass directly. Mild redundancy: `strip_comments_shared.rs` and `strip_comments_self.rs` could be merged, but each test crate compiles its own copy of `common` regardless — not worth filing.)
Reviewer status: security agent went idle without producing a report despite a follow-up ping. Team-lead substituted.

### #15 — UX polish: cursor + tabindex

Commits:
- `8935672 test(#15): pin .ProseMirror/#editor cursor: default rule in style.css`
- `6b30d71 test(#15): pin tabindex=0 on .ProseMirror root for keyboard scroll`
- `7157789 feat(#15): cursor default + tabindex=0 on read-only ProseMirror root`

Tests: cargo green (frontend.rs 11→14, +3 from #15 contracts); npm 9 (was 8, +1 dynamic tabindex).

Critical fixed: 0
Non-critical filed: 0
Process note: qa-tdd committed RED tests despite the brief instruction to wait for green. Team-lead caught it (suite was failing), pinged builder to apply impl, and committed feat() commit himself since both qa-tdd and builder went idle without committing. Tmux orphans accumulated; user manually had me clean them between iterations.
Reviewer status: team-lead substituted (cursor + tabindex changes are minimal-risk; impact on edit mode noted in issue body and will be revisited in #6).

### #24 — Pin GitHub Actions to commit SHAs

Commits:
- `362f416 test(#24): pin SHA-pin contract on every uses: in ci.yml`
- `217cd79 feat(#24): pin GitHub Actions to commit SHAs (supply-chain hardening)`

SHAs pinned (looked up via `gh api repos/<owner>/<repo>/git/ref/...`):
- actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
- actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
- dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable
- Swatinem/rust-cache@42dc69e1aa15d09112580998cf2ef0119e2e91ae # v2

Tests: ci_workflow.rs 9→12 (+3 SHA-pin contract tests; pre-existing tests relaxed to accept SHA refs but still enforce major-version intent via trailing `# v<n>` / `# stable` comments). Full cargo + npm green.

Critical fixed: 0
Non-critical filed: 0
Process note: shipped directly by team-lead — no team spawned. Change is contained (4 yaml lines + test contract update) and prior team agents have been unreliable; faster path for trivial milestone hygiene.

### #17 — Heading slugger uniqueness

Commits:
- `603d781 feat(#17): override headingIdGenerator with standard slug-counter format`

Discovery: dry-run found Milkdown's `syncHeadingIdPlugin` already disambiguates duplicates, but using non-standard `slug-#2`/`slug-#3` format. Issue's stated "duplicate id" claim was technically wrong — but the observed format breaks in-doc anchor links written in GitHub-style `[link](#hello-1)`. Fix: override `headingIdGenerator.key` with closure-captured base→counter Map.

Builder's contribution beyond the brief: added a `WeakMap<Node, string>` cache so the same heading node returns the same id across re-renders (preventing counter-creep when `syncHeadingIdPlugin` re-runs on every transaction). Also short-circuits when `node.attrs.id` is set.

Tests: npm 9→10 (+1 dynamic id-uniqueness); cargo frontend 14→15 (+1 static contract). All green.

Critical fixed: 0
Non-critical filed: 0
Process note: qa-tdd wrote tests but never messaged builder; team-lead pinged builder directly with the implementation details. Both agents went idle without committing; team-lead committed.
Reviewer status: team-lead substituted. Considered: empty-heading edge case (`# ` → id=""); accepted (matches default Milkdown behavior, not introduced by this fix).
