//! Tauri 2 capability ACL pin (final-review fix for milestone PR).
//!
//! Tauri 2 ships a strict capability/permission model: without an explicit
//! capability file granting `core:default` (window/event/menu defaults) and
//! `dialog:default` (the dialog plugin used by File > Open), the webview
//! cannot reach the dialog plugin or app-level IPC commands at runtime —
//! the test suite passes because Vitest mocks `@tauri-apps/api/core` and
//! `@tauri-apps/plugin-dialog`, and Rust integration tests call
//! `read_md_file` as a plain Rust function (bypassing IPC).
//!
//! This pin ensures the capability file is committed and grants the two
//! permission groups slice #4 needs at runtime. Without it the manual
//! "open via File > Open" smoke listed in the milestone PR's "Manual
//! verification needed" section would fail with a permission error.

use std::fs;
use std::path::PathBuf;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn capability_file() -> serde_json::Value {
    let path = manifest_dir().join("capabilities").join("default.json");
    let raw = fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "expected src-tauri/capabilities/default.json to exist (Tauri 2 ACL — \
             without it the webview cannot reach the dialog plugin or IPC commands at \
             runtime, breaking issue #4's File > Open AC). Read error: {}",
            e
        )
    });
    serde_json::from_str(&raw).unwrap_or_else(|e| {
        panic!(
            "expected src-tauri/capabilities/default.json to be valid JSON (Tauri 2 \
             rejects malformed capability files at build time). Parse error: {}\n\nFile:\n{}",
            e, raw
        )
    })
}

#[test]
fn default_capability_targets_main_window() {
    let cap = capability_file();
    let identifier = cap
        .get("identifier")
        .and_then(|v| v.as_str())
        .expect("expected `identifier` string field in default.json");
    assert_eq!(
        identifier, "default",
        "expected `identifier` to be \"default\" so the capability is auto-discovered \
         under the canonical name; got {:?}",
        identifier
    );

    let windows = cap
        .get("windows")
        .and_then(|v| v.as_array())
        .expect("expected `windows` array field in default.json");
    let has_main = windows.iter().any(|w| w.as_str() == Some("main"));
    assert!(
        has_main,
        "expected `windows` to include \"main\" (the only window declared in \
         tauri.conf.json), so the capability is bound to the runtime window. Got: {:?}",
        windows
    );
}

#[test]
fn default_capability_grants_core_and_dialog_permissions() {
    let cap = capability_file();
    let permissions = cap
        .get("permissions")
        .and_then(|v| v.as_array())
        .expect("expected `permissions` array field in default.json");

    let perm_strings: Vec<&str> = permissions.iter().filter_map(|p| p.as_str()).collect();

    // `core:default` is required for window/event/menu APIs used by the
    // frontend (`@tauri-apps/api/event`'s `listen()` for `menu-open-file`,
    // and webview IPC for app-level commands like `read_md_file`).
    assert!(
        perm_strings.iter().any(|p| *p == "core:default"),
        "expected `permissions` to include \"core:default\" so the webview can use \
         the event listener and IPC channel (issue #4 menu-open-file flow). Got: {:?}",
        perm_strings
    );

    // `dialog:default` is required for `@tauri-apps/plugin-dialog`'s
    // `open()` to be reachable. Without it the dialog plugin is registered
    // server-side but the webview cannot invoke it.
    assert!(
        perm_strings.iter().any(|p| *p == "dialog:default"),
        "expected `permissions` to include \"dialog:default\" so the File > Open \
         dialog (issue #4 slice D) can be invoked from the webview. Got: {:?}",
        perm_strings
    );
}
