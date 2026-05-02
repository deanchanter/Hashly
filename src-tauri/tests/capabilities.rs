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

// =====================================================================
// Issue #50 — v0.2 ACL extension + pinning test.
//
// Wire-up discovery (verified against `tauri-plugin-dialog v2.7.0`'s
// shipped permission schema in `~/.cargo/registry/src/.../tauri-plugin-
// dialog-2.7.0/permissions/`):
//
//   `dialog:default` already grants ALL of:
//     - `allow-message` — `message()`, plus the v2.7 deprecated aliases
//       `ask` and `confirm` (both internally dispatch the `message`
//       command in v2; will be removed in v3 per the plugin's own
//       deprecation notes).
//     - `allow-save`    — `save()` picker (Save As… for #7 / #49).
//     - `allow-open`    — `open()` picker (File > Open from #4).
//
// So v0.2's dialog needs (save-failure dialog #7, unsaved-on-close
// dialog #8, Save As… for templates #49) are ALL covered by the
// existing `dialog:default` entry. No new dialog-plugin permission
// entries are added; the slice's deliverable is the *audit trail* —
// these pins document the discovery and break the build if a future
// contributor scope-creeps the ACL.
//
// The pins below:
//
//   1. Reject any `fs:*` permission. The PRD is explicit that
//      `@tauri-apps/plugin-fs` is NOT used (path validation lives
//      server-side in `read_md_file_within` / `save_md_file_within`,
//      #44 + #7); granting `fs:write-all` would defeat the
//      canonicalize+allow-list hardening.
//
//   2. Reject any per-command app-IPC entry (`save_md_file`,
//      `get_current_user`, `read_md_file`). App commands flow through
//      `core:default`'s IPC channel; per-command ACL entries would be
//      redundant AND would create a confusing dual-gate surface.
//
//   3. Pin the EXACT permission set as an allow-list. Future slices
//      that legitimately need a new permission must update this test
//      explicitly — they cannot land a permission "by accident".
//
//   4. Schema-drift sentry: assert that the shipped `dialog-plugin
//      v2.x` still aliases `ask` and `confirm` to `allow-message`.
//      When the plugin upgrades to v3 (which removes the aliases),
//      this test fires and forces the slice's ACL to add explicit
//      `allow-ask` / `allow-confirm` entries before the upgrade lands.
// =====================================================================

#[test]
fn default_capability_does_not_grant_any_fs_plugin_permission() {
    // PRD § Risks load-bearing pin: granting `fs:write-all` (or any
    // `fs:*` permission) would defeat #44's path-traversal hardening
    // by giving the webview a back-door into the filesystem that
    // bypasses `read_md_file_within` / `save_md_file_within`'s
    // canonicalize + allow-list checks. The frontend explicitly does
    // NOT import `@tauri-apps/plugin-fs`; this test ensures the
    // capability JSON cannot accidentally re-open the back door.
    let cap = capability_file();
    let permissions = cap
        .get("permissions")
        .and_then(|v| v.as_array())
        .expect("expected `permissions` array");

    let perm_strings: Vec<&str> = permissions.iter().filter_map(|p| p.as_str()).collect();

    let fs_permission = perm_strings.iter().find(|p| p.starts_with("fs:"));
    assert!(
        fs_permission.is_none(),
        "expected NO `fs:*` permission entries in default.json (PRD § Risks: granting \
         `@tauri-apps/plugin-fs` permissions defeats the #44 + #7 path-traversal hardening). \
         All file IO MUST flow through the hardened seams `read_md_file_within` and \
         `save_md_file_within`. Got offending entry: {:?}; full list: {:?}",
        fs_permission,
        perm_strings,
    );
}

#[test]
fn default_capability_does_not_register_per_command_app_ipc_entries() {
    // Per the PRD: `save_md_file` (and future `get_current_user`)
    // flow through `core:default`'s IPC channel — they're registered
    // server-side via `invoke_handler!` and need NO per-command ACL
    // entry. A regression that adds e.g. an `app:save_md_file` entry
    // would create a confusing dual-gate surface ("which entry
    // actually gates this command?") and a maintenance liability.
    let cap = capability_file();
    let permissions = cap
        .get("permissions")
        .and_then(|v| v.as_array())
        .expect("expected `permissions` array");

    let perm_strings: Vec<&str> = permissions.iter().filter_map(|p| p.as_str()).collect();

    for forbidden in &["save_md_file", "read_md_file", "get_current_user"] {
        let offender = perm_strings.iter().find(|p| p.contains(forbidden));
        assert!(
            offender.is_none(),
            "expected NO per-command ACL entry mentioning {:?} in default.json — app \
             commands flow through `core:default`'s IPC channel (registered via \
             `invoke_handler!`); per-command ACL entries would be redundant AND would \
             create a confusing dual-gate surface. Got offender: {:?}; full list: {:?}",
            forbidden,
            offender,
            perm_strings,
        );
    }
}

#[test]
fn default_capability_permission_set_is_exactly_the_v02_expected_set() {
    // Allow-list pin. The exact permission set is small; pinning it
    // verbatim catches scope creep (a contributor adds e.g.
    // `clipboard-manager:default` without thinking through the threat
    // model). Future slices that legitimately need a new permission
    // must update this test as part of the same PR — they cannot land
    // a permission "by accident".
    //
    // v0.2 expected set:
    //   - `core:default`   — window/event/menu defaults + IPC channel
    //   - `dialog:default` — open + save + message (covers #4, #7, #8,
    //                         #49 dialog needs in plugin v2.7; see
    //                         module-level comment for the v2→v3
    //                         migration sentry below)
    //
    // If THIS test fails, the slice landing the change owns a triage:
    // either update the expected set here (with a justification in the
    // commit message), or remove the unintended permission.
    let cap = capability_file();
    let permissions = cap
        .get("permissions")
        .and_then(|v| v.as_array())
        .expect("expected `permissions` array");

    let mut perm_strings: Vec<String> = permissions
        .iter()
        .filter_map(|p| p.as_str())
        .map(String::from)
        .collect();
    perm_strings.sort();

    let mut expected: Vec<String> =
        vec!["core:default".to_string(), "dialog:default".to_string()];
    expected.sort();

    assert_eq!(
        perm_strings, expected,
        "expected the default.json permission set to EXACTLY match the v0.2 audit \
         allow-list (PRD § Risks ACL pinning, issue #50). If this test failed because \
         your slice legitimately needs a new permission, update the `expected` vector \
         in this test in the same PR with a justification. Do NOT silence by removing \
         the test — it is the audit trail. Expected: {:?}; got: {:?}",
        expected,
        perm_strings,
    );
}

#[test]
fn dialog_plugin_v2_still_aliases_ask_and_confirm_to_allow_message() {
    // Schema-drift sentry. In `tauri-plugin-dialog v2.x`, the
    // permissions `allow-ask` and `allow-confirm` are deprecated
    // aliases that internally dispatch the `message` command — so
    // `dialog:default`'s `allow-message` covers all three. The
    // plugin's own deprecation notes say these aliases will be REMOVED
    // in v3.
    //
    // When the plugin upgrades to v3 (or whichever version drops the
    // aliases), this test fires. The slice that does the upgrade then
    // owns a triage:
    //
    //   1. Decide whether the unsaved-on-close dialog (#8) or
    //      save-failure dialog (#7) needs `allow-ask` / `allow-confirm`
    //      explicitly added to default.json, OR
    //   2. Migrate to a different dialog flow (e.g. a custom in-page
    //      modal + native menu items).
    //
    // The test reads the plugin's shipped permission TOML files
    // straight from the cargo registry source. If the registry isn't
    // warmed (e.g. cached CI environments), the test is a no-op pass —
    // the *real* drift signal is the build itself, which would refuse
    // to load deprecated permissions that no longer exist.
    let cargo_home = std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            // Default cargo home on Unix.
            std::env::var_os("HOME")
                .map(|h| PathBuf::from(h).join(".cargo"))
                .unwrap_or_else(|| PathBuf::from("/usr/local/cargo"))
        });
    let registry_src = cargo_home.join("registry").join("src");

    if !registry_src.exists() {
        eprintln!(
            "skipping dialog-plugin alias drift sentry: cargo registry src not present at \
             {} (CI may run with a stripped cache; the build itself will catch true drift).",
            registry_src.display()
        );
        return;
    }

    let mut found = Vec::new();
    if let Ok(entries) = fs::read_dir(&registry_src) {
        for entry in entries.flatten() {
            let index_dir = entry.path();
            if !index_dir.is_dir() {
                continue;
            }
            if let Ok(plugins) = fs::read_dir(&index_dir) {
                for plugin in plugins.flatten() {
                    let p = plugin.path();
                    let name = match p.file_name().and_then(|n| n.to_str()) {
                        Some(n) => n,
                        None => continue,
                    };
                    if !name.starts_with("tauri-plugin-dialog-") {
                        continue;
                    }
                    let ask = p.join("permissions").join("ask.toml");
                    let confirm = p.join("permissions").join("confirm.toml");
                    if ask.exists() && confirm.exists() {
                        found.push(p);
                    }
                }
            }
        }
    }

    if found.is_empty() {
        eprintln!(
            "skipping dialog-plugin alias drift sentry: no tauri-plugin-dialog-*/permissions/ \
             ask.toml + confirm.toml found under {}. The build itself catches true drift.",
            registry_src.display()
        );
        return;
    }

    for plugin_dir in found {
        let ask_toml = fs::read_to_string(plugin_dir.join("permissions").join("ask.toml"))
            .expect("ask.toml exists per the find above");
        let confirm_toml =
            fs::read_to_string(plugin_dir.join("permissions").join("confirm.toml"))
                .expect("confirm.toml exists per the find above");

        let ask_lower = ask_toml.to_lowercase();
        let confirm_lower = confirm_toml.to_lowercase();

        assert!(
            ask_lower.contains("allow-ask"),
            "expected tauri-plugin-dialog's ask.toml at {} to define `allow-ask`. If \
             this test fires, the plugin upgraded and the v0.2 ACL audit assumption \
             (that `dialog:default`'s `allow-message` covers ask/confirm) is stale — \
             slice 8 / #50 must add an explicit `dialog:allow-ask` entry. Got:\n{}",
            plugin_dir.display(),
            ask_toml
        );
        assert!(
            ask_lower.contains("commands.allow") && ask_lower.contains("\"message\""),
            "expected ask.toml at {} to alias `allow-ask` to the `message` command \
             (the v2 deprecation pattern). If this test fires, the plugin's permission \
             shape changed — slice 8 / #50 ACL must be re-audited. Got:\n{}",
            plugin_dir.display(),
            ask_toml
        );

        assert!(
            confirm_lower.contains("allow-confirm"),
            "expected confirm.toml at {} to define `allow-confirm`. Same triage as \
             ask.toml above. Got:\n{}",
            plugin_dir.display(),
            confirm_toml
        );
        assert!(
            confirm_lower.contains("commands.allow") && confirm_lower.contains("\"message\""),
            "expected confirm.toml at {} to alias `allow-confirm` to the `message` \
             command (the v2 deprecation pattern). Got:\n{}",
            plugin_dir.display(),
            confirm_toml
        );
    }
}
