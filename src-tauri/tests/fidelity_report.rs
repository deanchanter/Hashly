use std::fs;
use std::path::PathBuf;

// Issue #45 AC4 — Cargo-side gate test. The fidelity disposition report at
// `specs/v0.2-mvp-completion/fidelity-report.md` is a hard prerequisite for
// slice 2 / issue #7 (Save in place via Cmd+S): if save lands without a
// committed report enumerating each lossy markdown form, save ships
// information loss as a surprise rather than a documented disposition.
//
// This test fails the cargo build if the report goes missing or shrinks
// below a non-trivial threshold — pairs with the vitest-side pins in
// `src/__tests__/fidelity.test.ts` (which assert per-case content).
// Together they prevent the report from being deleted, emptied, or
// silently drifting from the corpus.

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn read_repo_file(rel: &str) -> String {
    let path = repo_root().join(rel);
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e))
}

const REPORT_PATH: &str = "specs/v0.2-mvp-completion/fidelity-report.md";

#[test]
fn fidelity_report_exists_at_canonical_path() {
    // The path is part of the contract — the vitest gate uses it
    // verbatim, the cargo gate uses it verbatim, and any tooling that
    // generates / lints the report keys on this exact location. Moving
    // the file requires updating both gates simultaneously, which is
    // what we want.
    let path = repo_root().join(REPORT_PATH);
    assert!(
        path.exists(),
        "expected fidelity disposition report at `{}` (Issue #45 AC4 — slice 2 / #7 Save in place \
         is gated on this file existing). Got missing path: {}",
        REPORT_PATH,
        path.display(),
    );
}

#[test]
fn fidelity_report_is_non_trivial() {
    // A 0-byte or near-empty file would satisfy the existence check above
    // but defeat the purpose of the gate. We require ≥ 500 bytes so a
    // contributor can't satisfy the check by `touch`-ing the file.
    // The current report is ~3.5 KB; 500 B is comfortably below that
    // while ruling out empty / placeholder files.
    let report = read_repo_file(REPORT_PATH);
    assert!(
        report.trim().len() >= 500,
        "expected `{}` to be non-trivial (≥ 500 bytes after trim) so the gate is real, \
         not a placeholder (Issue #45 AC4). Got {} bytes:\n{}",
        REPORT_PATH,
        report.trim().len(),
        report,
    );
}

#[test]
fn fidelity_report_self_identifies_as_the_v0_2_slice_1_artifact() {
    // Pin the report's identity verbatim so a contributor can't ship a
    // different document at the same path. The self-identification mentions
    // both the slice number / issue and the milestone — either alone is too
    // weak (slice numbers may renumber; milestones live across many docs).
    let report = read_repo_file(REPORT_PATH);
    assert!(
        report.contains("#45"),
        "expected `{}` to reference issue #45 (this slice's GitHub issue) in its preamble \
         so the report's identity is unambiguous (Issue #45 AC4); got:\n{}",
        REPORT_PATH,
        report,
    );
    assert!(
        report.contains("v0.2"),
        "expected `{}` to mention the v0.2 milestone in its preamble; got:\n{}",
        REPORT_PATH,
        report,
    );
}

#[test]
fn fidelity_report_explicitly_states_save_in_place_gate() {
    // The whole point of AC4 is that #7 cannot land without the report
    // existing. The report itself documents the gate (so a contributor
    // reading the report understands what depends on it) — pin the
    // gating language verbatim to this test.
    let report = read_repo_file(REPORT_PATH);
    assert!(
        report.contains("#7"),
        "expected `{}` to reference issue #7 (Save in place via Cmd+S) — the slice that \
         this report gates (Issue #45 AC4); got:\n{}",
        REPORT_PATH,
        report,
    );
    assert!(
        report.to_lowercase().contains("save"),
        "expected `{}` to mention the gated 'Save in place' slice by name (Issue #45 AC4); \
         got:\n{}",
        REPORT_PATH,
        report,
    );
    assert!(
        report.to_lowercase().contains("gat"),
        "expected `{}` to use 'gate' / 'gated' language explicitly so a reader understands \
         this report is a hard prerequisite for slice 2 / #7 (Issue #45 AC4); got:\n{}",
        REPORT_PATH,
        report,
    );
}

#[test]
fn fidelity_report_enumerates_all_three_dispositions() {
    // The three dispositions enumerated in the PRD (`fix upstream` /
    // `flag-out` / `accept as documented v0.2 known-limitation`) must
    // appear in the report's preamble even if the current corpus only
    // uses one of them. This forces the report's structure to be
    // future-proof: when a v0.3 fix-upstream entry lands, the section
    // already exists rather than needing to be invented.
    let report = read_repo_file(REPORT_PATH).to_lowercase();
    for phrase in ["fix upstream", "flag out", "accept"] {
        assert!(
            report.contains(phrase),
            "expected `{}` preamble to enumerate disposition '{}' (Issue #45 AC4 — all three \
             options must be documented even if not all are used in the v0.2 corpus); \
             report (lower-cased) was:\n{}",
            REPORT_PATH,
            phrase,
            report,
        );
    }
}
