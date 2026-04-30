//! Shared test helpers for the `hashly` integration test suite.
//!
//! This module is the canonical home for the hardened `strip_comments`
//! helper that started life as a private fn in `build_strictness.rs`
//! and (in a buggy form) in `frontend.rs`. Issue #25 converged the
//! two so all integration-test consumers run identical, string-
//! literal-aware comment stripping.
//!
//! Cargo treats every file under `tests/` as its own integration-test
//! crate. The standard pattern for sharing helpers across those crates
//! is `tests/common/mod.rs` (NOT `tests/common.rs`, which would be
//! discovered as its own test crate). Each consumer file declares
//! `mod common;` at the top.

/// Strip `//` line comments and `/* ... */` block comments from a TS/JSON
/// source string while respecting string-literal boundaries.
///
/// A naïve "find `//` or `/*` and skip" stripper is bitten by perfectly
/// legitimate code — e.g. vite.config.ts contains the glob string literal
/// `'**/src-tauri/**'`, where the `/*` inside the string would put a naïve
/// stripper into block-comment mode and eat the rest of the file (including
/// our `sourcemap: true` assertion target). The team's prior `frontend.rs`
/// helper had this latent bug; the build_strictness tests exposed it. Issue
/// #25 lifted this hardened version into the shared `common` module so all
/// consumers benefit.
///
/// This stripper is a small state machine over five states:
///   - Code           — default; recognises `//`, `/*`, `'`, `"`, `` ` ``
///   - LineComment    — until `\n` (newline is preserved in output)
///   - BlockComment   — until matching `*/`
///   - String         — single, double, or backtick; copies verbatim, honors
///                      `\` escapes (the next char is copied even if it's a
///                      quote of the same kind)
///
/// Limitations (documented, accepted):
///   - Regex literals `/.../` are NOT recognised. A `/` followed by `*` or
///     `/` inside a regex would be misinterpreted. None of the files we
///     inspect contain regex literals.
///   - Template-literal interpolations (`${ ... }` inside backticks) are
///     treated as part of the string — comments inside an interpolation are
///     NOT stripped. None of the files we inspect use interpolations.
///   - HTML comments / shebangs / etc. are not handled (irrelevant here).
pub fn strip_comments(src: &str) -> String {
    enum State {
        Code,
        LineComment,
        BlockComment,
        // String state: tracks the closing quote char.
        Str(char),
    }

    let mut out = String::with_capacity(src.len());
    let mut state = State::Code;
    let mut chars = src.chars().peekable();

    while let Some(c) = chars.next() {
        match state {
            State::Code => {
                match c {
                    '/' => match chars.peek() {
                        Some('/') => {
                            chars.next();
                            state = State::LineComment;
                        }
                        Some('*') => {
                            chars.next();
                            state = State::BlockComment;
                        }
                        _ => out.push(c),
                    },
                    '\'' | '"' | '`' => {
                        out.push(c);
                        state = State::Str(c);
                    }
                    _ => out.push(c),
                }
            }
            State::LineComment => {
                if c == '\n' {
                    out.push(c); // preserve newline so line-based logic still works
                    state = State::Code;
                }
                // else: drop the comment char.
            }
            State::BlockComment => {
                if c == '*' {
                    if let Some(&'/') = chars.peek() {
                        chars.next();
                        state = State::Code;
                    }
                }
                // else: drop the comment char.
            }
            State::Str(quote) => {
                out.push(c);
                if c == '\\' {
                    // Escape: copy the next char verbatim and DON'T let it
                    // close the string. This handles `'\''`, `"\""`, etc.
                    if let Some(esc) = chars.next() {
                        out.push(esc);
                    }
                } else if c == quote {
                    state = State::Code;
                }
            }
        }
    }

    out
}
