//! Issue #14: Tighten production build — sourcemaps + tsconfig strictness.
//!
//! These tests pin the build/typing contract that issue #14 mandates:
//!
//!   - Slice A: `vite.config.ts` sets `build.sourcemap: true` (or `'hidden'`)
//!     so the production bundle ships with debuggable stack traces.
//!   - Slice B: `tsconfig.json` enables the four "ts-vanilla template
//!     defaults" — `noUncheckedIndexedAccess`, `noImplicitOverride`,
//!     `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`.
//!   - Slice C: `npx tsc --noEmit` exits 0 — the new strictness flags must
//!     not leak type errors into the existing source.
//!
//! Pattern matches the existing static-config tests in this directory
//! (`config.rs`, `frontend.rs`, `ci_workflow.rs`): we read the file off
//! disk, parse/inspect, and assert the contract — no live `cargo`/`npm`
//! invocation required for slices A & B. Slice C does shell out to `tsc`,
//! but only when `node_modules/.bin/tsc` is actually present (so CI's
//! cargo job — which doesn't run `npm ci` — skips cleanly without a
//! false negative).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn read_repo_file(rel: &str) -> String {
    let path = repo_root().join(rel);
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e))
}

/// Strip `//` line comments and `/* ... */` block comments from a TS/JSON
/// source string while respecting string-literal boundaries.
///
/// A naïve "find `//` or `/*` and skip" stripper is bitten by perfectly
/// legitimate code — e.g. vite.config.ts contains the glob string literal
/// `'**/src-tauri/**'`, where the `/*` inside the string would put a naïve
/// stripper into block-comment mode and eat the rest of the file (including
/// our `sourcemap: true` assertion target). The team's prior `frontend.rs`
/// helper had this latent bug; the build_strictness tests exposed it.
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
///
/// Mirrors (and supersedes the buggy version of) the helper in `frontend.rs`
/// — duplicated here because Rust integration test files are independent
/// compilation units. If/when frontend.rs's helper is hardened, the two
/// should converge.
fn strip_comments(src: &str) -> String {
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

#[test]
fn strip_comments_preserves_text_inside_string_literals() {
    // Regression test for the bug builder hit on slice A: a `/*` sequence
    // inside a string literal must NOT trip the block-comment state.
    // This is the exact pattern in vite.config.ts's watch.ignored glob.
    let src = r#"
        watch: { ignored: ['**/src-tauri/**'] },
        build: { sourcemap: true },
    "#;
    let stripped = strip_comments(src);
    assert!(
        stripped.contains("sourcemap: true"),
        "strip_comments must not eat content after a /* sequence inside a string literal. Got:\n{}",
        stripped
    );
    assert!(
        stripped.contains("'**/src-tauri/**'"),
        "strip_comments must preserve string-literal contents verbatim. Got:\n{}",
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
    let stripped = strip_comments(src);
    assert!(
        !stripped.contains("sourcemap: false"),
        "strip_comments must still strip both line and block comments. Got:\n{}",
        stripped
    );
    assert!(
        stripped.contains("const x = 1;") && stripped.contains("const y = 2;"),
        "strip_comments must preserve real code. Got:\n{}",
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
    let stripped = strip_comments(src);
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

// =====================================================================
// Slice A — vite.config.ts must enable sourcemaps in the production build.
// =====================================================================

#[test]
fn vite_config_enables_build_sourcemap() {
    // Issue #14 AC #1: production bundle must include sourcemaps so v0.1
    // crashes / stack traces are debuggable. We accept any of the three
    // truthy values Vite documents for `build.sourcemap`:
    //   - `true`         — full inline/sibling sourcemap (preferred for v0.1
    //     since we don't bundle yet)
    //   - `'hidden'`     — emits .map files but does not append the
    //     `//# sourceMappingURL=` comment (used when shipping maps outside
    //     the .app)
    //   - `"hidden"`     — double-quoted form is equally valid TS
    //
    // The literal `false` is explicitly rejected — that's the Vite default
    // and the entire point of #14 is to flip it.
    //
    // Comments are stripped before matching so a contributor cannot satisfy
    // the contract by leaving a `// sourcemap: true` ghost while the real
    // config remains absent or `false`.
    let raw = read_repo_file("vite.config.ts");
    let stripped = strip_comments(&raw);
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    let has_true = normalized.contains("sourcemap:true");
    let has_hidden_single = normalized.contains("sourcemap:'hidden'");
    let has_hidden_double = normalized.contains("sourcemap:\"hidden\"");

    // Reject the explicit-false form to make the failure message obvious.
    let has_false = normalized.contains("sourcemap:false");
    assert!(
        !has_false,
        "vite.config.ts has `sourcemap: false` (Issue #14 AC #1 explicitly requires sourcemaps ENABLED). After comment-strip:\n{}",
        stripped
    );

    assert!(
        has_true || has_hidden_single || has_hidden_double,
        "expected vite.config.ts to set `build.sourcemap: true` (or `'hidden'`) so the production bundle ships with debuggable stack traces (Issue #14 AC #1). After comment-strip:\n{}",
        stripped
    );
}

// =====================================================================
// Slice B — tsconfig.json must enable four strictness flags.
// =====================================================================

/// Parse `tsconfig.json` after stripping JSONC-style comments. tsc itself
/// accepts comments in tsconfig.json; serde_json does not — so we strip
/// them first to avoid coupling the contract to a particular JSON dialect.
fn load_tsconfig() -> serde_json::Value {
    let raw = read_repo_file("tsconfig.json");
    let stripped = strip_comments(&raw);
    serde_json::from_str(&stripped).unwrap_or_else(|e| {
        panic!(
            "tsconfig.json (after comment-strip) is not valid JSON: {}\n--- stripped ---\n{}",
            e, stripped
        )
    })
}

fn assert_compiler_option_true(cfg: &serde_json::Value, key: &str) {
    let opts = cfg
        .get("compilerOptions")
        .and_then(|o| o.as_object())
        .unwrap_or_else(|| panic!("expected `compilerOptions` object in tsconfig.json, got: {:?}", cfg));

    let value = opts.get(key).unwrap_or_else(|| {
        panic!(
            "expected `compilerOptions.{}` in tsconfig.json (Issue #14 AC #2). Present compilerOptions keys: {:?}",
            key,
            opts.keys().collect::<Vec<_>>()
        )
    });

    let as_bool = value.as_bool().unwrap_or_else(|| {
        panic!(
            "expected `compilerOptions.{}` to be a boolean in tsconfig.json (Issue #14 AC #2), got: {:?}",
            key, value
        )
    });

    assert!(
        as_bool,
        "expected `compilerOptions.{}: true` in tsconfig.json (Issue #14 AC #2), got: {}",
        key, as_bool
    );
}

#[test]
fn tsconfig_enables_no_unchecked_indexed_access() {
    // Issue #14 AC #2: `noUncheckedIndexedAccess` makes `arr[i]` and
    // `obj[key]` resolve to `T | undefined` instead of `T`, catching the
    // classic off-by-one / missing-key bug class at type-check time.
    let cfg = load_tsconfig();
    assert_compiler_option_true(&cfg, "noUncheckedIndexedAccess");
}

#[test]
fn tsconfig_enables_no_implicit_override() {
    // Issue #14 AC #2: `noImplicitOverride` forces subclass methods that
    // intentionally override a base method to declare `override`, so an
    // accidental shadow (e.g. base method renamed, subclass not updated)
    // becomes a compile error.
    let cfg = load_tsconfig();
    assert_compiler_option_true(&cfg, "noImplicitOverride");
}

#[test]
fn tsconfig_enables_no_fallthrough_cases_in_switch() {
    // Issue #14 AC #2: `noFallthroughCasesInSwitch` makes a missing `break`
    // / `return` in a non-empty `case:` body a compile error. Eliminates
    // the most common subtle switch-statement bug.
    let cfg = load_tsconfig();
    assert_compiler_option_true(&cfg, "noFallthroughCasesInSwitch");
}

#[test]
fn tsconfig_enables_verbatim_module_syntax() {
    // Issue #14 AC #2: `verbatimModuleSyntax` enforces that imports used
    // only as types are declared with `import type`. Critical under
    // `isolatedModules` (which we already have set) so single-file emit
    // doesn't accidentally drop runtime imports the type system thinks
    // are type-only.
    let cfg = load_tsconfig();
    assert_compiler_option_true(&cfg, "verbatimModuleSyntax");
}

// =====================================================================
// Slice C — `npx tsc --noEmit` must continue to exit 0 with the new
// strictness flags applied.
// =====================================================================

/// Path to the locally-installed `tsc` binary at the repo root. We check
/// this rather than shelling out to `npx tsc` to avoid network resolution
/// and to make the skip-condition unambiguous.
fn tsc_bin() -> PathBuf {
    repo_root().join("node_modules/.bin/tsc")
}

fn node_bin_exists() -> bool {
    // `tsc` is a JS file; running it requires `node` on PATH. If `node` is
    // missing we treat this as a skip rather than a failure (mirrors the
    // `node_modules` skip rule).
    Command::new("node")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn skip_if_no_node_toolchain(reason: &str) -> bool {
    eprintln!(
        "skipping tsc subprocess test: {} (this is expected in CI cargo jobs without `npm ci`)",
        reason
    );
    true
}

#[test]
fn npx_tsc_no_emit_exits_zero() {
    // Issue #14 AC #3: with the new strictness flags applied, `npx tsc
    // --noEmit` must still exit 0 — i.e. the new flags must not leak type
    // errors into existing source.
    //
    // We pin the contract by shelling out to the locally-installed tsc.
    // When the local toolchain isn't available (e.g. CI's cargo job, which
    // doesn't run `npm ci`), the test prints a clear skip message and
    // returns. The npm CI job covers tsc enforcement separately via its
    // own toolchain.
    let bin = tsc_bin();
    if !Path::new(&bin).exists() {
        skip_if_no_node_toolchain(&format!(
            "{} not present — `npm install` (or `npm ci`) hasn't been run",
            bin.display()
        ));
        return;
    }
    if !node_bin_exists() {
        skip_if_no_node_toolchain("`node` not found on PATH");
        return;
    }

    let output = Command::new(&bin)
        .arg("--noEmit")
        .current_dir(repo_root())
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn `{} --noEmit`: {}", bin.display(), e));

    assert!(
        output.status.success(),
        "expected `tsc --noEmit` to exit 0 (Issue #14 AC #3 — the new strictness flags must not leak type errors). Got exit status: {:?}\n--- stdout ---\n{}\n--- stderr ---\n{}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
}
