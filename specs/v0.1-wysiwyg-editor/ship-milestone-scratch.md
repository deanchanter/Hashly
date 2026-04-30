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
