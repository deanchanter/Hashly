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

mod common;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn read_repo_file(rel: &str) -> String {
    let path = repo_root().join(rel);
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e))
}

// The hardened, string-literal-aware `strip_comments` helper lives in
// `tests/common/mod.rs` (Issue #25). The three string-handling self-tests
// that previously sat here have moved to `tests/strip_comments_self.rs`,
// physically co-located with the helper they exercise.

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
    let stripped = common::strip_comments(&raw);
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
    let stripped = common::strip_comments(&raw);
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

// =====================================================================
// Slice C-CI — gate `tsc --noEmit` continuously via the npm `test` script.
// Without this, the CI npm job (which runs `npm test`) never invokes tsc,
// and the strictness flags can silently regress on `main`.
// =====================================================================

#[test]
fn npm_test_script_runs_tsc_noemit_before_vitest() {
    // Issue #14 AC #3: `tsc --noEmit` must keep passing — which only stays
    // enforced if CI runs it on every PR. The CI npm job runs `npm test`,
    // so the contract is: `package.json` `scripts.test` must invoke
    // `tsc --noEmit` BEFORE invoking `vitest`, so a tsc failure short-
    // circuits before vitest masks it.
    let raw = read_repo_file("package.json");
    let pkg: serde_json::Value = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("package.json is not valid JSON: {}", e));
    let test_script = pkg
        .get("scripts")
        .and_then(|s| s.get("test"))
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| {
            panic!(
                "expected `scripts.test` string in package.json (Issue #14 AC #3 — CI gates tsc via npm test), got: {:?}",
                pkg.get("scripts")
            )
        });

    let tsc_idx = test_script.find("tsc --noEmit");
    let vitest_idx = test_script.find("vitest");

    assert!(
        tsc_idx.is_some(),
        "expected `package.json` `scripts.test` to include `tsc --noEmit` so the CI npm job gates tsc (Issue #14 AC #3). Got scripts.test = {:?}",
        test_script
    );
    assert!(
        vitest_idx.is_some(),
        "expected `package.json` `scripts.test` to still invoke `vitest` (Issue #14 AC #4 — npm test stays green). Got scripts.test = {:?}",
        test_script
    );

    let tsc_idx = tsc_idx.unwrap();
    let vitest_idx = vitest_idx.unwrap();
    assert!(
        tsc_idx < vitest_idx,
        "expected `tsc --noEmit` to run BEFORE `vitest` in `scripts.test` so a tsc failure short-circuits (Issue #14 AC #3). Got scripts.test = {:?} (tsc at {}, vitest at {})",
        test_script, tsc_idx, vitest_idx
    );
}
