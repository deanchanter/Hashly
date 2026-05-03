use std::fs;
use std::path::PathBuf;

fn load_config() -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));
    serde_json::from_str(&raw).expect("tauri.conf.json is not valid JSON")
}

#[test]
fn window_is_titled_hashly() {
    let cfg = load_config();
    let windows = cfg
        .pointer("/app/windows")
        .and_then(|w| w.as_array())
        .expect("expected app.windows array in tauri.conf.json");
    assert!(!windows.is_empty(), "expected at least one window definition");
    let title = windows[0]
        .get("title")
        .and_then(|t| t.as_str())
        .expect("first window must have a title");
    assert_eq!(title, "Hashly");
}

#[test]
fn tauri_conf_app_security_csp_is_restrictive_and_set() {
    // Issue #4 — Before the app reads arbitrary user markdown via File>Open,
    // the WebView must run under a restrictive Content-Security-Policy. The
    // null-CSP that ships in the default Tauri scaffold (`"csp": null`) means
    // the WebView accepts any script source, including `'unsafe-inline'`,
    // which is exactly the threat surface raw markdown can attack
    // (script-as-data injection through Milkdown's HTML escape path or any
    // future plugin that rewrites HTML).
    //
    // Contract pinned here:
    //   1. `app.security.csp` exists and is a STRING (not null, not an array,
    //      not an object). Tauri 2 supports object-form CSP for per-source
    //      overrides, but we want the simplest auditable form: one string.
    //   2. The CSP contains a `default-src 'self'` directive. Without
    //      default-src the policy degrades to `*` for any directive not
    //      explicitly listed, which is the same as no policy.
    //   3. The CSP contains a `script-src` directive — explicit, not relying
    //      on default-src fallback — so a future contributor cannot weaken
    //      the script policy by editing only default-src.
    //   4. The script-src directive does NOT contain `'unsafe-inline'`. This
    //      is the security ask: inline scripts are the primary attack vector
    //      for script-as-data in markdown. Style-src may carry
    //      `'unsafe-inline'` (Milkdown injects inline styles); that is
    //      acceptable and is NOT what this test forbids.
    //   5. The CSP contains `script-src 'self'` (so first-party Vite-built
    //      assets are allowed to execute). Pinning the literal substring also
    //      catches a regression where someone deletes `'self'` from
    //      script-src and the WebView refuses to load main.ts entirely.
    let cfg = load_config();
    let security = cfg
        .pointer("/app/security")
        .and_then(|s| s.as_object())
        .expect("expected app.security object in tauri.conf.json (Issue #4)");

    let csp_value = security.get("csp").unwrap_or_else(|| {
        panic!(
            "expected app.security.csp key to be present in tauri.conf.json (Issue #4); \
             got app.security = {:?}",
            security
        )
    });
    let csp = csp_value.as_str().unwrap_or_else(|| {
        panic!(
            "expected app.security.csp to be a non-null STRING (Issue #4 — the default \
             scaffold ships `\"csp\": null`, which permits any script source); got: {:?}",
            csp_value
        )
    });
    assert!(
        !csp.trim().is_empty(),
        "expected app.security.csp to be a non-empty CSP string (Issue #4); got: {:?}",
        csp
    );

    // Split on `;` so we can examine individual directives without false-
    // matching `script-src` against `default-src` (or vice versa) by
    // substring alone.
    let directives: Vec<&str> = csp
        .split(';')
        .map(|d| d.trim())
        .filter(|d| !d.is_empty())
        .collect();

    let default_src = directives
        .iter()
        .find(|d| d.starts_with("default-src"))
        .copied()
        .unwrap_or_else(|| {
            panic!(
                "expected CSP to contain a `default-src` directive (Issue #4 — without it, \
                 unlisted directives fall back to `*`). CSP was: {:?}",
                csp
            )
        });
    assert!(
        default_src.contains("'self'"),
        "expected CSP `default-src` directive to include `'self'` (Issue #4). default-src was: {:?}",
        default_src
    );

    let script_src = directives
        .iter()
        .find(|d| d.starts_with("script-src"))
        .copied()
        .unwrap_or_else(|| {
            panic!(
                "expected CSP to contain an EXPLICIT `script-src` directive (Issue #4 — \
                 relying on default-src fallback is fragile; a future edit to default-src \
                 would silently widen the script policy). CSP was: {:?}",
                csp
            )
        });
    assert!(
        script_src.contains("'self'"),
        "expected CSP `script-src` directive to include `'self'` so first-party Vite-built \
         assets can execute (Issue #4). script-src was: {:?}",
        script_src
    );
    assert!(
        !script_src.contains("'unsafe-inline'"),
        "expected CSP `script-src` directive to NOT include `'unsafe-inline'` (Issue #4 — \
         this is the core security ask: inline scripts are the primary attack vector for \
         script-as-data injection through markdown). script-src was: {:?}",
        script_src
    );
    assert!(
        !script_src.contains("'unsafe-eval'"),
        "expected CSP `script-src` directive to NOT include `'unsafe-eval'` (Issue #4 — \
         eval-based script execution is just as dangerous as inline scripts for \
         script-as-data injection). script-src was: {:?}",
        script_src
    );
}

#[test]
fn tauri_conf_registers_md_file_association_for_finder_double_click() {
    // Issue #5 — Hashly must register as a handler for `.md` files so
    // double-clicking a `.md` in Finder launches/focuses Hashly with
    // that file. Tauri 2's bundle config exposes this via
    // `bundle.fileAssociations` (an array of association objects).
    //
    // The slice's runtime test (the actual Finder→.app smoke) requires
    // an installed bundle and is gated on slice 16 / #12 (`bundle.active`
    // is false in v0.2 main milestone PR). This static config pin is the
    // load-bearing part that travels with the v0.2 milestone PR — flip
    // `bundle.active = true` later and the association is already there.
    //
    // Contract:
    //   1. `bundle.fileAssociations` is present and is an array.
    //   2. At least one entry covers the `md` extension.
    //   3. The same (or a separate) entry includes `markdown` for
    //      sources that prefer the long form.
    //   4. The entry's `role` (when present) is `Editor` (macOS UTI
    //      role). v0.2 promotes editing to a first-class path; the
    //      association must reflect that — `Viewer` would deny the
    //      "Open With > Hashly" right-click on a non-Hashly-default
    //      `.md` and break the persona's quick-fix flow.
    let cfg = load_config();
    let bundle = cfg
        .get("bundle")
        .and_then(|b| b.as_object())
        .expect("expected `bundle` object in tauri.conf.json (Issue #5 — file association config lives under bundle)");

    let associations = bundle
        .get("fileAssociations")
        .and_then(|v| v.as_array())
        .unwrap_or_else(|| {
            panic!(
                "expected `bundle.fileAssociations` array in tauri.conf.json (Issue #5 — \
                 without it, double-clicking a `.md` in Finder won't launch Hashly even \
                 once the .dmg ships from #12). Bundle was: {:?}",
                bundle
            )
        });

    assert!(
        !associations.is_empty(),
        "expected at least one entry in `bundle.fileAssociations` (Issue #5)"
    );

    // Collect all extensions across all association entries.
    let mut all_exts: Vec<String> = Vec::new();
    let mut roles: Vec<String> = Vec::new();
    for assoc in associations {
        let obj = assoc
            .as_object()
            .expect("each fileAssociations entry must be an object");
        let exts = obj
            .get("ext")
            .and_then(|v| v.as_array())
            .expect("each fileAssociations entry must have an `ext` array");
        for e in exts {
            if let Some(s) = e.as_str() {
                all_exts.push(s.to_lowercase());
            }
        }
        if let Some(role) = obj.get("role").and_then(|v| v.as_str()) {
            roles.push(role.to_string());
        }
    }

    assert!(
        all_exts.iter().any(|e| e == "md"),
        "expected `bundle.fileAssociations` to include the `md` extension (Issue #5 — \
         the canonical persona use case is double-clicking a `.md` in Finder). Got \
         extensions: {:?}",
        all_exts
    );
    assert!(
        all_exts.iter().any(|e| e == "markdown"),
        "expected `bundle.fileAssociations` to also include the `markdown` extension \
         (long-form alternative; many spec authoring tools save with this extension). \
         Got: {:?}",
        all_exts
    );

    // Role pin: if any entry sets a role, it MUST be `Editor`. Skip
    // the assertion if no entry sets a role (Tauri defaults to a
    // sensible value); this lets the contract evolve without
    // pinning a default that may change.
    if !roles.is_empty() {
        assert!(
            roles.iter().all(|r| r == "Editor"),
            "expected any explicit `role` in fileAssociations to be \"Editor\" — v0.2 \
             promotes editing to a first-class path; `Viewer` denies \"Open With > Hashly\" \
             on a non-Hashly-default `.md` and breaks the persona's quick-fix flow. \
             Got roles: {:?}",
            roles
        );
    }
}

#[test]
fn tauri_conf_has_bundle_active_true_with_dmg_target_and_icon_set() {
    // Issue #12 (slice 16) — v0.2.2 ships the unsigned `.dmg`. The
    // load-bearing config is:
    //   1. `bundle.active = true` (without it, `cargo tauri build`
    //      produces no bundle artifact).
    //   2. `bundle.targets` is the array `["dmg"]` — explicitly narrow,
    //      not the default `"all"`. v0.2.2 ships only `.dmg`; the bare
    //      `.app` is not a delivered artifact and doubles build time.
    //   3. `bundle.icon` is a non-empty array of paths. An empty array
    //      ships an iconless app, which `cargo tauri build` accepts but
    //      Finder renders as the generic doc icon.
    //
    // Pinning these catches the failure mode where someone flips
    // `bundle.active = false` to "speed up local builds" and forgets to
    // flip it back, or someone widens `bundle.targets` to "all" and
    // accidentally ships the standalone `.app`.
    let cfg = load_config();
    let bundle = cfg
        .get("bundle")
        .and_then(|b| b.as_object())
        .expect("expected `bundle` object in tauri.conf.json (Issue #12)");

    let active = bundle
        .get("active")
        .and_then(|v| v.as_bool())
        .expect("expected bundle.active to be a boolean (Issue #12)");
    assert!(
        active,
        "expected bundle.active = true so `cargo tauri build` produces a `.dmg` (Issue #12)"
    );

    let targets = bundle
        .get("targets")
        .and_then(|v| v.as_array())
        .expect("expected bundle.targets to be an array (Issue #12 — explicit, not the default \"all\")");
    let target_strs: Vec<&str> = targets.iter().filter_map(|v| v.as_str()).collect();
    assert_eq!(
        target_strs,
        vec!["dmg"],
        "expected bundle.targets to be exactly [\"dmg\"] (Issue #12 — v0.2.2 ships only the .dmg, \
         not the bare .app). Got: {:?}",
        target_strs
    );

    let icon = bundle
        .get("icon")
        .and_then(|v| v.as_array())
        .expect("expected bundle.icon to be an array (Issue #12)");
    assert!(
        !icon.is_empty(),
        "expected bundle.icon to be a non-empty array of paths (Issue #12 — empty ships an \
         iconless app)"
    );
    // The macOS bundle requires an .icns somewhere in the icon list.
    let has_icns = icon
        .iter()
        .filter_map(|v| v.as_str())
        .any(|p| p.ends_with(".icns"));
    assert!(
        has_icns,
        "expected bundle.icon to include an .icns path for the macOS bundle (Issue #12). Got: {:?}",
        icon
    );
}

#[test]
fn tauri_conf_macos_bundle_signs_adhoc() {
    // v0.2.3 fix: without an explicit `bundle.macOS.signingIdentity`,
    // `cargo tauri build` produces a .app whose Mach-O is linker-
    // signed (mandatory on Apple Silicon to load) but whose BUNDLE has
    // no `_CodeSignature/CodeResources` catalog. Sequoia rejects the
    // unverifiable bundle signature with the "is damaged and can't be
    // opened" Gatekeeper dialog — even after `xattr -cr` strips the
    // quarantine. Setting `signingIdentity = "-"` directs Tauri to
    // run `codesign --sign -` on the assembled bundle, producing a
    // verifiable ad-hoc signature.
    //
    // This is NOT a substitute for proper Developer ID signing +
    // notarization (still deferred per v0.2 PRD § Decisions). It only
    // fixes the build defect that turned an unsigned-app friction
    // event into a "the app is damaged" event.
    //
    // Pin: bundle.macOS.signingIdentity == "-".
    let cfg = load_config();
    let macos = cfg
        .pointer("/bundle/macOS")
        .and_then(|m| m.as_object())
        .expect("expected `bundle.macOS` object in tauri.conf.json (v0.2.3 — bundle ad-hoc signing)");

    let identity = macos
        .get("signingIdentity")
        .and_then(|v| v.as_str())
        .expect("expected bundle.macOS.signingIdentity to be a string (v0.2.3)");
    assert_eq!(
        identity, "-",
        "expected bundle.macOS.signingIdentity = \"-\" so `cargo tauri build` runs `codesign --sign -` \
         on the assembled bundle (v0.2.3 — without it, Sequoia's Gatekeeper rejects the \
         unverifiable bundle signature with \"is damaged and can't be opened\")"
    );
}

#[test]
fn tauri_conf_has_before_dev_and_build_commands() {
    // Issue #2: tauri must hand frontend lifecycle to Vite.
    let cfg = load_config();
    let build = cfg
        .get("build")
        .and_then(|b| b.as_object())
        .expect("expected `build` object in tauri.conf.json");

    let before_dev = build
        .get("beforeDevCommand")
        .and_then(|v| v.as_str())
        .expect("expected build.beforeDevCommand in tauri.conf.json");
    assert_eq!(
        before_dev, "npm run dev",
        "expected build.beforeDevCommand == \"npm run dev\""
    );

    let before_build = build
        .get("beforeBuildCommand")
        .and_then(|v| v.as_str())
        .expect("expected build.beforeBuildCommand in tauri.conf.json");
    assert_eq!(
        before_build, "npm run build",
        "expected build.beforeBuildCommand == \"npm run build\""
    );

    let dev_url = build
        .get("devUrl")
        .and_then(|v| v.as_str())
        .expect("expected build.devUrl in tauri.conf.json");
    assert_eq!(
        dev_url, "http://localhost:1420",
        "expected build.devUrl == \"http://localhost:1420\""
    );

    let frontend_dist = build
        .get("frontendDist")
        .and_then(|v| v.as_str())
        .expect("expected build.frontendDist in tauri.conf.json");
    assert_eq!(
        frontend_dist, "../dist",
        "expected build.frontendDist == \"../dist\""
    );
}
