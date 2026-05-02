//! Issue #5 — RunEvent::Opened handler for Finder double-click (slice 4 / v0.2).
//!
//! macOS sends `NSApplication openFile:` (and modern `application
//! openURLs:`) when the user double-clicks a registered file type, OR
//! when the user picks "Open With > Hashly" from a `.md` file's
//! context menu, OR when `open -a Hashly some.md` is run from the
//! command line. Tauri 2 surfaces this as `RunEvent::Opened { urls }`
//! delivered to the closure passed into `app.run(...)` (after
//! `Builder::build()`).
//!
//! The contract this test pins on `src-tauri/src/lib.rs`:
//!
//!   1. `run()` uses the build-then-run pattern (`Builder::build()`
//!      followed by `app.run(handler)`), not the all-in-one
//!      `Builder::run()` shortcut. Without this refactor, there is no
//!      hook into the run-loop event stream and `RunEvent::Opened`
//!      cannot be observed.
//!
//!   2. The handler matches `RunEvent::Opened` and emits a frontend
//!      event named `file-opened-by-os` carrying the file path string.
//!      The frontend listener (in `src/main.ts`) calls
//!      `read_md_file` for each emitted path and routes the result
//!      through `handleFileOpened`.
//!
//! The test is a static-source assertion — exercising the actual
//! RunEvent path requires a live Tauri app, which is out of scope
//! for `cargo test`. The build itself (which `cargo test` includes)
//! is the second line of defence: a `RunEvent::Opened` arm with a
//! type error fails `cargo build` first.
//!
//! Event-name pin: `file-opened-by-os` is the contract between Rust
//! and the frontend. The frontend test in `src/__tests__/file-opened-by-os.test.ts`
//! pins the same string from the listener side, so a rename in either
//! file fires a test on the other side.

use std::fs;
use std::path::PathBuf;

mod common;

fn read_lib_rs() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("lib.rs");
    fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "could not read {}: {} — Issue #5 source pins require lib.rs to be readable",
            path.display(),
            e
        )
    })
}

#[test]
fn lib_rs_uses_build_then_run_pattern_not_one_shot_run() {
    // Pin the structural shape: `Builder::build(...)` followed by
    // `app.run(...)` with a closure. The all-in-one `Builder::run()`
    // shortcut hides the run-loop and makes RunEvent::Opened
    // unreachable. If a future "simplifying" refactor reverts to the
    // one-shot shortcut, this test fires.
    let src = read_lib_rs();

    // Strip comments so a stray `// .build(...)` mention in a
    // doc-comment doesn't false-match. We use the same helper that
    // strip_comments tests already validate.
    let stripped = common::strip_comments(&src);

    assert!(
        stripped.contains(".build(") && stripped.contains("tauri::generate_context!()"),
        "expected `src/lib.rs` to call `Builder::build(tauri::generate_context!())` (Issue #5 — \
         build-then-run pattern is required to hook RunEvent::Opened). Stripped lib.rs:\n{}",
        stripped
    );
    assert!(
        stripped.contains(".run(|"),
        "expected `src/lib.rs` to call `app.run(|...|)` with a closure (Issue #5 — the \
         closure receives RunEvent items). Stripped lib.rs:\n{}",
        stripped
    );
}

#[test]
fn lib_rs_handles_run_event_opened_and_emits_file_opened_by_os() {
    // The central #5 contract: there is a `RunEvent::Opened` match arm
    // (or equivalent `if let`) that emits a frontend event named
    // `file-opened-by-os`. We pin both halves separately so a
    // regression is diagnosable: missing match arm vs missing emit vs
    // wrong event name.
    let src = read_lib_rs();
    let stripped = common::strip_comments(&src);

    assert!(
        stripped.contains("RunEvent::Opened") || stripped.contains("Opened {"),
        "expected `src/lib.rs` to handle `RunEvent::Opened` from the run-loop closure \
         (Issue #5 — this is the macOS Finder double-click hook). Stripped lib.rs:\n{}",
        stripped
    );

    assert!(
        stripped.contains("\"file-opened-by-os\""),
        "expected `src/lib.rs` to emit the frontend event named \"file-opened-by-os\" \
         from the RunEvent::Opened handler (Issue #5 — the event name is the contract \
         between Rust and src/main.ts; the frontend listener in src/__tests__/ pins the \
         same string). Stripped lib.rs:\n{}",
        stripped
    );
}
