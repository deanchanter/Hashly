//! Issue #25 — Converge `strip_comments` helper.
//!
//! This file is the **contract test** for AC #1 of issue #25: a single,
//! hardened `strip_comments` helper must live in a shared test module
//! (`tests/common/mod.rs`) and be reachable from any integration test
//! file via `mod common;`.
//!
//! Why a dedicated test crate (instead of inlining into one of the
//! existing consumers)?  Each `tests/*.rs` file under Cargo's
//! integration-test convention is its own crate, and the standard
//! pattern for sharing helpers is `tests/common/mod.rs` with each
//! consumer declaring `mod common;`.  Pinning the contract from a
//! third, dedicated consumer proves the module is genuinely shared
//! (importable from any crate, not accidentally tied to one of the
//! existing files) and gives a stable home for the contract assertion
//! that will not get tangled up in the consumer-side migration steps.
//!
//! AC under test (Issue #25 AC #1): the shared helper
//!   - exists at `src-tauri/tests/common/mod.rs`
//!   - is `pub` and named `strip_comments`
//!   - correctly handles the `'/*' inside a string literal` regression
//!     pattern that broke the earlier, simpler `strip_ts_comments`
//!     helper in `frontend.rs` (i.e. content AFTER a `/*` inside a
//!     single-quoted string is preserved verbatim).

mod common;

#[test]
fn shared_strip_comments_preserves_content_after_slash_star_inside_string_literal() {
    // The exact landmine pattern called out in Issue #25: a `/*` inside a
    // string literal must NOT trip the block-comment state and must NOT
    // eat the `sourcemap: true` that follows on a later line. This is
    // the regression test that motivates lifting the hardened helper
    // (build_strictness.rs:66-133) into a shared module instead of
    // leaving the buggy `strip_ts_comments` (frontend.rs:236-273) in
    // place.
    let src = "watch: { ignored: ['**/src-tauri/**'] },\nbuild: { sourcemap: true },";
    let stripped = common::strip_comments(src);

    assert!(
        stripped.contains("sourcemap: true"),
        "shared `common::strip_comments` must preserve content AFTER a `/*` \
         that appears inside a string literal — the buggy `strip_ts_comments` \
         in frontend.rs would eat the rest of the file (Issue #25 AC #1). \
         Got:\n{}",
        stripped
    );
    assert!(
        stripped.contains("'**/src-tauri/**'"),
        "shared `common::strip_comments` must preserve string-literal \
         contents verbatim, including the `/*` and `*/` sequences inside \
         the glob (Issue #25 AC #1). Got:\n{}",
        stripped
    );
}
