//! Issue #4 — Slice C: wire `tauri-plugin-dialog`, the File>Open menu, and
//! the `read_md_file` IPC command into `src-tauri/src/lib.rs`.
//!
//! This test crate is a static-contract belt around the runtime behavior
//! that cannot be exercised headlessly on Linux (the actual macOS menu,
//! Cmd+O accelerator dispatch, and native file-picker dialog are all
//! manually verified by the user). What we CAN pin from this environment:
//!
//!   1. Cargo.toml declares `tauri-plugin-dialog` as a runtime dependency
//!      (so `npm install`-equivalent `cargo build` actually pulls the
//!      crate in).
//!   2. lib.rs registers the dialog plugin with Tauri's builder.
//!   3. `read_md_file` carries the `#[tauri::command]` annotation (so it
//!      is exposed over IPC — without this annotation, a frontend
//!      `invoke('read_md_file', …)` call would silently 404).
//!   4. lib.rs constructs a menu using `MenuItemBuilder`, defines an
//!      item with id `"open"`, and binds the `CmdOrCtrl+O` accelerator.
//!   5. lib.rs invokes `generate_handler!` with `read_md_file` registered
//!      so the command is actually reachable from the frontend.
//!
//! All lib.rs body checks are run AFTER `common::strip_comments`, so a
//! contributor cannot satisfy the contract by leaving a commented-out
//! `// .plugin(tauri_plugin_dialog::init())` ghost — same defense pattern
//! as the frontend.rs static-contract suite.

use std::fs;
use std::path::PathBuf;

mod common;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_manifest_file(rel: &str) -> String {
    let path = manifest_dir().join(rel);
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e))
}

/// Extract the body of a `[<header>]` TOML section from a manifest source
/// as a `&str`. Returns `None` if the section is absent. The body runs
/// from just after the section header line to (exclusive) the next
/// section header (a line starting with `[`) or end-of-file.
///
/// Defensive choices:
///   - We anchor on a NEWLINE-prefixed match so a header substring inside
///     a string literal value (e.g. `description = "[fake]"`) isn't a
///     false positive.
///   - We accept the very-first-line variant by also checking
///     `starts_with`.
///   - The next-header sentinel is also newline-anchored for the same
///     reason — `[` inside a value should not terminate the section.
fn toml_section_body<'a>(src: &'a str, header: &str) -> Option<&'a str> {
    let header_line = format!("[{}]", header);
    let prefixed = format!("\n{}", header_line);
    let start_after_header = if let Some(idx) = src.find(&prefixed) {
        // Skip past `\n[header]` and the rest of that line.
        let after = idx + prefixed.len();
        let rest = &src[after..];
        let nl = rest.find('\n').unwrap_or(rest.len());
        Some(after + nl)
    } else if src.starts_with(&header_line) {
        let rest = &src[header_line.len()..];
        let nl = rest.find('\n').unwrap_or(rest.len());
        Some(header_line.len() + nl)
    } else {
        None
    }?;
    let tail = &src[start_after_header..];
    // Find the next newline-anchored `[` (next section header).
    let end_offset = tail.find("\n[").unwrap_or(tail.len());
    Some(&tail[..end_offset])
}

#[test]
fn cargo_toml_declares_tauri_plugin_dialog_runtime_dependency() {
    // AC: `tauri-plugin-dialog` MUST be declared in `[dependencies]` (not
    // `[dev-dependencies]` or `[build-dependencies]`) so the production
    // build links it. We isolate the `[dependencies]` section body and
    // search for the dep there — that way a contributor who accidentally
    // adds the line under `[dev-dependencies]` is caught.
    let raw = read_manifest_file("Cargo.toml");

    let deps_body = toml_section_body(&raw, "dependencies").unwrap_or_else(|| {
        panic!(
            "expected a `[dependencies]` section in src-tauri/Cargo.toml; manifest was:\n{}",
            raw
        )
    });

    // Pin a key-anchored substring (`tauri-plugin-dialog = `) so a
    // commented-out line (`# tauri-plugin-dialog = "2"`) does NOT
    // satisfy the assertion — TOML comments start with `#`, so the
    // first non-whitespace char on the line would be `#` and the
    // substring would NOT be `tauri-plugin-dialog = ` (the `#` would
    // come first). To make this airtight we additionally check that
    // the line containing the substring is NOT comment-prefixed.
    let mut found_active = false;
    for line in deps_body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with("tauri-plugin-dialog") {
            // Accept either:
            //   tauri-plugin-dialog = "2"
            //   tauri-plugin-dialog = { version = "2", features = [...] }
            // Any non-comment line whose first token is the dep name and
            // is followed by `=` counts as active.
            if trimmed.contains('=') {
                found_active = true;
                break;
            }
        }
    }

    assert!(
        found_active,
        "expected an ACTIVE (non-comment) `tauri-plugin-dialog = ...` entry in the \
         `[dependencies]` section of src-tauri/Cargo.toml (Issue #4 slice C — required \
         so the native File>Open dialog is available at runtime, not just in test \
         builds). [dependencies] section body was:\n{}",
        deps_body
    );

    // Negative assertion: the dep MUST NOT be in `[dev-dependencies]`.
    // Even if it were ALSO in [dependencies], having it in dev-deps would
    // be a sign of a confused build setup; pin against it.
    if let Some(dev_body) = toml_section_body(&raw, "dev-dependencies") {
        for line in dev_body.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with('#') {
                continue;
            }
            assert!(
                !trimmed.starts_with("tauri-plugin-dialog"),
                "expected `tauri-plugin-dialog` to live ONLY in `[dependencies]`, \
                 not in `[dev-dependencies]` (Issue #4 slice C — the dialog is a \
                 runtime requirement, not a test-only one). [dev-dependencies] body:\n{}",
                dev_body
            );
        }
    }
}

#[test]
fn lib_rs_registers_tauri_plugin_dialog_with_the_builder() {
    // AC: `tauri::Builder::default().plugin(tauri_plugin_dialog::init())…` is
    // the canonical Tauri 2 plugin-registration call. Without it, even a
    // declared dep does nothing — the plugin never gets initialized and the
    // frontend `@tauri-apps/plugin-dialog` invocations silently fail.
    //
    // Comments are stripped before matching so a commented-out registration
    // (e.g. `// .plugin(tauri_plugin_dialog::init())`) does NOT satisfy
    // the assertion. The substring is matched whitespace-insensitively to
    // tolerate `rustfmt` linebreaks like:
    //   .plugin(
    //       tauri_plugin_dialog::init()
    //   )
    let lib_rs = read_manifest_file("src/lib.rs");
    let stripped = common::strip_comments(&lib_rs);
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    assert!(
        normalized.contains(".plugin(tauri_plugin_dialog::init())"),
        "expected src/lib.rs to register the dialog plugin via \
         `.plugin(tauri_plugin_dialog::init())` on the Tauri builder \
         (Issue #4 slice C). After comment-strip:\n{}",
        stripped
    );
}

#[test]
fn lib_rs_annotates_read_md_file_as_a_tauri_command() {
    // AC: `read_md_file` must be annotated with `#[tauri::command]` so it
    // is exposed over IPC. Without the annotation, `generate_handler!`
    // can't register the function and frontend `invoke('read_md_file', …)`
    // calls silently fail.
    //
    // We pin the annotation in the SAME lexical region as the function
    // declaration (within ~200 chars before `pub fn read_md_file` or
    // `fn read_md_file`) so a stray `#[tauri::command]` somewhere else in
    // the file does not satisfy the contract. Comments are stripped first
    // so a commented-out annotation cannot satisfy.
    let lib_rs = read_manifest_file("src/lib.rs");
    let stripped = common::strip_comments(&lib_rs);

    // Find the function declaration. Accept `pub fn read_md_file` or
    // `fn read_md_file` (the function may be made non-pub if slice C
    // restructures it; we don't care about visibility for this AC, only
    // about the annotation pairing).
    let fn_idx = stripped
        .find("fn read_md_file")
        .unwrap_or_else(|| {
            panic!(
                "expected src/lib.rs to still contain a `fn read_md_file` declaration \
                 after slice C (Issue #4 slice C must keep the symbol from slice B). \
                 After comment-strip:\n{}",
                stripped
            )
        });

    // Look back up to 200 chars for the annotation. `#[tauri::command]` is
    // 17 chars; this window comfortably accommodates a doc-comment-like
    // header above the fn (though doc comments would be stripped by
    // common::strip_comments since they start with `///` → `//`).
    let window_start = fn_idx.saturating_sub(200);
    let window = &stripped[window_start..fn_idx];

    assert!(
        window.contains("#[tauri::command]"),
        "expected `#[tauri::command]` annotation immediately above `fn read_md_file` \
         in src/lib.rs so it is exposed over IPC (Issue #4 slice C). Window before \
         the fn declaration was:\n{}",
        window
    );
}

#[test]
fn lib_rs_registers_read_md_file_in_invoke_handler() {
    // AC: even with `#[tauri::command]` on the function, the frontend
    // can't reach it unless `tauri::generate_handler![read_md_file]` is
    // wired into `.invoke_handler(...)`. Pin both halves: the macro call
    // and the function name inside its argument list.
    //
    // We do a two-step substring check (whitespace-insensitive) rather
    // than a regex because the suite's existing static-contract tests
    // are all substring-based — keeping the pattern consistent makes
    // failure messages predictable and the file easy to grep.
    let lib_rs = read_manifest_file("src/lib.rs");
    let stripped = common::strip_comments(&lib_rs);
    let normalized: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    assert!(
        normalized.contains("generate_handler!"),
        "expected src/lib.rs to call `tauri::generate_handler!` (Issue #4 slice C) \
         to register IPC commands. After comment-strip:\n{}",
        stripped
    );

    // The handler list must reference `read_md_file`. We look for the
    // pattern `generate_handler![…read_md_file…]` by anchoring on the
    // macro and scanning forward to the closing `]`. This is stricter
    // than a bare substring (`read_md_file` appears inside the function
    // declaration too) and rejects a contributor who declares the macro
    // but registers a different command.
    if let Some(start) = normalized.find("generate_handler![") {
        let after = &normalized[start..];
        let end = after.find(']').unwrap_or(after.len());
        let arg_list = &after[..end];
        assert!(
            arg_list.contains("read_md_file"),
            "expected `tauri::generate_handler![read_md_file]` (or a list including \
             `read_md_file`) so the IPC command is reachable from the frontend \
             (Issue #4 slice C). Found: `{}`",
            arg_list
        );
    } else {
        panic!(
            "expected `generate_handler![…]` form in src/lib.rs (Issue #4 slice C). \
             Normalized source did not contain the literal `generate_handler![`. \
             After comment-strip:\n{}",
            stripped
        );
    }
}

#[test]
fn lib_rs_builds_menu_with_open_item_and_cmd_or_ctrl_o_accelerator() {
    // AC: lib.rs constructs a menu via `MenuItemBuilder` and defines an
    // item with:
    //   - id `"open"` (so the on-event handler can dispatch on the id)
    //   - accelerator `"CmdOrCtrl+O"` (the cross-platform Tauri 2 accel
    //     spelling — on macOS this binds Cmd+O; on Linux/Windows Ctrl+O)
    //
    // We pin all three substrings (`MenuItemBuilder`, `"open"`, and
    // `"CmdOrCtrl+O"`) AFTER stripping comments. The id and accelerator
    // are pinned literal-quoted so a typo (e.g. `"Open"` capitalised, or
    // `"Cmd+O"` without the `OrCtrl` half) is caught.
    //
    // We do NOT pin the exact MenuBuilder shape — the issue spec lets the
    // builder pick between `MenuBuilder::new(app).items(…)` and the more
    // verbose nested-submenu form. Slice C just needs ONE working menu
    // path; #5 (later) will add more items.
    let lib_rs = read_manifest_file("src/lib.rs");
    let stripped = common::strip_comments(&lib_rs);

    assert!(
        stripped.contains("MenuItemBuilder"),
        "expected src/lib.rs to construct a menu item via `MenuItemBuilder` \
         (Issue #4 slice C — Tauri 2's idiomatic builder for menu items). \
         After comment-strip:\n{}",
        stripped
    );

    // Pin both quote styles for the id literal — Rust permits double-quoted
    // strings only, so `"open"` is the only legal form, but we add the
    // single-quoted check defensively in case someone uses a `char` literal
    // (which would not compile but might appear during a refactor).
    let has_open_id = stripped.contains("\"open\"");
    assert!(
        has_open_id,
        "expected src/lib.rs to define a menu item with id `\"open\"` so the \
         on-event handler can dispatch on the id (Issue #4 slice C). After \
         comment-strip:\n{}",
        stripped
    );

    // Pin the accelerator verbatim. `CmdOrCtrl+O` is Tauri 2's
    // cross-platform spelling; `Cmd+O` would only work on macOS, and
    // `Ctrl+O` would only work on non-mac platforms. We want the
    // cross-platform form because the dev workflow involves Linux too.
    assert!(
        stripped.contains("\"CmdOrCtrl+O\""),
        "expected src/lib.rs to bind the `\"CmdOrCtrl+O\"` accelerator to the Open \
         menu item (Issue #4 slice C — Tauri 2's cross-platform accelerator \
         spelling; `\"Cmd+O\"` would not work on Linux/Windows and \
         `\"Ctrl+O\"` would not work on macOS). After comment-strip:\n{}",
        stripped
    );
}
