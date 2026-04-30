//! Issue #25 AC #3 — self-tests for the shared `common::strip_comments`
//! helper, co-located with it in the integration-test tree.
//!
//! Why a dedicated test crate? `tests/common/mod.rs` is included into
//! every consumer crate that does `mod common;`, so putting the self-
//! tests inside `mod.rs` itself would either run them once per consumer
//! (duplicate-run noise) or require fragile `#[cfg(test)]` gating that
//! does not behave the way it would inside a normal library crate. The
//! cleanest pattern is a single dedicated consumer (`strip_comments_self.rs`)
//! that calls `common::strip_comments` directly — the self-tests then
//! ride physically alongside the helper in the test tree (Issue #25 AC
//! #3) and run exactly once.
//!
//! These three tests are lifted verbatim from the now-soon-to-be-deleted
//! local copies in `build_strictness.rs` (lines 135-199 pre-#25). They
//! lock down the three string-handling guarantees that distinguish the
//! hardened helper from the older buggy `strip_ts_comments`:
//!
//!   1. `/*` inside a string literal does NOT enter block-comment mode.
//!   2. Real `//` line comments and `/* ... */` block comments outside
//!      string literals are still stripped.
//!   3. `\` escapes inside strings prevent the matching quote from
//!      closing the string early (so a `// ...` after a string with an
//!      escaped quote is still recognised as a comment).

mod common;

#[test]
fn strip_comments_preserves_text_inside_string_literals() {
    // Regression test for the bug builder hit on slice A of #14: a `/*`
    // sequence inside a string literal must NOT trip the block-comment
    // state. This is the exact pattern in vite.config.ts's watch.ignored
    // glob.
    let src = r#"
        watch: { ignored: ['**/src-tauri/**'] },
        build: { sourcemap: true },
    "#;
    let stripped = common::strip_comments(src);
    assert!(
        stripped.contains("sourcemap: true"),
        "common::strip_comments must not eat content after a /* sequence inside a string literal. Got:\n{}",
        stripped
    );
    assert!(
        stripped.contains("'**/src-tauri/**'"),
        "common::strip_comments must preserve string-literal contents verbatim. Got:\n{}",
        stripped
    );
}

#[test]
fn strip_comments_still_strips_real_line_and_block_comments() {
    // Confirm the hardening didn't break the original purpose. A `//` and
    // a `/* ... */` outside any string literal must still be stripped.
    let src = r#"
        // a line comment that mentions sourcemap: false
        const x = 1;
        /* a block
           comment that mentions sourcemap: false */
        const y = 2;
    "#;
    let stripped = common::strip_comments(src);
    assert!(
        !stripped.contains("sourcemap: false"),
        "common::strip_comments must still strip both line and block comments. Got:\n{}",
        stripped
    );
    assert!(
        stripped.contains("const x = 1;") && stripped.contains("const y = 2;"),
        "common::strip_comments must preserve real code. Got:\n{}",
        stripped
    );
}

#[test]
fn strip_comments_honors_backslash_escape_in_strings() {
    // `'\\''` — an escaped quote inside a single-quoted string — must NOT
    // close the string early. Otherwise the rest of the line falls into
    // Code state and a real `// comment` after it would be incorrectly
    // stripped.
    let src = r"const s = '\''; // trailing comment with sourcemap: false";
    let stripped = common::strip_comments(src);
    assert!(
        !stripped.contains("sourcemap: false"),
        "trailing line-comment after a string with an escaped quote must still be stripped. Got:\n{}",
        stripped
    );
    assert!(
        stripped.contains(r"'\''"),
        "string-literal contents (incl. the escape sequence) must be preserved. Got:\n{}",
        stripped
    );
}
